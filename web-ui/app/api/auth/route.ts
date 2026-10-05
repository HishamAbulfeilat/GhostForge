import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, AUTH_COOKIE_NAME, createSessionToken, getAccessPin, isValidAuthToken } from '@/lib/auth'
import { ensureUserStore, getUserByUsername, ownerUsername, verifyPassword } from '@/lib/users'
import { isHostedMode } from '@/lib/hosted'
import { timingSafeEqual } from 'crypto'
import { getClientIP } from '@/lib/ratelimit'
import { auditLog } from '@/lib/audit'
import { MAX_FAILED_LOGINS, clearFailedLogins, isLoginBlocked, recordFailedLogin, reportUnauthorizedAccess } from '@/lib/intrusion'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * Log a failed login. After MAX_FAILED_LOGINS in the window from one IP it is
 * treated as an intrusion: logged as unauthorized access and the PC is locked.
 */
async function failLogin(req: NextRequest, username: string, error: string) {
  const ip = getClientIP(req)
  const userAgent = req.headers.get('user-agent') || undefined
  const count = recordFailedLogin(ip)
  void auditLog({ level: 'security', event: 'login_failed', ip, userAgent, params: { username }, risk: 50 })
  if (count === MAX_FAILED_LOGINS) {
    void reportUnauthorizedAccess({ reason: `${count} failed logins`, username, ip, userAgent })
  }
  if (count >= MAX_FAILED_LOGINS) {
    return NextResponse.json({ error: 'Too many failed attempts. Try again later.' }, { status: 429 })
  }
  return NextResponse.json({ error }, { status: 401 })
}

export async function POST(req: NextRequest) {
  await ensureUserStore()

  if (isLoginBlocked(getClientIP(req))) {
    return NextResponse.json({ error: 'Too many failed attempts. Try again later.' }, { status: 429 })
  }

  let body: { pin?: string; username?: string; password?: string }
  try {
    body = (await req.json()) as { pin?: string; username?: string; password?: string }
  } catch {
    body = {}
  }
  const pin = body.pin?.trim()

  // Legacy PIN login: maps to the default admin account. Off when hosted —
  // a shared PIN would hand any friend the owner's admin account.
  if (pin && isHostedMode()) {
    return NextResponse.json({ error: 'PIN sign-in is not available on the hosted version — use your username and password' }, { status: 403 })
  }
  if (pin) {
    if (safeEqual(pin, getAccessPin())) {
      const admin = await getUserByUsername(ownerUsername())
      if (admin) {
        clearFailedLogins(getClientIP(req))
        const token = createSessionToken(admin)
        return setSession(token, req)
      }
    }
    return failLogin(req, 'pin', 'Invalid PIN')
  }

  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
  }

  const user = await getUserByUsername(username)
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    return failLogin(req, username, 'Invalid credentials')
  }
  clearFailedLogins(getClientIP(req))

  const token = createSessionToken(user)
  return setSession(token, req)
}

function setSession(token: string, req: NextRequest) {
  const response = NextResponse.json({ ok: true })
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const isSecure = forwardedProto ? forwardedProto === 'https' : req.nextUrl.protocol === 'https:'
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  })
  return response
}

export async function GET(req: NextRequest) {
  if (isValidAuthToken(req.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}