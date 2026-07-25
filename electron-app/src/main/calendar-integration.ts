import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const CREDENTIALS_DIR = join(homedir(), '.ghostforge', 'credentials');
const CALENDAR_TOKENS_FILE = join(CREDENTIALS_DIR, 'calendar-tokens.json');

// ── Types ────────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string | { displayName?: string };
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus: string }>;
  recurrence?: string[];
  reminders?: Array<{ method: string; minutes: number }>;
  status: string;
  htmlLink?: string;
  created: string;
  updated: string;
  organizer?: { email: string; displayName?: string };
  hangoutLink?: string;
  conferenceData?: { conferenceSolution?: { name: string } };
  visibility?: string;
}

export interface CreateEventParams {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  attendees?: string[];
  recurrence?: string[];
  reminders?: Array<{ method: string; minutes: number }>;
}

export interface FreeBusySlot {
  start: string;
  end: string;
}

export interface CalendarAccount {
  id: string;
  provider: 'google' | 'outlook' | 'caldav';
  email: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  caldavUrl?: string;
  caldavUsername?: string;
  caldavPassword?: string;
}

// ── Encryption ───────────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const envKey = process.env['GHOSTFORGE_CALENDAR_KEY'];
  if (envKey) return Buffer.from(envKey, 'hex');
  return createHash('sha256').update('ghostforge-jarvis-calendar-' + homedir()).digest();
}

function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(data: string): string {
  const key = getEncryptionKey();
  const [ivHex, encrypted] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Token Storage ────────────────────────────────────────────────────────────

function ensureCredentialsDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
}

function loadAccounts(): Record<string, CalendarAccount> {
  ensureCredentialsDir();
  if (!existsSync(CALENDAR_TOKENS_FILE)) return {};
  try {
    const raw = readFileSync(CALENDAR_TOKENS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, CalendarAccount>;
    for (const account of Object.values(parsed)) {
      if (account.accessToken) {
        try { account.accessToken = decrypt(account.accessToken); } catch { /* already decrypted */ }
      }
      if (account.refreshToken) {
        try { account.refreshToken = decrypt(account.refreshToken); } catch { /* already decrypted */ }
      }
      if (account.caldavPassword) {
        try { account.caldavPassword = decrypt(account.caldavPassword); } catch { /* already decrypted */ }
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveAccounts(accounts: Record<string, CalendarAccount>): void {
  ensureCredentialsDir();
  const toSave: Record<string, CalendarAccount> = {};
  for (const [id, account] of Object.entries(accounts)) {
    toSave[id] = {
      ...account,
      accessToken: account.accessToken ? encrypt(account.accessToken) : undefined,
      refreshToken: account.refreshToken ? encrypt(account.refreshToken) : undefined,
      caldavPassword: account.caldavPassword ? encrypt(account.caldavPassword) : undefined,
    };
  }
  writeFileSync(CALENDAR_TOKENS_FILE, JSON.stringify(toSave, null, 2));
}

// ── OAuth2 Helpers ───────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALENDAR_REDIRECT = 'http://localhost:18923/oauth/calendar/callback';
const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

const O365_CLIENT_ID = process.env.O365_CLIENT_ID || '';
const O365_CLIENT_SECRET = process.env.O365_CLIENT_SECRET || '';
const O365_REDIRECT_URI = 'http://localhost:18923/oauth/calendar/callback';
const O365_CALENDAR_SCOPES = 'https://graph.microsoft.com/Calendars.ReadWrite';

// ── API Helpers ──────────────────────────────────────────────────────────────

async function apiRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    accessToken?: string;
  } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (options.accessToken) {
    headers['Authorization'] = `Bearer ${options.accessToken}`;
  }

  const fetchOptions: RequestInit = {
    method: options.method || 'GET',
    headers,
    signal: AbortSignal.timeout(30000),
  };
  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, fetchOptions);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Calendar API error ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

async function getValidToken(account: CalendarAccount): Promise<string> {
  if (account.accessToken && account.tokenExpiry && Date.now() < account.tokenExpiry - 60000) {
    return account.accessToken;
  }
  if (!account.refreshToken) throw new Error('No refresh token available');

  if (account.provider === 'google') {
    const data = await apiRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: {
        refresh_token: account.refreshToken,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      },
    }) as { access_token: string; expires_in: number };

    account.accessToken = data.access_token;
    account.tokenExpiry = Date.now() + data.expires_in * 1000;

    const accounts = loadAccounts();
    accounts[account.id] = account;
    saveAccounts(accounts);

    return data.access_token;
  }

  if (account.provider === 'outlook') {
    const data = await apiRequest('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: account.refreshToken,
        client_id: O365_CLIENT_ID,
        client_secret: O365_CLIENT_SECRET,
        grant_type: 'refresh_token',
        scope: O365_CALENDAR_SCOPES,
      }).toString(),
    }) as { access_token: string; expires_in: number };

    account.accessToken = data.access_token;
    account.tokenExpiry = Date.now() + data.expires_in * 1000;

    const accounts = loadAccounts();
    accounts[account.id] = account;
    saveAccounts(accounts);

    return data.access_token;
  }

  throw new Error('Unknown provider');
}

// ── Google Calendar API ─────────────────────────────────────────────────────

async function googleListEvents(
  account: CalendarAccount,
  timeMin: string,
  timeMax: string,
  maxResults: number = 20,
): Promise<CalendarEvent[]> {
  const token = await getValidToken(account);
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`;
  const data = await apiRequest(url, { accessToken: token }) as {
    items?: CalendarEvent[];
  };
  return data.items || [];
}

async function googleCreateEvent(
  account: CalendarAccount,
  params: CreateEventParams,
): Promise<CalendarEvent> {
  const token = await getValidToken(account);
  const eventBody: Record<string, unknown> = {
    summary: params.summary,
    description: params.description || '',
    location: params.location || '',
    start: {
      dateTime: params.startDateTime,
      timeZone: params.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: params.endDateTime,
      timeZone: params.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };

  if (params.attendees?.length) {
    eventBody.attendees = params.attendees.map(email => ({ email }));
  }
  if (params.recurrence?.length) {
    eventBody.recurrence = params.recurrence;
  }
  if (params.reminders?.length) {
    eventBody.reminders = { useDefault: false, overrides: params.reminders };
  }

  const data = await apiRequest(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    { method: 'POST', accessToken: token, body: eventBody },
  ) as CalendarEvent;

  return data;
}

async function googleUpdateEvent(
  account: CalendarAccount,
  eventId: string,
  updates: Partial<CreateEventParams>,
): Promise<CalendarEvent> {
  const token = await getValidToken(account);
  const eventBody: Record<string, unknown> = {};

  if (updates.summary) eventBody.summary = updates.summary;
  if (updates.description !== undefined) eventBody.description = updates.description;
  if (updates.location !== undefined) eventBody.location = updates.location;
  if (updates.startDateTime) {
    eventBody.start = {
      dateTime: updates.startDateTime,
      timeZone: updates.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  if (updates.endDateTime) {
    eventBody.end = {
      dateTime: updates.endDateTime,
      timeZone: updates.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  const data = await apiRequest(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: 'PATCH', accessToken: token, body: eventBody },
  ) as CalendarEvent;

  return data;
}

async function googleDeleteEvent(account: CalendarAccount, eventId: string): Promise<void> {
  const token = await getValidToken(account);
  await apiRequest(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: 'DELETE', accessToken: token },
  );
}

async function googleFreeBusy(
  account: CalendarAccount,
  timeMin: string,
  timeMax: string,
): Promise<FreeBusySlot[]> {
  const token = await getValidToken(account);
  const data = await apiRequest(
    'https://www.googleapis.com/calendar/v3/freeBusy',
    {
      method: 'POST',
      accessToken: token,
      body: {
        timeMin,
        timeMax,
        items: [{ id: 'primary' }],
      },
    },
  ) as {
    calendars?: {
      primary?: { busy?: Array<{ start: string; end: string }> };
    };
  };

  return data.calendars?.primary?.busy || [];
}

// ── Outlook Calendar API ────────────────────────────────────────────────────

async function outlookListEvents(
  account: CalendarAccount,
  timeMin: string,
  timeMax: string,
  maxResults: number = 20,
): Promise<CalendarEvent[]> {
  const token = await getValidToken(account);
  const url = `/me/calendarView?startDateTime=${encodeURIComponent(timeMin)}&endDateTime=${encodeURIComponent(timeMax)}&$top=${maxResults}&$orderby=start/dateTime`;
  const data = await apiRequest(`https://graph.microsoft.com/v1.0${url}`, { accessToken: token }) as {
    value?: Array<{
      id: string;
      subject: string;
      bodyPreview: string;
      location: { displayName: string };
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string; timeZone: string };
      attendees: Array<{ emailAddress: { address: string; name: string }; status: { response: string } }>;
      isAllDay: boolean;
      showAs: string;
      webLink: string;
      isCancelled: boolean;
    }>;
  };

  return (data.value || []).filter(e => !e.isCancelled).map(e => ({
    id: e.id,
    summary: e.subject || '(no title)',
    description: e.bodyPreview || '',
    location: e.location?.displayName || undefined,
    start: { dateTime: e.start.dateTime, timeZone: e.start.timeZone },
    end: { dateTime: e.end.dateTime, timeZone: e.end.timeZone },
    attendees: e.attendees?.map(a => ({
      email: a.emailAddress.address,
      displayName: a.emailAddress.name,
      responseStatus: a.status.response,
    })),
    status: e.showAs || 'confirmed',
    htmlLink: e.webLink,
    created: '',
    updated: '',
  }));
}

async function outlookCreateEvent(
  account: CalendarAccount,
  params: CreateEventParams,
): Promise<CalendarEvent> {
  const token = await getValidToken(account);
  const body = {
    subject: params.summary,
    body: { contentType: 'Text', content: params.description || '' },
    location: { displayName: params.location || '' },
    start: { dateTime: params.startDateTime, timeZone: params.timeZone || 'UTC' },
    end: { dateTime: params.endDateTime, timeZone: params.timeZone || 'UTC' },
    attendees: params.attendees?.map(email => ({
      emailAddress: { address: email },
      type: 'Required',
    })) || [],
    isReminderOn: true,
  };

  const data = await apiRequest(
    'https://graph.microsoft.com/v1.0/me/events',
    { method: 'POST', accessToken: token, body },
  ) as { id: string; webLink: string };

  return {
    id: data.id,
    summary: params.summary,
    description: params.description,
    location: params.location || undefined,
    start: { dateTime: params.startDateTime, timeZone: params.timeZone },
    end: { dateTime: params.endDateTime, timeZone: params.timeZone },
    status: 'confirmed',
    htmlLink: data.webLink,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}

async function outlookDeleteEvent(account: CalendarAccount, eventId: string): Promise<void> {
  const token = await getValidToken(account);
  await apiRequest(
    `https://graph.microsoft.com/v1.0/me/events/${eventId}`,
    { method: 'DELETE', accessToken: token },
  );
}

// ── Account Management ──────────────────────────────────────────────────────

function getAccount(accountId?: string): CalendarAccount {
  const accounts = loadAccounts();
  const ids = Object.keys(accounts);
  if (ids.length === 0) throw new Error('No calendar accounts configured. Run JARVIS calendar setup first.');
  if (accountId) {
    const account = accounts[accountId];
    if (!account) throw new Error(`Account ${accountId} not found`);
    return account;
  }
  return accounts[ids[0]];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startGoogleCalendarOAuth(): { authUrl: string } {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALENDAR_REDIRECT,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });

  return { authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
}

export async function handleCalendarOAuthCallback(code: string, provider: 'google' | 'outlook'): Promise<CalendarAccount> {
  if (provider === 'google') {
    const tokenData = await apiRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: {
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALENDAR_REDIRECT,
        grant_type: 'authorization_code',
      },
    }) as { access_token: string; refresh_token: string; expires_in: number };

    const userInfo = await apiRequest('https://www.googleapis.com/oauth2/v2/userinfo', {
      accessToken: tokenData.access_token,
    }) as { email: string; name: string };

    const account: CalendarAccount = {
      id: `gcal-${Date.now()}`,
      provider: 'google',
      email: userInfo.email,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiry: Date.now() + tokenData.expires_in * 1000,
    };

    const accounts = loadAccounts();
    accounts[account.id] = account;
    saveAccounts(accounts);
    return account;
  }

  throw new Error(`OAuth callback for ${provider} not implemented`);
}

export function addCaldavAccount(config: {
  url: string;
  username: string;
  password: string;
  displayName?: string;
}): CalendarAccount {
  const account: CalendarAccount = {
    id: `caldav-${Date.now()}`,
    provider: 'caldav',
    email: config.username,
    caldavUrl: config.url,
    caldavUsername: config.username,
    caldavPassword: config.password,
  };

  const accounts = loadAccounts();
  accounts[account.id] = account;
  saveAccounts(accounts);
  return { ...account, caldavPassword: '***' };
}

export function getCalendarAccounts(): CalendarAccount[] {
  const accounts = loadAccounts();
  return Object.values(accounts).map(a => ({
    ...a,
    accessToken: undefined,
    refreshToken: a.refreshToken ? '***' : undefined,
    caldavPassword: a.caldavPassword ? '***' : undefined,
  }));
}

export function removeCalendarAccount(accountId: string): boolean {
  const accounts = loadAccounts();
  if (!accounts[accountId]) return false;
  delete accounts[accountId];
  saveAccounts(accounts);
  return true;
}

export async function listTodayEvents(accountId?: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  const account = getAccount(accountId);
  if (account.provider === 'google') return googleListEvents(account, startOfDay, endOfDay);
  if (account.provider === 'outlook') return outlookListEvents(account, startOfDay, endOfDay);
  throw new Error(`Provider ${account.provider} not supported`);
}

export async function listUpcomingEvents(days: number = 7, accountId?: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const account = getAccount(accountId);
  if (account.provider === 'google') return googleListEvents(account, now.toISOString(), end.toISOString());
  if (account.provider === 'outlook') return outlookListEvents(account, now.toISOString(), end.toISOString());
  throw new Error(`Provider ${account.provider} not supported`);
}

export function createEvent(params: CreateEventParams & { accountId?: string }): Promise<CalendarEvent> {
  const account = getAccount(params.accountId);
  if (account.provider === 'google') return googleCreateEvent(account, params);
  if (account.provider === 'outlook') return outlookCreateEvent(account, params);
  throw new Error(`Provider ${account.provider} not supported`);
}

export function updateEvent(eventId: string, updates: Partial<CreateEventParams> & { accountId?: string }): Promise<CalendarEvent> {
  const account = getAccount(updates.accountId);
  if (account.provider === 'google') return googleUpdateEvent(account, eventId, updates);
  throw new Error(`Update not implemented for ${account.provider}`);
}

export function deleteEvent(eventId: string, accountId?: string): Promise<void> {
  const account = getAccount(accountId);
  if (account.provider === 'google') return googleDeleteEvent(account, eventId);
  if (account.provider === 'outlook') return outlookDeleteEvent(account, eventId);
  throw new Error(`Delete not implemented for ${account.provider}`);
}

export function checkAvailability(timeMin: string, timeMax: string, accountId?: string): Promise<FreeBusySlot[]> {
  const account = getAccount(accountId);
  if (account.provider === 'google') return googleFreeBusy(account, timeMin, timeMax);
  throw new Error(`Free/busy not implemented for ${account.provider}`);
}

export async function getFreeSlots(date: string, accountId?: string): Promise<FreeBusySlot[]> {
  const dayStart = new Date(date + 'T09:00:00');
  const dayEnd = new Date(date + 'T18:00:00');
  const busy = await checkAvailability(dayStart.toISOString(), dayEnd.toISOString(), accountId);

  const freeSlots: FreeBusySlot[] = [];
  let current = dayStart;

  for (const slot of busy) {
    const busyStart = new Date(slot.start);
    if (current < busyStart) {
      freeSlots.push({ start: current.toISOString(), end: busyStart.toISOString() });
    }
    current = new Date(Math.max(current.getTime(), busyStart.getTime() + (busyStart.getTime() === current.getTime() ? 0 : 0)));
    current = busyStart > current ? busyStart : current;
  }

  if (current < dayEnd) {
    freeSlots.push({ start: current.toISOString(), end: dayEnd.toISOString() });
  }

  return freeSlots;
}
