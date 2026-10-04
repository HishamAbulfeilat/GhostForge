import { net } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { validateOutboundUrl } from './outbound-url';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { assertOAuthProvider, unsupportedOperation, type EmailOAuthProvider } from './oauth-providers';

const CREDENTIALS_DIR = join(homedir(), '.ghostforge', 'credentials');
const EMAIL_TOKENS_FILE = join(CREDENTIALS_DIR, 'email-tokens.json');
const ENCRYPTION_KEY_ENV = 'GHOSTFORGE_EMAIL_KEY';

function getEncryptionKey(): Buffer {
  const envKey = process.env[ENCRYPTION_KEY_ENV];
  if (envKey) return Buffer.from(envKey, 'hex');
  const fallback = createHash('sha256').update('ghostforge-jarvis-email-' + homedir()).digest();
  return fallback;
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

// ── Types ────────────────────────────────────────────────────────────────────

export interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string[];
  cc?: string[];
  date: string;
  snippet: string;
  body: string;
  bodyHtml: string;
  isUnread: boolean;
  isStarred: boolean;
  labels: string[];
  hasAttachments: boolean;
  attachments?: Array<{ filename: string; mimeType: string; size: number }>;
}

export interface EmailSendParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  inReplyTo?: string;
  threadId?: string;
}

export interface EmailSearchParams {
  query?: string;
  from?: string;
  to?: string;
  subject?: string;
  after?: string;
  before?: string;
  label?: string;
  isUnread?: boolean;
  maxResults?: number;
  pageToken?: string;
}

export interface EmailAccount {
  id: string;
  provider: 'gmail' | 'outlook' | 'imap';
  email: string;
  displayName?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  apiKey?: string;
}

// ── OAuth2 Helpers ───────────────────────────────────────────────────────────

const GMAIL_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GMAIL_REDIRECT_URI = 'http://localhost:18923/oauth/email/callback';
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts.readonly',
].join(' ');

// Microsoft OAuth client settings: still used to refresh Outlook tokens for
// accounts stored by earlier builds, even though new Outlook sign-in is not
// offered (no authorization-URL step exists).
const O365_CLIENT_ID = process.env.O365_CLIENT_ID || '';
const O365_CLIENT_SECRET = process.env.O365_CLIENT_SECRET || '';
const O365_REDIRECT_URI = 'http://localhost:18923/oauth/email/callback';
const O365_SCOPES = [
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Calendars.ReadWrite',
  'https://graph.microsoft.com/Contacts.Read',
].join(' ');

// ── Token Storage ────────────────────────────────────────────────────────────

function ensureCredentialsDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
}

function loadTokens(): Record<string, EmailAccount> {
  ensureCredentialsDir();
  if (!existsSync(EMAIL_TOKENS_FILE)) return {};
  try {
    const raw = readFileSync(EMAIL_TOKENS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, EmailAccount>;
    for (const account of Object.values(parsed)) {
      if (account.accessToken) {
        try { account.accessToken = decrypt(account.accessToken); } catch { /* already decrypted */ }
      }
      if (account.refreshToken) {
        try { account.refreshToken = decrypt(account.refreshToken); } catch { /* already decrypted */ }
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveTokens(accounts: Record<string, EmailAccount>): void {
  ensureCredentialsDir();
  const toSave: Record<string, EmailAccount> = {};
  for (const [id, account] of Object.entries(accounts)) {
    toSave[id] = {
      ...account,
      accessToken: account.accessToken ? encrypt(account.accessToken) : undefined,
      refreshToken: account.refreshToken ? encrypt(account.refreshToken) : undefined,
    };
  }
  writeFileSync(EMAIL_TOKENS_FILE, JSON.stringify(toSave, null, 2));
}

// ── HTTP Helpers ─────────────────────────────────────────────────────────────

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

  const safeUrl = validateOutboundUrl(url, [
    'oauth2.googleapis.com',
    'www.googleapis.com',
    'gmail.googleapis.com',
    'login.microsoftonline.com',
    'graph.microsoft.com',
  ], 'Email API');
  const res = await fetch(safeUrl, fetchOptions);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function gmailApi(
  endpoint: string,
  accessToken: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  return apiRequest(
    `https://gmail.googleapis.com/gmail/v1/users/me${endpoint}`,
    { accessToken, ...options },
  );
}

async function outlookApi(
  endpoint: string,
  accessToken: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  return apiRequest(
    `https://graph.microsoft.com/v1.0${endpoint}`,
    { accessToken, ...options },
  );
}

// ── Gmail OAuth2 Flow ────────────────────────────────────────────────────────

let oauthServer: ReturnType<typeof import('net').createServer> | null = null;

export function startGmailOAuth(): Promise<{ authUrl: string }> {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }

  const params = new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    redirect_uri: GMAIL_REDIRECT_URI,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return Promise.resolve({ authUrl });
}

export function handleOAuthCallback(code: string, provider: EmailOAuthProvider): Promise<EmailAccount> {
  assertOAuthProvider('email', provider);
  return handleGmailCallback(code);
}

async function handleGmailCallback(code: string): Promise<EmailAccount> {
  const tokenData = await apiRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: {
      code,
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      redirect_uri: GMAIL_REDIRECT_URI,
      grant_type: 'authorization_code',
    },
  }) as { access_token: string; refresh_token: string; expires_in: number };

  const userInfo = await apiRequest('https://www.googleapis.com/oauth2/v2/userinfo', {
    accessToken: tokenData.access_token,
  }) as { email: string; name: string };

  const account: EmailAccount = {
    id: `gmail-${Date.now()}`,
    provider: 'gmail',
    email: userInfo.email,
    displayName: userInfo.name,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiry: Date.now() + tokenData.expires_in * 1000,
  };

  const accounts = loadTokens();
  accounts[account.id] = account;
  saveTokens(accounts);

  return account;
}

// ── Token Refresh ────────────────────────────────────────────────────────────

async function refreshAccessToken(account: EmailAccount): Promise<string> {
  if (!account.refreshToken) throw new Error('No refresh token available');

  if (account.provider === 'gmail') {
    const data = await apiRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: {
        refresh_token: account.refreshToken,
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        grant_type: 'refresh_token',
      },
    }) as { access_token: string; expires_in: number };

    account.accessToken = data.access_token;
    account.tokenExpiry = Date.now() + data.expires_in * 1000;

    const accounts = loadTokens();
    accounts[account.id] = account;
    saveTokens(accounts);

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
        scope: O365_SCOPES,
      }).toString(),
    }) as { access_token: string; expires_in: number };

    account.accessToken = data.access_token;
    account.tokenExpiry = Date.now() + data.expires_in * 1000;

    const accounts = loadTokens();
    accounts[account.id] = account;
    saveTokens(accounts);

    return data.access_token;
  }

  throw new Error('Unknown provider');
}

async function getValidToken(account: EmailAccount): Promise<string> {
  if (account.accessToken && account.tokenExpiry && Date.now() < account.tokenExpiry - 60000) {
    return account.accessToken;
  }
  return refreshAccessToken(account);
}

// ── Gmail IMAP/SMTP Helpers ─────────────────────────────────────────────────

function parseImapEmail(raw: string): Partial<EmailMessage> {
  const headers: Record<string, string> = {};
  const lines = raw.split('\r\n');
  let bodyStart = false;
  let body = '';
  let bodyHtml = '';

  for (const line of lines) {
    if (!bodyStart) {
      if (line === '') { bodyStart = true; continue; }
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).toLowerCase().trim();
        const val = line.slice(colonIdx + 1).trim();
        headers[key] = headers[key] ? headers[key] + ', ' + val : val;
      }
    } else {
      body += line + '\n';
    }
  }

  return {
    subject: headers['subject'] || '(no subject)',
    from: headers['from'] || '',
    date: headers['date'] || '',
    snippet: body.trim().slice(0, 200),
    body: body.trim(),
    bodyHtml: body.trim(),
  };
}

// ── Gmail API Implementation ────────────────────────────────────────────────

async function gmailListMessages(
  account: EmailAccount,
  params: EmailSearchParams,
): Promise<{ messages: EmailMessage[]; nextPageToken?: string }> {
  const token = await getValidToken(account);
  const qParts: string[] = [];
  if (params.query) qParts.push(params.query);
  if (params.from) qParts.push(`from:${params.from}`);
  if (params.to) qParts.push(`to:${params.to}`);
  if (params.subject) qParts.push(`subject:${params.subject}`);
  if (params.after) qParts.push(`after:${params.after}`);
  if (params.before) qParts.push(`before:${params.before}`);
  if (params.label) qParts.push(`label:${params.label}`);
  if (params.isUnread) qParts.push('is:unread');

  const query = qParts.join(' ');
  const maxResults = Math.min(params.maxResults || 20, 50);
  const listUrl = `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}${params.pageToken ? `&pageToken=${params.pageToken}` : ''}`;

  const listData = await gmailApi(listUrl, token) as {
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
  };

  if (!listData.messages?.length) {
    return { messages: [], nextPageToken: listData.nextPageToken };
  }

  const messages: EmailMessage[] = [];
  for (const msg of listData.messages.slice(0, maxResults)) {
    try {
      const fullMsg = await gmailApi(`/messages/${msg.id}?format=full`, token) as {
        id: string;
        threadId: string;
        labelIds: string[];
        payload: {
          headers: Array<{ name: string; value: string }>;
          parts?: Array<{ mimeType: string; body?: { data?: string; size: number }; filename?: string }>;
          body?: { data?: string };
        };
      };

      const headers = fullMsg.payload.headers.reduce((acc, h) => {
        acc[h.name.toLowerCase()] = h.value;
        return acc;
      }, {} as Record<string, string>);

      let body = '';
      let bodyHtml = '';
      if (fullMsg.payload.body?.data) {
        body = Buffer.from(fullMsg.payload.body.data, 'base64url').toString('utf-8');
        bodyHtml = body;
      }
      if (fullMsg.payload.parts) {
        for (const part of fullMsg.payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            body = Buffer.from(part.body.data, 'base64url').toString('utf-8');
          }
          if (part.mimeType === 'text/html' && part.body?.data) {
            bodyHtml = Buffer.from(part.body.data, 'base64url').toString('utf-8');
          }
        }
      }

      const fromRaw = headers['from'] || '';
      const fromMatch = fromRaw.match(/"?([^"<]*)"?\s*<?([^>]*@[^>]*)>?/);

      messages.push({
        id: fullMsg.id,
        threadId: fullMsg.threadId,
        subject: headers['subject'] || '(no subject)',
        from: fromMatch?.[1] || fromRaw,
        fromEmail: fromMatch?.[2] || fromRaw,
        to: (headers['to'] || '').split(',').map(s => s.trim()),
        cc: headers['cc']?.split(',').map(s => s.trim()),
        date: headers['date'] || '',
        snippet: body.slice(0, 200).replace(/\s+/g, ' ').trim(),
        body,
        bodyHtml,
        isUnread: fullMsg.labelIds?.includes('UNREAD') || false,
        isStarred: fullMsg.labelIds?.includes('STARRED') || false,
        labels: fullMsg.labelIds || [],
        hasAttachments: (fullMsg.payload.parts || []).some(p => p.filename && p.filename !== ''),
        attachments: fullMsg.payload.parts
          ?.filter(p => p.filename && p.filename !== '')
          .map(p => ({ filename: p.filename || '', mimeType: p.mimeType, size: p.body?.size || 0 })),
      });
    } catch {
      // Skip unreadable messages
    }
  }

  return { messages, nextPageToken: listData.nextPageToken };
}

async function gmailGetMessage(account: EmailAccount, messageId: string): Promise<EmailMessage> {
  const token = await getValidToken(account);
  const fullMsg = await gmailApi(`/messages/${messageId}?format=full`, token) as {
    id: string;
    threadId: string;
    labelIds: string[];
    payload: {
      headers: Array<{ name: string; value: string }>;
      parts?: Array<{ mimeType: string; body?: { data?: string; size: number }; filename?: string }>;
      body?: { data?: string };
    };
  };

  const headers = fullMsg.payload.headers.reduce((acc, h) => {
    acc[h.name.toLowerCase()] = h.value;
    return acc;
  }, {} as Record<string, string>);

  let body = '';
  let bodyHtml = '';
  if (fullMsg.payload.body?.data) {
    body = Buffer.from(fullMsg.payload.body.data, 'base64url').toString('utf-8');
    bodyHtml = body;
  }
  if (fullMsg.payload.parts) {
    for (const part of fullMsg.payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body = Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
      if (part.mimeType === 'text/html' && part.body?.data) {
        bodyHtml = Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
  }

  const fromRaw = headers['from'] || '';
  const fromMatch = fromRaw.match(/"?([^"<]*)"?\s*<?([^>]*@[^>]*)>?/);

  return {
    id: fullMsg.id,
    threadId: fullMsg.threadId,
    subject: headers['subject'] || '(no subject)',
    from: fromMatch?.[1] || fromRaw,
    fromEmail: fromMatch?.[2] || fromRaw,
    to: (headers['to'] || '').split(',').map(s => s.trim()),
    cc: headers['cc']?.split(',').map(s => s.trim()),
    date: headers['date'] || '',
    snippet: body.slice(0, 200).replace(/\s+/g, ' ').trim(),
    body,
    bodyHtml,
    isUnread: fullMsg.labelIds?.includes('UNREAD') || false,
    isStarred: fullMsg.labelIds?.includes('STARRED') || false,
    labels: fullMsg.labelIds || [],
    hasAttachments: (fullMsg.payload.parts || []).some(p => p.filename && p.filename !== ''),
    attachments: fullMsg.payload.parts
      ?.filter(p => p.filename && p.filename !== '')
      .map(p => ({ filename: p.filename || '', mimeType: p.mimeType, size: p.body?.size || 0 })),
  };
}

async function gmailSendMessage(account: EmailAccount, params: EmailSendParams): Promise<{ id: string; threadId: string }> {
  const token = await getValidToken(account);

  const boundary = `----=_Part_${Date.now()}`;
  const parts: string[] = [];

  parts.push(`From: ${account.displayName || account.email} <${account.email}>`);
  parts.push(`To: ${params.to.join(', ')}`);
  if (params.cc?.length) parts.push(`Cc: ${params.cc.join(', ')}`);
  if (params.bcc?.length) parts.push(`Bcc: ${params.bcc.join(', ')}`);
  parts.push(`Subject: ${params.subject}`);
  if (params.inReplyTo) parts.push(`In-Reply-To: ${params.inReplyTo}`);
  parts.push('MIME-Version: 1.0');

  if (params.bodyHtml) {
    parts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    parts.push('');
    parts.push(`--${boundary}`);
    parts.push('Content-Type: text/plain; charset=UTF-8');
    parts.push('');
    parts.push(params.body);
    parts.push(`--${boundary}`);
    parts.push('Content-Type: text/html; charset=UTF-8');
    parts.push('');
    parts.push(params.bodyHtml);
    parts.push(`--${boundary}--`);
  } else {
    parts.push('Content-Type: text/plain; charset=UTF-8');
    parts.push('');
    parts.push(params.body);
  }

  const rawMessage = parts.join('\r\n');
  const encodedMessage = Buffer.from(rawMessage).toString('base64url');

  const body: Record<string, unknown> = { raw: encodedMessage };
  if (params.threadId) body.threadId = params.threadId;

  const result = await gmailApi('/messages/send', token, {
    method: 'POST',
    body,
  }) as { id: string; threadId: string };

  return result;
}

async function gmailModifyMessage(
  account: EmailAccount,
  messageId: string,
  addLabels: string[],
  removeLabels: string[],
): Promise<void> {
  const token = await getValidToken(account);
  await gmailApi(`/messages/${messageId}/modify`, token, {
    method: 'POST',
    body: { addLabelIds: addLabels, removeLabelIds: removeLabels },
  });
}

async function gmailTrashMessage(account: EmailAccount, messageId: string): Promise<void> {
  const token = await getValidToken(account);
  await gmailApi(`/messages/${messageId}/trash`, token, { method: 'POST' });
}

async function gmailGetUnreadCount(account: EmailAccount): Promise<number> {
  const token = await getValidToken(account);
  const data = await gmailApi('/labels/INBOX', token) as { messagesTotal: number; threadsUnread: number };
  return data.threadsUnread || 0;
}

// ── Outlook API Implementation ──────────────────────────────────────────────

async function outlookListMessages(
  account: EmailAccount,
  params: EmailSearchParams,
): Promise<{ messages: EmailMessage[]; nextPageToken?: string }> {
  const token = await getValidToken(account);
  const filterParts: string[] = [];
  if (params.from) filterParts.push(`from/emailAddress/address eq '${params.from}'`);
  if (params.subject) filterParts.push(`contains(subject,'${params.subject}')`);
  if (params.isUnread) filterParts.push('isRead eq false');
  if (params.after) filterParts.push(`receivedDateTime ge ${params.after}`);
  if (params.before) filterParts.push(`receivedDateTime le ${params.before}`);

  const filter = filterParts.length ? `&$filter=${encodeURIComponent(filterParts.join(' and '))}` : '';
  const top = Math.min(params.maxResults || 20, 50);
  const skip = params.pageToken ? `&$skip=${params.pageToken}` : '';
  const search = params.query ? `&$search="${encodeURIComponent(params.query)}"` : '';

  const url = `/me/messages?$top=${top}${filter}${skip}${search}&$orderby=receivedDateTime desc&$select=id,subject,from,to,cc,receivedDateTime,bodyPreview,isRead,flag,importance,hasAttachments,conversationId,body`;

  const data = await outlookApi(url, token) as {
    value: Array<{
      id: string;
      subject: string;
      from: { emailAddress: { name: string; address: string } };
      toRecipients: Array<{ emailAddress: { address: string } }>;
      ccRecipients: Array<{ emailAddress: { address: string } }>;
      receivedDateTime: string;
      bodyPreview: string;
      isRead: boolean;
      flag: { flagStatus: string };
      hasAttachments: boolean;
      conversationId: string;
      body: { content: string; contentType: string };
    }>;
    '@odata.nextLink'?: string;
  };

  const messages: EmailMessage[] = data.value.map(msg => ({
    id: msg.id,
    threadId: msg.conversationId,
    subject: msg.subject || '(no subject)',
    from: msg.from?.emailAddress?.name || '',
    fromEmail: msg.from?.emailAddress?.address || '',
    to: msg.toRecipients?.map(r => r.emailAddress.address) || [],
    cc: msg.ccRecipients?.map(r => r.emailAddress.address),
    date: msg.receivedDateTime,
    snippet: msg.bodyPreview?.slice(0, 200) || '',
    body: msg.body?.contentType === 'text' ? msg.body.content : stripHtml(msg.body?.content || ''),
    bodyHtml: msg.body?.contentType === 'html' ? msg.body.content : '',
    isUnread: !msg.isRead,
    isStarred: msg.flag?.flagStatus === 'flagged',
    labels: [],
    hasAttachments: msg.hasAttachments,
  }));

  const nextLink = data['@odata.nextLink'];
  const nextPageToken = nextLink ? new URL(nextLink).searchParams.get('$skip') || undefined : undefined;

  return { messages, nextPageToken };
}

async function outlookSendMessage(account: EmailAccount, params: EmailSendParams): Promise<{ id: string }> {
  const token = await getValidToken(account);

  const emailBody: Record<string, unknown> = {
    message: {
      subject: params.subject,
      body: {
        contentType: params.bodyHtml ? 'HTML' : 'Text',
        content: params.bodyHtml || params.body,
      },
      toRecipients: params.to.map(addr => ({ emailAddress: { address: addr } })),
      ccRecipients: params.cc?.map(addr => ({ emailAddress: { address: addr } })) || [],
      bccRecipients: params.bcc?.map(addr => ({ emailAddress: { address: addr } })) || [],
    },
    saveToSentItems: true,
  };

  if (params.inReplyTo) {
    (emailBody.message as Record<string, unknown>).internetMessageHeaders = [
      { name: 'In-Reply-To', value: params.inReplyTo },
    ];
  }

  const result = await outlookApi('/me/sendMail', token, {
    method: 'POST',
    body: emailBody,
  }) as { id: string };

  return result || { id: `sent-${Date.now()}` };
}

async function outlookGetUnreadCount(account: EmailAccount): Promise<number> {
  const token = await getValidToken(account);
  const data = await outlookApi("/me/mailFolders/inbox?$select=unreadItemCount", token) as { unreadItemCount: number };
  return data.unreadItemCount || 0;
}

async function outlookModifyMessage(
  account: EmailAccount,
  messageId: string,
  markAsRead?: boolean,
): Promise<void> {
  const token = await getValidToken(account);
  await outlookApi(`/me/messages/${messageId}`, token, {
    method: 'PATCH',
    body: { isRead: markAsRead ?? true },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAccount(accountId?: string): EmailAccount {
  const accounts = loadTokens();
  const ids = Object.keys(accounts);
  if (ids.length === 0) throw new Error('No email accounts configured. Run JARVIS email setup first.');
  if (accountId) {
    const account = accounts[accountId];
    if (!account) throw new Error(`Account ${accountId} not found`);
    return account;
  }
  return accounts[ids[0]];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function listEmails(params: EmailSearchParams & { accountId?: string }): Promise<{ messages: EmailMessage[]; nextPageToken?: string }> {
  const account = getAccount(params.accountId);
  if (account.provider === 'gmail') return gmailListMessages(account, params);
  if (account.provider === 'outlook') return outlookListMessages(account, params);
  throw new Error(`Provider ${account.provider} not supported yet`);
}

export function readEmail(messageId: string, accountId?: string): Promise<EmailMessage> {
  const account = getAccount(accountId);
  if (account.provider === 'gmail') return gmailGetMessage(account, messageId);
  throw unsupportedOperation('Read', account.provider);
}

export function sendEmail(params: EmailSendParams & { accountId?: string }): Promise<{ id: string; threadId?: string }> {
  const account = getAccount(params.accountId);
  if (account.provider === 'gmail') return gmailSendMessage(account, params);
  if (account.provider === 'outlook') return outlookSendMessage(account, params);
  throw unsupportedOperation('Send', account.provider);
}

export function replyToEmail(
  messageId: string,
  body: string,
  bodyHtml?: string,
  accountId?: string,
): Promise<{ id: string; threadId?: string }> {
  const account = getAccount(accountId);
  if (account.provider === 'gmail') {
    return gmailGetMessage(account, messageId).then(msg =>
      gmailSendMessage(account, {
        to: [msg.fromEmail],
        subject: msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
        body,
        bodyHtml,
        inReplyTo: messageId,
        threadId: msg.threadId,
      }),
    );
  }
  throw unsupportedOperation('Reply', account.provider);
}

export function markAsRead(messageId: string, accountId?: string): Promise<void> {
  const account = getAccount(accountId);
  if (account.provider === 'gmail') return gmailModifyMessage(account, messageId, [], ['UNREAD']);
  if (account.provider === 'outlook') return outlookModifyMessage(account, messageId, true);
  throw unsupportedOperation('Mark as read', account.provider);
}

export function markAsUnread(messageId: string, accountId?: string): Promise<void> {
  const account = getAccount(accountId);
  if (account.provider === 'gmail') return gmailModifyMessage(account, messageId, ['UNREAD'], []);
  if (account.provider === 'outlook') return outlookModifyMessage(account, messageId, false);
  throw unsupportedOperation('Mark as unread', account.provider);
}

export function starEmail(messageId: string, accountId?: string): Promise<void> {
  const account = getAccount(accountId);
  if (account.provider === 'gmail') return gmailModifyMessage(account, messageId, ['STARRED'], []);
  throw unsupportedOperation('Star', account.provider);
}

export function unstarEmail(messageId: string, accountId?: string): Promise<void> {
  const account = getAccount(accountId);
  if (account.provider === 'gmail') return gmailModifyMessage(account, messageId, [], ['STARRED']);
  throw unsupportedOperation('Unstar', account.provider);
}

export function deleteEmail(messageId: string, accountId?: string): Promise<void> {
  const account = getAccount(accountId);
  if (account.provider === 'gmail') return gmailTrashMessage(account, messageId);
  throw unsupportedOperation('Delete', account.provider);
}

export function getUnreadCount(accountId?: string): Promise<number> {
  const account = getAccount(accountId);
  if (account.provider === 'gmail') return gmailGetUnreadCount(account);
  if (account.provider === 'outlook') return outlookGetUnreadCount(account);
  throw unsupportedOperation('Unread count', account.provider);
}

export function getRecentEmails(count: number = 10, accountId?: string): Promise<{ messages: EmailMessage[] }> {
  return listEmails({ maxResults: count, accountId });
}

export function searchEmails(query: string, accountId?: string): Promise<{ messages: EmailMessage[] }> {
  return listEmails({ query, maxResults: 20, accountId });
}

export function getAccounts(): EmailAccount[] {
  const accounts = loadTokens();
  return Object.values(accounts).map(a => ({
    ...a,
    accessToken: undefined,
    refreshToken: a.refreshToken ? '***' : undefined,
  }));
}

export function removeAccount(accountId: string): boolean {
  const accounts = loadTokens();
  if (!accounts[accountId]) return false;
  delete accounts[accountId];
  saveTokens(accounts);
  return true;
}

export function addImapAccount(config: {
  email: string;
  password: string;
  imapHost: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  displayName?: string;
}): EmailAccount {
  const account: EmailAccount = {
    id: `imap-${Date.now()}`,
    provider: 'imap',
    email: config.email,
    displayName: config.displayName,
    imapHost: config.imapHost,
    imapPort: config.imapPort || 993,
    smtpHost: config.smtpHost || config.imapHost.replace('imap', 'smtp'),
    smtpPort: config.smtpPort || 587,
    apiKey: encrypt(config.password),
  };

  const accounts = loadTokens();
  accounts[account.id] = account;
  saveTokens(accounts);

  return { ...account, apiKey: '***' };
}
