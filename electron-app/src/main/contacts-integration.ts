import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const CREDENTIALS_DIR = join(homedir(), '.ghostforge', 'credentials');
const CONTACTS_TOKENS_FILE = join(CREDENTIALS_DIR, 'contacts-tokens.json');
const LOCAL_CONTACTS_FILE = join(homedir(), '.ghostforge', 'contacts', 'local.json');

// ── Types ────────────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  emails: Array<{ value: string; type: string }>;
  phones: Array<{ value: string; type: string }>;
  organizations?: Array<{ name: string; title?: string }>;
  addresses?: Array<{
    formattedValue: string;
    type?: string;
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  }>;
  birthdays?: Array<{ date: { year?: number; month: number; day: number } }>;
  photos?: Array<{ url: string }>;
  urls?: Array<{ value: string; type: string }>;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContactsAccount {
  id: string;
  provider: 'google' | 'outlook' | 'local';
  email: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
}

// ── Encryption ───────────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const envKey = process.env['GHOSTFORGE_CONTACTS_KEY'];
  if (envKey) return Buffer.from(envKey, 'hex');
  return createHash('sha256').update('ghostforge-jarvis-contacts-' + homedir()).digest();
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

// ── Storage ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadAccounts(): Record<string, ContactsAccount> {
  ensureDir(CREDENTIALS_DIR);
  if (!existsSync(CONTACTS_TOKENS_FILE)) return {};
  try {
    const raw = readFileSync(CONTACTS_TOKENS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ContactsAccount>;
    for (const account of Object.values(parsed)) {
      if (account.accessToken) {
        try { account.accessToken = decrypt(account.accessToken); } catch { /* ok */ }
      }
      if (account.refreshToken) {
        try { account.refreshToken = decrypt(account.refreshToken); } catch { /* ok */ }
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveAccounts(accounts: Record<string, ContactsAccount>): void {
  ensureDir(CREDENTIALS_DIR);
  const toSave: Record<string, ContactsAccount> = {};
  for (const [id, account] of Object.entries(accounts)) {
    toSave[id] = {
      ...account,
      accessToken: account.accessToken ? encrypt(account.accessToken) : undefined,
      refreshToken: account.refreshToken ? encrypt(account.refreshToken) : undefined,
    };
  }
  writeFileSync(CONTACTS_TOKENS_FILE, JSON.stringify(toSave, null, 2));
}

function loadLocalContacts(): Contact[] {
  const dir = join(homedir(), '.ghostforge', 'contacts');
  ensureDir(dir);
  if (!existsSync(LOCAL_CONTACTS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(LOCAL_CONTACTS_FILE, 'utf8')) as Contact[];
  } catch {
    return [];
  }
}

function saveLocalContacts(contacts: Contact[]): void {
  const dir = join(homedir(), '.ghostforge', 'contacts');
  ensureDir(dir);
  writeFileSync(LOCAL_CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

// ── OAuth2 Helpers ───────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CONTACTS_REDIRECT = 'http://localhost:18923/oauth/contacts/callback';
const GOOGLE_CONTACTS_SCOPES = [
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts',
].join(' ');

const O365_CLIENT_ID = process.env.O365_CLIENT_ID || '';
const O365_CLIENT_SECRET = process.env.O365_CLIENT_SECRET || '';
const O365_REDIRECT_URI = 'http://localhost:18923/oauth/contacts/callback';
const O365_CONTACTS_SCOPES = 'https://graph.microsoft.com/Contacts.Read';

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
    throw new Error(`Contacts API error ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

async function getValidToken(account: ContactsAccount): Promise<string> {
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
        scope: O365_CONTACTS_SCOPES,
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

// ── Google People API ───────────────────────────────────────────────────────

async function googleSearchContacts(
  account: ContactsAccount,
  query: string,
): Promise<Contact[]> {
  const token = await getValidToken(account);
  const data = await apiRequest(
    `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(query)}&readMask=names,emailAddresses,phoneNumbers,organizations,addresses,birthdays,photos,urls,metadata`,
    { accessToken: token },
  ) as {
    results?: Array<{
      person: {
        resourceName: string;
        names?: Array<{ displayName: string; givenName?: string; familyName?: string }>;
        emailAddresses?: Array<{ value: string; type?: string }>;
        phoneNumbers?: Array<{ value: string; type?: string }>;
        organizations?: Array<{ name?: string; title?: string }>;
        addresses?: Array<{ formattedValue: string; type?: string }>;
        birthdays?: Array<{ date: { year?: number; month: number; day: number } }>;
        photos?: Array<{ url: string; default?: boolean }>;
        urls?: Array<{ value: string; type?: string }>;
        metadata?: { sources?: Array<{ updateTime: string }> };
      };
    }>;
  };

  return (data.results || []).map(r => {
    const p = r.person;
    return {
      id: p.resourceName || '',
      displayName: p.names?.[0]?.displayName || '',
      givenName: p.names?.[0]?.givenName,
      familyName: p.names?.[0]?.familyName,
      emails: (p.emailAddresses || []).map(e => ({ value: e.value, type: e.type || 'unknown' })),
      phones: (p.phoneNumbers || []).map(ph => ({ value: ph.value, type: ph.type || 'unknown' })),
      organizations: p.organizations?.map(o => ({ name: o.name || '', title: o.title })),
      addresses: p.addresses?.map(a => ({ formattedValue: a.formattedValue, type: a.type })),
      birthdays: p.birthdays,
      photos: p.photos?.filter(ph => !ph.default),
      urls: p.urls?.map(u => ({ value: u.value, type: u.type || 'unknown' })),
      updatedAt: p.metadata?.sources?.[0]?.updateTime,
    };
  });
}

async function googleGetContact(
  account: ContactsAccount,
  resourceName: string,
): Promise<Contact> {
  const token = await getValidToken(account);
  const data = await apiRequest(
    `https://people.googleapis.com/v1/${resourceName}?readMask=names,emailAddresses,phoneNumbers,organizations,addresses,birthdays,photos,urls,notes`,
    { accessToken: token },
  ) as {
    resourceName: string;
    names?: Array<{ displayName: string; givenName?: string; familyName?: string }>;
    emailAddresses?: Array<{ value: string; type?: string }>;
    phoneNumbers?: Array<{ value: string; type?: string }>;
    organizations?: Array<{ name?: string; title?: string }>;
    addresses?: Array<{ formattedValue: string; type?: string }>;
    birthdays?: Array<{ date: { year?: number; month: number; day: number } }>;
    photos?: Array<{ url: string }>;
    urls?: Array<{ value: string; type?: string }>;
    notes?: { value: string };
  };

  return {
    id: data.resourceName || resourceName,
    displayName: data.names?.[0]?.displayName || '',
    givenName: data.names?.[0]?.givenName,
    familyName: data.names?.[0]?.familyName,
    emails: (data.emailAddresses || []).map(e => ({ value: e.value, type: e.type || 'unknown' })),
    phones: (data.phoneNumbers || []).map(ph => ({ value: ph.value, type: ph.type || 'unknown' })),
    organizations: data.organizations?.map(o => ({ name: o.name || '', title: o.title })),
    addresses: data.addresses?.map(a => ({ formattedValue: a.formattedValue, type: a.type })),
    birthdays: data.birthdays,
    photos: data.photos,
    urls: data.urls?.map(u => ({ value: u.value, type: u.type || 'unknown' })),
    notes: data.notes?.value,
  };
}

async function googleCreateContact(
  account: ContactsAccount,
  contact: Partial<Contact>,
): Promise<Contact> {
  const token = await getValidToken(account);
  const body: Record<string, unknown> = {};

  if (contact.displayName || contact.givenName || contact.familyName) {
    body.names = [{ givenName: contact.givenName || '', familyName: contact.familyName || '', displayName: contact.displayName || '' }];
  }
  if (contact.emails?.length) {
    body.emailAddresses = contact.emails.map(e => ({ value: e.value, type: e.type }));
  }
  if (contact.phones?.length) {
    body.phoneNumbers = contact.phones.map(p => ({ value: p.value, type: p.type }));
  }
  if (contact.organizations?.length) {
    body.organizations = contact.organizations;
  }

  const data = await apiRequest(
    'https://people.googleapis.com/v1/people:createContact?readMask=names,emailAddresses,phoneNumbers',
    { method: 'POST', accessToken: token, body },
  ) as { resourceName: string; names?: Array<{ displayName: string }> };

  return {
    id: data.resourceName,
    displayName: data.names?.[0]?.displayName || contact.displayName || '',
    emails: contact.emails || [],
    phones: contact.phones || [],
  };
}

async function googleDeleteContact(
  account: ContactsAccount,
  resourceName: string,
): Promise<void> {
  const token = await getValidToken(account);
  await apiRequest(
    `https://people.googleapis.com/v1/${resourceName}:deleteContact`,
    { method: 'DELETE', accessToken: token },
  );
}

// ── Outlook Contacts API ────────────────────────────────────────────────────

async function outlookSearchContacts(
  account: ContactsAccount,
  query: string,
): Promise<Contact[]> {
  const token = await getValidToken(account);
  const filter = `contains(displayName,'${query}') or contains(givenName,'${query}') or contains(surname,'${query}') or contains(emailAddresses/any(e:e.address),'${query}')`;
  const data = await apiRequest(
    `https://graph.microsoft.com/v1.0/me/contacts?$filter=${encodeURIComponent(filter)}&$top=20&$select=id,displayName,givenName,surname,emailAddresses,homePhones,mobilePhone,businessPhones,companyName,jobTitle,homeAddress,birthday`,
    { accessToken: token },
  ) as {
    value?: Array<{
      id: string;
      displayName: string;
      givenName: string;
      surname: string;
      emailAddresses: Array<{ address: string; name?: string }>;
      homePhones: string[];
      mobilePhone: string;
      businessPhones: string[];
      companyName: string;
      jobTitle: string;
      homeAddress: { street?: string; city?: string; state?: string; postalCode?: string; countryOrRegion?: string };
      birthday: string;
    }>;
  };

  return (data.value || []).map(c => ({
    id: c.id,
    displayName: c.displayName || '',
    givenName: c.givenName,
    familyName: c.surname,
    emails: c.emailAddresses.map(e => ({ value: e.address, type: 'work' })),
    phones: [
      ...c.homePhones.map(p => ({ value: p, type: 'home' })),
      ...(c.mobilePhone ? [{ value: c.mobilePhone, type: 'mobile' }] : []),
      ...c.businessPhones.map(p => ({ value: p, type: 'work' })),
    ],
    organizations: c.companyName ? [{ name: c.companyName, title: c.jobTitle }] : undefined,
    addresses: c.homeAddress?.street ? [{
      formattedValue: [c.homeAddress.street, c.homeAddress.city, c.homeAddress.state, c.homeAddress.postalCode, c.homeAddress.countryOrRegion].filter(Boolean).join(', '),
      type: 'home',
    }] : undefined,
    birthdays: c.birthday ? [{ date: { month: new Date(c.birthday).getMonth() + 1, day: new Date(c.birthday).getDate() } }] : undefined,
  }));
}

// ── Account Management ──────────────────────────────────────────────────────

function getAccount(accountId?: string): ContactsAccount {
  const accounts = loadAccounts();
  const ids = Object.keys(accounts);
  if (ids.length === 0) return { id: 'local', provider: 'local', email: 'local' };
  if (accountId) {
    const account = accounts[accountId];
    if (!account) throw new Error(`Account ${accountId} not found`);
    return account;
  }
  return accounts[ids[0]];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startGoogleContactsOAuth(): { authUrl: string } {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials not configured.');
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CONTACTS_REDIRECT,
    response_type: 'code',
    scope: GOOGLE_CONTACTS_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });

  return { authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
}

export async function handleContactsOAuthCallback(code: string, provider: 'google' | 'outlook'): Promise<ContactsAccount> {
  if (provider === 'google') {
    const tokenData = await apiRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: {
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CONTACTS_REDIRECT,
        grant_type: 'authorization_code',
      },
    }) as { access_token: string; refresh_token: string; expires_in: number };

    const userInfo = await apiRequest('https://www.googleapis.com/oauth2/v2/userinfo', {
      accessToken: tokenData.access_token,
    }) as { email: string };

    const account: ContactsAccount = {
      id: `gcontacts-${Date.now()}`,
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

export function searchContacts(query: string, accountId?: string): Promise<Contact[]> {
  const account = getAccount(accountId);
  if (account.provider === 'google') return googleSearchContacts(account, query);
  if (account.provider === 'outlook') return outlookSearchContacts(account, query);

  // Local search fallback
  const contacts = loadLocalContacts();
  const q = query.toLowerCase();
  const filtered = contacts.filter(c =>
    c.displayName.toLowerCase().includes(q) ||
    c.emails.some(e => e.value.toLowerCase().includes(q)) ||
    c.phones.some(p => p.value.includes(q)) ||
    (c.givenName || '').toLowerCase().includes(q) ||
    (c.familyName || '').toLowerCase().includes(q),
  );
  return Promise.resolve(filtered);
}

export function getContact(contactId: string, accountId?: string): Promise<Contact> {
  const account = getAccount(accountId);
  if (account.provider === 'google') return googleGetContact(account, contactId);
  throw new Error(`Get contact not implemented for ${account.provider}`);
}

export function createContact(contact: Partial<Contact> & { accountId?: string }): Promise<Contact> {
  const account = getAccount(contact.accountId);
  if (account.provider === 'google') return googleCreateContact(account, contact);

  // Local create
  const contacts = loadLocalContacts();
  const newContact: Contact = {
    id: `local-${Date.now()}`,
    displayName: contact.displayName || '',
    givenName: contact.givenName,
    familyName: contact.familyName,
    emails: contact.emails || [],
    phones: contact.phones || [],
    organizations: contact.organizations,
    addresses: contact.addresses,
    birthdays: contact.birthdays,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  contacts.push(newContact);
  saveLocalContacts(contacts);
  return Promise.resolve(newContact);
}

export function deleteContact(contactId: string, accountId?: string): Promise<void> {
  const account = getAccount(accountId);
  if (account.provider === 'google') return googleDeleteContact(account, contactId);

  // Local delete
  const contacts = loadLocalContacts();
  const filtered = contacts.filter(c => c.id !== contactId);
  saveLocalContacts(filtered);
  return Promise.resolve();
}

export function getContactsByPhone(phone: string, accountId?: string): Promise<Contact[]> {
  return searchContacts(phone, accountId);
}

export function getRecentContacts(count: number = 10): Promise<Contact[]> {
  const contacts = loadLocalContacts();
  const sorted = contacts.sort((a, b) =>
    (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''),
  );
  return Promise.resolve(sorted.slice(0, count));
}

export function getContactAccounts(): ContactsAccount[] {
  const accounts = loadAccounts();
  return Object.values(accounts).map(a => ({
    ...a,
    accessToken: undefined,
    refreshToken: a.refreshToken ? '***' : undefined,
  }));
}

export function removeContactAccount(accountId: string): boolean {
  const accounts = loadAccounts();
  if (!accounts[accountId]) return false;
  delete accounts[accountId];
  saveAccounts(accounts);
  return true;
}
