/**
 * GhostForge multi-user store.
 *
 * Users are persisted to ~/.ghostforge/users.json. Passwords are hashed with
 * Node's scrypt (salt + derived key). Sessions are stateless HMAC-signed tokens
 * verified in lib/auth.ts.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { isHostedMode } from './hosted'
import { DEFAULT_USER_PERMISSIONS } from './permissions'

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
}

const USERS_FILE = join(homedir(), '.ghostforge', 'users.json')

const DEFAULT_ADMIN_USERNAME = 'hisham'
const DEFAULT_ADMIN_NAME = 'Hisham'

/** Hosted mode never falls back to the owner's personal name */
function defaultAdminUsername(): string {
  return isHostedMode() ? 'admin' : DEFAULT_ADMIN_USERNAME
}

/** Display name for the owner account (ADMIN_NAME, else a neutral default when hosted) */
export function defaultAdminName(): string {
  return process.env.ADMIN_NAME || (isHostedMode() ? 'Admin' : DEFAULT_ADMIN_NAME)
}

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
  return (process.env.ADMIN_USERNAME || defaultAdminUsername()).toLowerCase()
}

export function isOwner(user?: Pick<GhostUser, 'username' | 'role'> | null): boolean {
  return Boolean(user && user.role === 'admin' && user.username.toLowerCase() === ownerUsername())
}

export function userIdFor(username: string): string {
  return 'u_' + createHash('sha1').update(username.toLowerCase()).digest('hex').slice(0, 12)
}

// ── store read/write ───────────────────────────────────────────────────────

interface UserFile {
  users: GhostUser[]
}

let _cache: { users: GhostUser[]; ts: number } | null = null
const CACHE_TTL = 2000

async function readUsers(): Promise<GhostUser[]> {
  const now = Date.now()
  if (_cache && now - _cache.ts < CACHE_TTL) return _cache.users
  try {
    const raw = await readFile(USERS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as UserFile
    const users = Array.isArray(parsed.users) ? parsed.users : []
    _cache = { users, ts: now }
    return users
  } catch {
    return []
  }
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

async function writeUsers(users: GhostUser[]): Promise<void> {
  await mkdir(join(homedir(), '.ghostforge'), { recursive: true })
  await writeFile(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8')
  _cache = { users, ts: Date.now() }
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
  if (users.some(u => u.role === 'admin')) return seedHostedFriends(users)

  const username = ownerUsername()
  // Hosted mode fails closed: only an explicit ADMIN_PASSWORD seeds the admin
  // (no shared ACCESS_PIN, no generated password printed to a host's logs).
  const envPassword = isHostedMode() ? process.env.ADMIN_PASSWORD : (process.env.ADMIN_PASSWORD || process.env.ACCESS_PIN)
  if (isHostedMode() && !envPassword) {
    throw new Error('[hosted] ADMIN_PASSWORD must be set to create the admin account')
  }
  let password: string
  if (!envPassword) {
    const generated = randomBytes(12).toString('base64url')
    // Shown once: the hash is persisted, so this stays the admin password.
    console.warn(`[users] No ADMIN_PASSWORD/ACCESS_PIN set — created admin "${username}" with password: ${generated} (change it in Settings → Users)`)
    password = generated
  } else {
    password = envPassword
  }
  const name = defaultAdminName()
  const admin: GhostUser = {
    id: userIdFor(username),
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
  return seedHostedFriends(users)
}

/**
 * Hosted mode on a host with an ephemeral disk (Render, Koyeb, HF Spaces…):
 * friend accounts can come from GHOSTFORGE_FRIENDS, so they survive restarts.
 * Format: "alice:<salt>:<hash>,bob:<salt>:<hash>" — password hashes only,
 * made with `node scripts/hosted-user.mjs <username>`. Missing accounts are
 * added once per value of the variable; existing ones (and their changes) are left alone.
 */
let _friendsSeededFrom: string | undefined
export function parseHostedFriends(raw: string | undefined): Array<{ username: string; passwordHash: string }> {
  return String(raw || '')
    .split(/[,\n]/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const [username, salt, hash] = entry.split(':')
      return { username: (username || '').toLowerCase(), passwordHash: `${salt}:${hash}` }
    })
    .filter(f => /^[a-z0-9][a-z0-9._-]{1,31}$/.test(f.username) && /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(f.passwordHash))
}

async function seedHostedFriends(users: GhostUser[]): Promise<GhostUser[]> {
  const raw = process.env.GHOSTFORGE_FRIENDS || ''
  if (!isHostedMode() || !raw || raw === _friendsSeededFrom) return users
  _friendsSeededFrom = raw
  const missing = parseHostedFriends(raw).filter(f => !users.some(u => u.username === f.username))
  if (!missing.length) return users
  const now = new Date().toISOString()
  const next = [...users, ...missing.map(f => ({
    id: userIdFor(f.username),
    name: f.username,
    username: f.username,
    role: 'user' as const,
    passwordHash: f.passwordHash,
    permissions: [...new Set(DEFAULT_USER_PERMISSIONS)],
    active: true,
    createdAt: now,
  }))]
  await writeUsers(next)
  return next
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
    const users = await listUsers()
    const username = input.username.trim().toLowerCase()
    if (!username || !input.password) throw new Error('Username and password are required')
    if (users.some(u => u.username === username)) throw new Error('Username already exists')
    const user: GhostUser = {
      id: userIdFor(username),
      name: input.name.trim() || username,
      username,
      role: input.role === 'admin' ? 'admin' : 'user',
      passwordHash: hashPassword(input.password),
      permissions: input.role === 'admin' ? ['*'] : (input.permissions || []),
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
  patch: Partial<Pick<GhostUser, 'name' | 'role' | 'permissions' | 'active' | 'passwordHash' | 'jobTitle' | 'profileId' | 'setupComplete'>>,
): Promise<GhostUser | null> {
  return withUsersLock(async () => {
    const users = await listUsers()
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
    users[idx] = updated
    await writeUsers(users)
    return updated
  })
}

export async function setUserPassword(id: string, newPassword: string): Promise<boolean> {
  return withUsersLock(async () => {
    const users = await listUsers()
    const idx = users.findIndex(u => u.id === id)
    if (idx === -1) return false
    users[idx].passwordHash = hashPassword(newPassword)
    await writeUsers(users)
    return true
  })
}

export async function deleteUser(id: string): Promise<boolean> {
  return withUsersLock(async () => {
    const users = await listUsers()
    const target = users.find(u => u.id === id)
    if (!target || isOwner(target)) return false
    await writeUsers(users.filter(u => u.id !== id))
    return true
  })
}

export async function touchLastSeen(id: string): Promise<void> {
  return withUsersLock(async () => {
    const users = await listUsers()
    const idx = users.findIndex(u => u.id === id)
    if (idx === -1) return
    const now = new Date().toISOString()
    if (users[idx].lastSeen === now) return
    users[idx].lastSeen = now
    users[idx].lastActive = now
    await writeUsers(users)
  })
}

export function toPublicUser(u: GhostUser): PublicUser {
  const { passwordHash: _ph, ...rest } = u
  return rest
}
