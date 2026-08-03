/**
 * Per-user inbox. Messages delivered between GhostForge users are persisted to
 * ~/.ghostforge/users/<username>/inbox.json so a user's JARVIS can surface
 * messages sent by other users (e.g. "say hello to feras").
 */
import { mkdir, readFile, writeFile, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export interface InboxMessage {
  id: string
  from: string
  to: string
  text: string
  ts: string
  read: boolean
}

function inboxPath(username: string): string {
  return join(homedir(), '.ghostforge', 'users', username.toLowerCase(), 'inbox.json')
}

const MAX_INBOX = 200

async function readInbox(username: string): Promise<InboxMessage[]> {
  const p = inboxPath(username)
  try {
    await stat(p)
    const raw = await readFile(p, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as InboxMessage[]) : []
  } catch {
    return []
  }
}

async function writeInbox(username: string, messages: InboxMessage[]): Promise<void> {
  const p = inboxPath(username)
  await mkdir(join(p, '..'), { recursive: true })
  const trimmed = messages.slice(-MAX_INBOX)
  await writeFile(p, JSON.stringify(trimmed, null, 2), 'utf8')
}

export async function getInbox(username: string, includeRead = false): Promise<InboxMessage[]> {
  const messages = await readInbox(username)
  return includeRead ? messages : messages.filter(m => !m.read)
}

export async function unreadCount(username: string): Promise<number> {
  const messages = await readInbox(username)
  return messages.filter(m => !m.read).length
}

export async function deliverMessage(
  toUsername: string,
  fromUsername: string,
  text: string,
): Promise<InboxMessage> {
  const messages = await readInbox(toUsername)
  const msg: InboxMessage = {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    from: fromUsername,
    to: toUsername.toLowerCase(),
    text,
    ts: new Date().toISOString(),
    read: false,
  }
  messages.push(msg)
  await writeInbox(toUsername, messages)
  return msg
}

export async function markInboxRead(username: string, id?: string): Promise<void> {
  const messages = await readInbox(username)
  if (id) {
    const idx = messages.findIndex(m => m.id === id)
    if (idx !== -1) messages[idx].read = true
  } else {
    messages.forEach(m => { m.read = true })
  }
  await writeInbox(username, messages)
}
