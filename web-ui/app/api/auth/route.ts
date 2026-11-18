import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, createSessionToken, isValidAuthToken } from '@/lib/auth'
import { ensureUserStore, getUserByUsername, verifyPassword } from '@/lib/users'
import { getClientIP } from '@/lib/ratelimit'
import { clearFailedLogins, isLoginBlocked } from '@/lib/intrusion'
import { TOO_MANY_ATTEMPTS, failLogin, readJsonBody, setSession } from '@/lib/login'

/**
 * Username and password sign-in. The legacy admin PIN has its own route,
 * /api/auth/pin, so a request can't steer which secret gets checked here.
 * A missing username or password simply fails the check (and counts as a
 * failed attempt); the login page already asks for both before sending.
 */
export async function POST(req: NextRequest) {
  await ensureUserStore()

  if (isLoginBlocked(getClientIP(req))) {
    return NextResponse.json({ error: TOO_MANY_ATTEMPTS }, { status: 429 })
  }

  const body = await readJsonBody(req)
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')

  const user = await getUserByUsername(username)
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    return failLogin(req, username, 'Invalid credentials')
  }
  clearFailedLogins(getClientIP(req))

  const token = createSessionToken(user)
  return setSession(token, req)
}

export async function GET(req: NextRequest) {
  if (isValidAuthToken(req.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
