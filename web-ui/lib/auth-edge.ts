/**
 * Edge-safe session token helpers for Next.js middleware.
 *
 * Middleware runs on the Edge runtime, which does NOT support Node's `crypto`
 * module (createHmac) or the `os`/`fs` modules. So we sign/verify tokens with
 * the global Web Crypto API (`crypto.subtle`), which is available in BOTH the
 * Edge runtime and Node (>=18).
 *
 * These functions are async (Web Crypto is promise-based). Node-runtime routes
 * should keep using the synchronous helpers in `lib/auth.ts`.
 */
import { getAuthSecret } from './auth-secret'

export { getAuthSecret }

export const AUTH_COOKIE = 'gf_token'
export const AUTH_COOKIE_NAME = 'gf_token'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export type SessionRole = 'admin' | 'user'

export interface SessionPayload {
  sub: string
  name: string
  username: string
  role: SessionRole
  iat: number
  exp: number
}

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()
function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

async function sign(payload: string): Promise<string> {
  const secret = getAuthSecret()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return b64url(new Uint8Array(sig))
}

function timingSafe(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Create a signed session token (accepts `id` like GhostUser or `sub`) */
export async function createSessionToken(
  user: Pick<SessionPayload, 'name' | 'username' | 'role'> & { id?: string; sub?: string },
): Promise<string> {
  const now = Date.now()
  const payload: SessionPayload = {
    sub: user.sub || user.id || '',
    name: user.name,
    username: user.username,
    role: user.role,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + SESSION_TTL_MS) / 1000),
  }
  const body = b64url(encoder.encode(JSON.stringify(payload)))
  return `${body}.${await sign(body)}`
}

/** Verify a session token — stateless, async, safe for Edge middleware */
export async function verifySessionToken(token?: string | null): Promise<SessionPayload | null> {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = fromB64url(await sign(body))
  const given = fromB64url(sig)
  if (!timingSafe(expected, given)) return null
  try {
    const payload = JSON.parse(bytesToUtf8(fromB64url(body))) as SessionPayload
    if (!payload?.sub || typeof payload.exp !== 'number') return null
    if (payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export async function isValidAuthToken(token?: string | null): Promise<boolean> {
  return Boolean(token && await verifySessionToken(token))
}