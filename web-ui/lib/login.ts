import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { AUTH_COOKIE_NAME } from '@/lib/auth'
import { getClientIP } from '@/lib/ratelimit'
import { auditLog } from '@/lib/audit'
import { MAX_FAILED_LOGINS, recordFailedLogin, reportUnauthorizedAccess } from '@/lib/intrusion'

// Shared by the two sign-in routes: /api/auth (username and password) and
// /api/auth/pin (the legacy admin PIN). Each route checks one kind of secret,
// so nothing in a request picks which check runs.

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const TOO_MANY_ATTEMPTS = 'Too many failed attempts. Try again later.'

/**
 * Log a failed login. After MAX_FAILED_LOGINS in the window from one client it
 * is logged as unauthorized access. The caller is anonymous, so this never
 * locks the PC (that would let anyone lock it by guessing badly).
 */
export async function failLogin(req: NextRequest, username: string, error: string) {
  const ip = getClientIP(req)
  const userAgent = req.headers.get('user-agent') || undefined
  const count = recordFailedLogin(ip)
  void auditLog({ level: 'security', event: 'login_failed', ip, userAgent, params: { username }, risk: 50 })
  if (count === MAX_FAILED_LOGINS) {
    void reportUnauthorizedAccess({ reason: `${count} failed logins`, username, ip, userAgent, authenticated: false })
  }
  if (count >= MAX_FAILED_LOGINS) {
    return NextResponse.json({ error: TOO_MANY_ATTEMPTS }, { status: 429 })
  }
  return NextResponse.json({ error }, { status: 401 })
}

export function setSession(token: string, req: NextRequest) {
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

/** Read a JSON body, treating anything unreadable as empty. */
export async function readJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
