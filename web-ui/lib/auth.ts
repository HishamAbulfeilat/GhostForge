/**
 * GhostForge authentication (Node runtime — server components & API routes).
 *
 * Sessions are stateless HMAC-signed tokens carried in an httpOnly cookie
 * (gf_token). The token payload carries the user id, role, and a checksum so
 * middleware (Edge runtime) can verify validity without touching disk, while
 * these Node helpers resolve the full user + permission set.
 *
 * NOTE: Middleware must NOT import this module (it pulls in Node `os`/`fs` via
 * `./users` and Node `crypto` via createHmac). Middleware uses the async,
 * Web-Crypto-only helpers in `lib/auth-edge.ts` instead. Tokens are mutually
 * compatible because both sign HMAC-SHA256 with the same base64url format.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { getAuthSecret } from './auth-secret'
import { AUTH_COOKIE, AUTH_COOKIE_NAME, type SessionRole } from './auth-edge'
import { ensureUserStore, getUserById, type GhostUser, type Role, toPublicUser, touchLastSeen } from './users'

export { getAuthSecret, AUTH_COOKIE, AUTH_COOKIE_NAME }
export type { SessionRole }

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface SessionPayload {
  sub: string
  name: string
  username: string
  role: Role
  iat: number
  exp: number
  /** Set on sessions created by pairing a phone/tablet; revoking the device ends the session. */
  dev?: string
}

let devPin: string | undefined

export function getAccessPin() {
  const pin = process.env.ACCESS_PIN
  if (!pin) {
    if (process.env.NODE_ENV === 'production') throw new Error('ACCESS_PIN not set. Set ACCESS_PIN in production to authenticate access.')
    // `next dev` gets a per-run PIN from next.config.mjs (printed at startup)
    if (process.env.GF_DEV_ACCESS_PIN) return process.env.GF_DEV_ACCESS_PIN
    if (!devPin) {
      devPin = `dev-${randomBytes(4).toString('hex')}`
      if (process.env.NODE_ENV !== 'test') console.warn(`[auth] ACCESS_PIN not set — dev PIN for this run: ${devPin}`)
    }
    return devPin
  }
  if (pin.length < 4) throw new Error('ACCESS_PIN must be at least 4 characters')
  return pin
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}
function fromB64url(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

function sign(payload: string): string {
  return createHmac('sha256', getAuthSecret()).update(payload).digest('base64url')
}

/** Create a signed session token for a user (sync, Node runtime) */
export function createSessionToken(user: Pick<GhostUser, 'id' | 'name' | 'username' | 'role'>, opts: { deviceId?: string } = {}): string {
  const now = Date.now()
  const payload: SessionPayload = {
    sub: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + SESSION_TTL_MS) / 1000),
    ...(opts.deviceId ? { dev: opts.deviceId } : {}),
  }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

/** Verify a session token (sync, Node runtime) */
export function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = Buffer.from(sign(body))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as SessionPayload
    if (payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/**
 * Classify a session token. `forged` means it is present but its signature or
 * payload is invalid — a tampering signal, unlike an ordinary missing/expired token.
 */
export function sessionTokenStatus(token?: string | null): 'missing' | 'forged' | 'expired' | 'valid' {
  if (!token) return 'missing'
  const [body, sig] = token.split('.')
  if (!body || !sig) return 'forged'
  const expected = Buffer.from(sign(body))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'forged'
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as SessionPayload
    return payload.exp * 1000 < Date.now() ? 'expired' : 'valid'
  } catch {
    return 'forged'
  }
}

export function isValidAuthToken(token?: string | null) {
  return Boolean(token && verifySessionToken(token))
}

/**
 * Synchronous auth guard used by the existing API routes. Verifies a valid
 * session token in the request cookie. (Does not re-load the user from disk.)
 */
export function isAuthorizedRequest(req: NextRequest) {
  return isValidAuthToken(req.cookies.get(AUTH_COOKIE_NAME)?.value)
}

/**
 * Async auth guard that also re-loads the user from disk. Use this when you
 * need the caller's role/permissions (e.g. admin-only endpoints).
 */
export async function requireCurrentUser(req: NextRequest): Promise<GhostUser | null> {
  return getCurrentUser(req)
}

/**
 * Resolve the current user for a request. Verifies the token, re-loads the
 * user from disk (so deactivation / permission changes take effect), touches
 * lastSeen, and returns the full GhostUser or null.
 */
export async function getCurrentUser(req: NextRequest): Promise<GhostUser | null> {
  const payload = verifySessionToken(req.cookies.get(AUTH_COOKIE_NAME)?.value)
  if (!payload) return null
  const user = await getUserById(payload.sub)
  if (!user || !user.active) return null
  if (user.username !== payload.username) return null
  if (payload.dev && !(await deviceSessionValid(payload.dev))) return null
  void touchLastSeen(user.id).catch(() => {})
  return user
}

/** A paired-device session is valid while its device is not revoked. */
async function deviceSessionValid(deviceId: string): Promise<boolean> {
  const { isDeviceRevoked, touchDevice } = await import('./remote/store')
  if (await isDeviceRevoked(deviceId)) return false
  void touchDevice(deviceId)
  return true
}

/** Convenience: any valid session (kept for compatibility with older guards) */
export async function isAuthenticatedSession() {
  const { cookies } = await import('next/headers')
  const store = await cookies()
  return isValidAuthToken(store.get(AUTH_COOKIE_NAME)?.value)
}

/** Resolve current user from the Next.js cookie store (server components) */
export async function getSessionUser(): Promise<GhostUser | null> {
  await ensureUserStore()
  const { cookies } = await import('next/headers')
  const store = await cookies()
  const payload = verifySessionToken(store.get(AUTH_COOKIE_NAME)?.value)
  if (!payload) return null
  const user = await getUserById(payload.sub)
  if (!user || !user.active) return null
  if (payload.dev && !(await deviceSessionValid(payload.dev))) return null
  return user
}

export function isAdmin(user?: Pick<GhostUser, 'role'> | null): boolean {
  return user?.role === 'admin'
}

export function hasPermission(user: Pick<GhostUser, 'role' | 'permissions'> | null | undefined, key: string): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  return Array.isArray(user.permissions) && user.permissions.includes(key)
}

export { toPublicUser }
