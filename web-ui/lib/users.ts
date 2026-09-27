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
  if (users.some(u => u.role === 'admin')) return users

  const username = (process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME).toLowerCase()
  const envPassword = process.env.ADMIN_PASSWORD || process.env.ACCESS_PIN
  if (!envPassword) {
    const generated = randomBytes(12).toString('base64url')
    // Shown once: the hash is persisted, so this stays the admin password.
    console.warn(`[users] No ADMIN_PASSWORD/ACCESS_PIN set — created admin "${username}" with password: ${generated} (change it in Settings → Users)`)
    var password = generated
  } else {
    var password = envPassword
  }
  const name = process.env.ADMIN_NAME || DEFAULT_ADMIN_NAME
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
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<GhostUser, 'name' | 'role' | 'permissions' | 'active' | 'passwordHash'>>,
): Promise<GhostUser | null> {
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
}

export async function setUserPassword(id: string, newPassword: string): Promise<boolean> {
  const users = await listUsers()
  const idx = users.findIndex(u => u.id === id)
  if (idx === -1) return false
  users[idx].passwordHash = hashPassword(newPassword)
  await writeUsers(users)
  return true
}

export async function deleteUser(id: string): Promise<boolean> {
  const users = await listUsers()
  const target = users.find(u => u.id === id)
  if (!target || isOwner(target)) return false
  await writeUsers(users.filter(u => u.id !== id))
  return true
}

export async function touchLastSeen(id: string): Promise<void> {
  const users = await listUsers()
  const idx = users.findIndex(u => u.id === id)
  if (idx === -1) return
  const now = new Date().toISOString()
  if (users[idx].lastSeen === now) return
  users[idx].lastSeen = now
  users[idx].lastActive = now
  _cache = null
  await writeUsers(users)
}

export function toPublicUser(u: GhostUser): PublicUser {
  const { passwordHash: _ph, ...rest } = u
  return rest
}
