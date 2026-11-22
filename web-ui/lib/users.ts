/**
 * GhostForge multi-user store.
 *
 * Users are persisted to ~/.ghostforge/users.json. Passwords are hashed with
 * Node's scrypt (salt + derived key). Sessions are stateless HMAC-signed tokens
 * verified in lib/auth.ts.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export type Role = 'admin' | 'user'

export interface GhostUser {
  id: string
  name: string
  username: string
  role: Role
  passwordHash: string
  permissions: string[]
  active: boolean
  createdAt: string
  lastSeen?: string
  lastActive?: string
  /** Set by the setup wizard */
  jobTitle?: string
  profileId?: string
  setupComplete?: boolean
  /**
   * True once the owner has set this account's permissions explicitly (created
   * with a permission list, or edited on the Users page). The setup wizard then
   * leaves them exactly as assigned instead of applying a job-title profile.
   */
  permissionsAssigned?: boolean
  /**
   * Carried in every session token. Bumped when the account is deactivated or
   * its password changes, which ends every session issued before. Missing
   * (accounts and tokens from before this field existed) counts as 0.
   */
  sessionVersion?: number
}

export interface PublicUser {
  id: string
  name: string
  username: string
  role: Role
  permissions: string[]
  active: boolean
  createdAt: string
  lastSeen?: string
  jobTitle?: string
  profileId?: string
  setupComplete?: boolean
  permissionsAssigned?: boolean
}

const USERS_FILE = join(homedir(), '.ghostforge', 'users.json')

const DEFAULT_ADMIN_USERNAME = 'hisham'
const DEFAULT_ADMIN_NAME = 'Hisham'

// ── password hashing (scrypt) ──────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

/**
 * The owner is the one account allowed to manage other users' permissions and
 * access. Other admins keep full tool access but cannot edit users.
 */
export function ownerUsername(): string {
  return (process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME).toLowerCase()
}

export function isOwner(user?: Pick<GhostUser, 'username' | 'role'> | null): boolean {
  return Boolean(user && user.role === 'admin' && user.username.toLowerCase() === ownerUsername())
}

/**
 * The id older versions derived from the username. Existing accounts keep
 * these ids (they are only ever looked up, never recomputed); new accounts get
 * random ids, so deleting "sara" and creating a new "sara" can't make the old
 * person's session cookie valid for the new account.
 */
export function userIdFor(username: string): string {
  return 'u_' + createHash('sha1').update(username.toLowerCase()).digest('hex').slice(0, 12)
}

/** A fresh random user id that no existing account (or legacy id) uses. */
export function newUserId(existing: Pick<GhostUser, 'id'>[] = []): string {
  const taken = new Set(existing.map(u => u.id))
  for (;;) {
    const id = 'u_' + randomBytes(10).toString('hex')
    if (!taken.has(id)) return id
  }
}

/** The account's current session version (0 when never set). */
export function sessionVersionOf(user: Pick<GhostUser, 'sessionVersion'>): number {
  const v = user.sessionVersion
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0
}

// ── store read/write ───────────────────────────────────────────────────────

interface UserFile {
  users: GhostUser[]
}

let _cache: { users: GhostUser[]; ts: number } | null = null
const CACHE_TTL = 2000

/**
 * Read the store. Only a missing file means "no users yet" (the caller seeds
 * the default admin). A file that exists but cannot be read or parsed must
 * never look empty — that used to re-seed the store and wipe every account —
 * so we keep serving the last good copy, or throw when there is none.
 */
async function readUsers(): Promise<GhostUser[]> {
  const now = Date.now()
  if (_cache && now - _cache.ts < CACHE_TTL) return _cache.users
  let raw: string
  try {
    raw = await readFile(USERS_FILE, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    if (_cache) return _cache.users
    throw err
  }
  let parsed: UserFile
  try {
    parsed = JSON.parse(raw) as UserFile
    if (!parsed || !Array.isArray(parsed.users)) throw new Error('users.json has no "users" array')
  } catch (err) {
    console.error(`[users] ${USERS_FILE} is unreadable (${(err as Error).message}); not re-seeding`)
    if (_cache) return _cache.users
    throw new Error(`User store ${USERS_FILE} is corrupt; fix or restore it (it was not overwritten)`)
  }
  _cache = { users: parsed.users, ts: now }
  return parsed.users
}

/**
 * Runs read-modify-write operations on the user store one at a time. Without
 * it, the background touchLastSeen() that getCurrentUser() fires on every
 * request could write a stale copy over a concurrent updateUser() (e.g. the
 * setupComplete flag from POST /api/setup was lost, so setup never finished).
 */
let _writeQueue: Promise<unknown> = Promise.resolve()
function withUsersLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _writeQueue.then(fn, fn)
  _writeQueue = run.catch(() => {})
  return run
}

/**
 * Atomic write: a reader sees either the old file or the new one, never a
 * truncated or half-written file (temp file with mode 0600, then rename).
 */
async function writeUsers(users: GhostUser[]): Promise<void> {
  await mkdir(join(homedir(), '.ghostforge'), { recursive: true, mode: 0o700 })
  const tmp = `${USERS_FILE}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tmp, JSON.stringify({ users }, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, USERS_FILE)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
  _cache = { users, ts: Date.now() }
  _syncSnapshot = null
}

// ── synchronous lookup for the per-request token check ─────────────────────

/**
 * The token check in lib/auth.ts (isAuthorizedRequest / isValidAuthToken) is
 * synchronous and runs on every API request, so it reads users.json
 * synchronously and keeps the parsed copy until the file changes on disk
 * (writes are atomic renames, so any change gives a new inode / mtime).
 */
let _syncSnapshot: { key: string; byId: Map<string, GhostUser> } | null = null

/**
 * The stored account with this id, read synchronously, or null when there is
 * none. Never seeds: a missing store has no accounts, and a store that can't
 * be parsed keeps the last good copy (or, with none, has no accounts, so every
 * session is refused rather than guessed at).
 */
export function getUserByIdSync(id: string): GhostUser | null {
  let key: string
  try {
    const st = statSync(USERS_FILE)
    key = `${st.ino}:${st.mtimeMs}:${st.size}`
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    return _syncSnapshot?.byId.get(id) ?? null
  }
  if (!_syncSnapshot || _syncSnapshot.key !== key) {
    try {
      const parsed = JSON.parse(readFileSync(USERS_FILE, 'utf8')) as UserFile
      if (!parsed || !Array.isArray(parsed.users)) throw new Error('users.json has no "users" array')
      _syncSnapshot = { key, byId: new Map(parsed.users.filter(u => u && typeof u.id === 'string').map(u => [u.id, u])) }
    } catch (err) {
      console.error(`[users] ${USERS_FILE} is unreadable (${(err as Error).message}); keeping the last good copy for session checks`)
      return _syncSnapshot?.byId.get(id) ?? null
    }
  }
  return _syncSnapshot.byId.get(id) ?? null
}

// ── bootstrap ──────────────────────────────────────────────────────────────

/**
 * Ensure the store exists with a default admin. When the admin has no password
 * yet (or was created with a placeholder), the caller seeds it from env:
 *   ADMIN_USERNAME (default "hisham"), ADMIN_PASSWORD, ADMIN_NAME
 * Returns the admin user.
 */
export async function ensureUserStore(): Promise<GhostUser[]> {
  const users = await readUsers()
  if (users.some(u => u.role === 'admin')) return users
  // Seed under the lock so it can't race a concurrent write.
  return withUsersLock(loadUsersLocked)
}

/**
 * Read the store and seed the default admin when there is none. Callers must
 * already hold withUsersLock (the lock is not re-entrant).
 */
async function loadUsersLocked(): Promise<GhostUser[]> {
  const users = await readUsers()
  if (users.some(u => u.role === 'admin')) return users

  const username = (process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME).toLowerCase()
  const envPassword = process.env.ADMIN_PASSWORD || process.env.ACCESS_PIN
  let password: string
  if (!envPassword) {
    const generated = randomBytes(12).toString('base64url')
    // Shown once: the hash is persisted, so this stays the admin password.
    console.warn(`[users] No ADMIN_PASSWORD/ACCESS_PIN set — created admin "${username}" with password: ${generated} (change it in Settings → Users)`)
    password = generated
  } else {
    password = envPassword
    if (password.length < 8) {
      console.warn(`[users] WARNING: the first admin password (ADMIN_PASSWORD or ACCESS_PIN) is shorter than 8 characters. Change it in Settings → Users.`)
    }
  }
  const name = process.env.ADMIN_NAME || DEFAULT_ADMIN_NAME
  const admin: GhostUser = {
    id: newUserId(users),
    name,
    username,
    role: 'admin',
    passwordHash: hashPassword(password),
    permissions: ['*'],
    active: true,
    createdAt: new Date().toISOString(),
  }
  users.push(admin)
  await writeUsers(users)
  return users
}

// ── queries ────────────────────────────────────────────────────────────────

export async function listUsers(): Promise<GhostUser[]> {
  await ensureUserStore()
  return readUsers()
}

export async function getUserById(id: string): Promise<GhostUser | null> {
  const users = await listUsers()
  return users.find(u => u.id === id) || null
}

export async function getUserByUsername(username: string): Promise<GhostUser | null> {
  const users = await listUsers()
  return users.find(u => u.username.toLowerCase() === String(username).toLowerCase().trim()) || null
}

export async function findUserByNameOrUsername(term: string): Promise<GhostUser | null> {
  const users = await listUsers()
  const t = String(term).toLowerCase().trim()
  return (
    users.find(u => u.username.toLowerCase() === t) ||
    users.find(u => u.name.toLowerCase() === t) ||
    users.find(u => u.name.toLowerCase().includes(t) || u.username.toLowerCase().includes(t)) ||
    null
  )
}

export async function createUser(input: {
  name: string
  username: string
  password: string
  role?: Role
  permissions?: string[]
  active?: boolean
}): Promise<GhostUser> {
  return withUsersLock(async () => {
    const users = await loadUsersLocked()
    const username = input.username.trim().toLowerCase()
    if (!username || !input.password) throw new Error('Username and password are required')
    if (users.some(u => u.username === username)) throw new Error('Username already exists')
    const user: GhostUser = {
      id: newUserId(users),
      name: input.name.trim() || username,
      username,
      role: input.role === 'admin' ? 'admin' : 'user',
      passwordHash: hashPassword(input.password),
      permissions: input.role === 'admin' ? ['*'] : (input.permissions || []),
      ...(input.role !== 'admin' && Array.isArray(input.permissions) ? { permissionsAssigned: true } : {}),
      active: input.active !== false,
      createdAt: new Date().toISOString(),
    }
    users.push(user)
    await writeUsers(users)
    return user
  })
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<GhostUser, 'name' | 'role' | 'permissions' | 'active' | 'passwordHash' | 'jobTitle' | 'profileId' | 'setupComplete' | 'permissionsAssigned'>>,
): Promise<GhostUser | null> {
  return withUsersLock(async () => {
    const users = await loadUsersLocked()
    const idx = users.findIndex(u => u.id === id)
    if (idx === -1) return null
    const current = users[idx]
    // The owner account is always an active admin
    if (isOwner(current)) {
      patch = { ...patch, role: 'admin', active: true, permissions: ['*'] }
    }
    const role: Role = patch.role === 'admin' || patch.role === 'user' ? patch.role : current.role
    // Demoting an admin drops the '*' wildcard — fall back to the supplied set (or none)
    const basePermissions = patch.permissions ?? current.permissions
    const permissions = role === 'admin' ? ['*'] : basePermissions.filter(p => p !== '*')
    const updated: GhostUser = { ...current, ...patch, role, permissions }
    // Deactivating the account or changing its password ends its sessions.
    const deactivated = current.active !== false && updated.active === false
    const passwordChanged = patch.passwordHash !== undefined && patch.passwordHash !== current.passwordHash
    if (deactivated || passwordChanged) updated.sessionVersion = sessionVersionOf(current) + 1
    users[idx] = updated
    await writeUsers(users)
    return updated
  })
}

export async function setUserPassword(id: string, newPassword: string): Promise<boolean> {
  return withUsersLock(async () => {
    const users = await loadUsersLocked()
    const idx = users.findIndex(u => u.id === id)
    if (idx === -1) return false
    users[idx].passwordHash = hashPassword(newPassword)
    // A new password ends every session signed in with the old one.
    users[idx].sessionVersion = sessionVersionOf(users[idx]) + 1
    await writeUsers(users)
    return true
  })
}

export async function deleteUser(id: string): Promise<boolean> {
  return withUsersLock(async () => {
    const users = await loadUsersLocked()
    const target = users.find(u => u.id === id)
    if (!target || isOwner(target)) return false
    await writeUsers(users.filter(u => u.id !== id))
    return true
  })
}

/** lastSeen is rewritten at most once per this interval per user. */
export const LAST_SEEN_INTERVAL_MS = 60_000
const _lastSeenWrites = new Map<string, number>()

/**
 * Record activity. getCurrentUser() calls this on every authenticated request,
 * so it is throttled: rewriting users.json on every API call made the store
 * churn constantly (and, before writes were atomic, could wipe it).
 */
export async function touchLastSeen(id: string, nowMs = Date.now()): Promise<void> {
  const last = _lastSeenWrites.get(id)
  if (last !== undefined && nowMs - last < LAST_SEEN_INTERVAL_MS) return
  _lastSeenWrites.set(id, nowMs)
  if (_lastSeenWrites.size > 10_000) _lastSeenWrites.clear()
  return withUsersLock(async () => {
    const users = await loadUsersLocked()
    const idx = users.findIndex(u => u.id === id)
    if (idx === -1) return
    const now = new Date(nowMs).toISOString()
    if (users[idx].lastSeen === now) return
    users[idx].lastSeen = now
    users[idx].lastActive = now
    await writeUsers(users)
  })
}

export function toPublicUser(u: GhostUser): PublicUser {
  const { passwordHash: _ph, sessionVersion: _sv, ...rest } = u
  return rest
}
