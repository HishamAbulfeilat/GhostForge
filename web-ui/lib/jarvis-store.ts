/**
 * Per-user JARVIS conversation history and knowledge vault.
 *
 *   ~/.ghostforge/users/<username>/jarvis/history.json
 *   ~/.ghostforge/users/<username>/jarvis/vault.json
 *
 * Both used to be one global file each (~/.ghostforge/jarvis/*.json) that
 * every signed-in user could read, overwrite and clear. The owner inherits
 * those old files: the first time the owner's own store is opened and does
 * not exist yet, the global file is moved there, so nobody else can see it.
 *
 * Writes are atomic (temp file with mode 0600, then rename) and run one at a
 * time per file. A file that exists but can't be parsed is never overwritten.
 */
import { randomBytes } from 'crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { isOwner, type GhostUser } from './users'

export type StoreUser = Pick<GhostUser, 'username' | 'role'>

// ── history types ──────────────────────────────────────────────────────────

export type HistoryRole = 'user' | 'ai'
export interface HistoryMessage { role: HistoryRole; content: string; ts: number }
export interface HistorySession { id: string; startedAt: string; endedAt: string; messages: HistoryMessage[] }

export const MAX_HISTORY_SESSIONS = 100

// ── vault types ────────────────────────────────────────────────────────────

export type VaultCategory = 'identity' | 'preferences' | 'projects' | 'relationships' | 'notes' | 'facts'
export interface VaultEntry { id: string; category: VaultCategory | string; key: string; value: string; ts: number }
export interface VaultStore { entries: VaultEntry[]; version: number }

export const MAX_VAULT_ENTRIES = 500

// ── paths ──────────────────────────────────────────────────────────────────

type Kind = 'history' | 'vault'

const SAFE_USERNAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

export class JarvisStoreError extends Error {}

function root() {
  return join(homedir(), '.ghostforge')
}

/** The per-user folder; refuses names that are not plain usernames. */
export function jarvisUserDir(username: string): string {
  const name = String(username || '').toLowerCase()
  if (!SAFE_USERNAME.test(name) || name.includes('..')) throw new JarvisStoreError('No per-user JARVIS store for this account')
  return join(root(), 'users', name, 'jarvis')
}

function fileFor(user: StoreUser, kind: Kind) {
  return join(jarvisUserDir(user.username), `${kind}.json`)
}

/** The old global file (before per-user stores). */
export function legacyFile(kind: Kind) {
  return join(root(), 'jarvis', `${kind}.json`)
}

// ── locking / io ───────────────────────────────────────────────────────────

const queues = new Map<string, Promise<unknown>>()
function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(file) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => {})
  queues.set(file, tail)
  void tail.then(() => { if (queues.get(file) === tail) queues.delete(file) })
  return run
}

async function readJson(file: string): Promise<unknown | undefined> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.error(`[jarvis-store] ${file} is unreadable (${(err as Error).message}); not overwriting it`)
    throw new JarvisStoreError('The saved file is unreadable; it was left as it is')
  }
}

async function writeJsonAtomic(file: string, data: unknown) {
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, file)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

/**
 * The owner inherits the old global file: move it into the owner's store the
 * first time that store is opened and does not exist. Other users start empty.
 */
async function adoptLegacy(user: StoreUser, kind: Kind, file: string) {
  if (!isOwner(user)) return
  try {
    await readFile(file)
    return // already has a store of their own
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return
  }
  try {
    await mkdir(join(file, '..'), { recursive: true, mode: 0o700 })
    await rename(legacyFile(kind), file)
  } catch { /* no legacy file (or already moved) */ }
}

async function load(user: StoreUser, kind: Kind): Promise<unknown | undefined> {
  const file = fileFor(user, kind)
  await adoptLegacy(user, kind, file)
  return readJson(file)
}

// ── history ────────────────────────────────────────────────────────────────

export function normalizeMessage(input: unknown): HistoryMessage | null {
  if (!input || typeof input !== 'object') return null
  const c = input as Partial<HistoryMessage>
  if ((c.role !== 'user' && c.role !== 'ai') || typeof c.content !== 'string' || typeof c.ts !== 'number') return null
  return { role: c.role, content: c.content, ts: c.ts }
}

export function normalizeSession(input: unknown): HistorySession | null {
  if (!input || typeof input !== 'object') return null
  const c = input as Partial<HistorySession>
  if (typeof c.id !== 'string' || typeof c.startedAt !== 'string' || typeof c.endedAt !== 'string' || !Array.isArray(c.messages)) return null
  return {
    id: c.id,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    messages: c.messages.map(normalizeMessage).filter((m): m is HistoryMessage => m !== null),
  }
}

const byNewest = (a: HistorySession, b: HistorySession) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()

function toSessions(parsed: unknown): HistorySession[] {
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeSession).filter((s): s is HistorySession => s !== null).sort(byNewest)
}

/** The user's saved sessions, newest first. */
export async function readHistory(user: StoreUser): Promise<HistorySession[]> {
  const file = fileFor(user, 'history')
  return withFileLock(file, async () => toSessions(await load(user, 'history')))
}

/** Read-modify-write the user's sessions; keeps the newest MAX_HISTORY_SESSIONS. */
export async function updateHistory(user: StoreUser, fn: (sessions: HistorySession[]) => HistorySession[]): Promise<HistorySession[]> {
  const file = fileFor(user, 'history')
  return withFileLock(file, async () => {
    const next = fn(toSessions(await load(user, 'history'))).sort(byNewest).slice(0, MAX_HISTORY_SESSIONS)
    await writeJsonAtomic(file, next)
    return next
  })
}

// ── vault ──────────────────────────────────────────────────────────────────

function toVault(parsed: unknown): VaultStore {
  const p = parsed as Partial<VaultStore> | undefined
  if (!p || !Array.isArray(p.entries)) return { entries: [], version: 1 }
  return { entries: p.entries.filter(e => e && typeof e.key === 'string' && typeof e.value === 'string'), version: typeof p.version === 'number' ? p.version : 1 }
}

export async function readVault(user: StoreUser): Promise<VaultStore> {
  const file = fileFor(user, 'vault')
  return withFileLock(file, async () => toVault(await load(user, 'vault')))
}

/** Read-modify-write the user's vault; keeps the newest MAX_VAULT_ENTRIES. */
export async function updateVault(user: StoreUser, fn: (store: VaultStore) => VaultStore | void): Promise<VaultStore> {
  const file = fileFor(user, 'vault')
  return withFileLock(file, async () => {
    const current = toVault(await load(user, 'vault'))
    const next = fn(current) || current
    if (next.entries.length > MAX_VAULT_ENTRIES) {
      next.entries = [...next.entries].sort((a, b) => b.ts - a.ts).slice(0, MAX_VAULT_ENTRIES)
    }
    await writeJsonAtomic(file, next)
    return next
  })
}

/** Insert or replace the entry with the same category + key. */
export function upsertEntry(store: VaultStore, entry: VaultEntry): VaultStore {
  const idx = store.entries.findIndex(e => e.category === entry.category && e.key === entry.key)
  if (idx >= 0) store.entries[idx] = entry
  else store.entries.push(entry)
  return store
}
