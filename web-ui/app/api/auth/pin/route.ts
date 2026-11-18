import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, getAccessPin } from '@/lib/auth'
import { ensureUserStore, getUserByUsername } from '@/lib/users'
import { getClientIP } from '@/lib/ratelimit'
import { clearFailedLogins, isLoginBlocked, isPinLoginBlocked, recordFailedPinLogin } from '@/lib/intrusion'
import { TOO_MANY_ATTEMPTS, failLogin, readJsonBody, safeEqual, setSession } from '@/lib/login'

const PIN_PAUSED = 'PIN sign-in is paused after too many failed attempts. Try again later or sign in with your username and password.'

/**
 * Legacy PIN sign-in: maps to the default admin account. Its failures are
 * counted globally as well as per client, so rotating addresses can't
 * brute-force a short PIN. Every request goes through the same PIN check;
 * an empty or missing PIN just fails it.
 */
export async function POST(req: NextRequest) {
  await ensureUserStore()

  if (isLoginBlocked(getClientIP(req))) {
    return NextResponse.json({ error: TOO_MANY_ATTEMPTS }, { status: 429 })
  }
  if (isPinLoginBlocked()) {
    return NextResponse.json({ error: PIN_PAUSED }, { status: 429 })
  }

  const body = await readJsonBody(req)
  const pin = String(body.pin ?? '').trim()

  const admin = safeEqual(pin, getAccessPin())
    ? await getUserByUsername(process.env.ADMIN_USERNAME || 'hisham')
    : undefined
  if (!admin) {
    recordFailedPinLogin()
    return failLogin(req, 'pin', 'Invalid PIN')
  }
  clearFailedLogins(getClientIP(req))

  const token = createSessionToken(admin)
  return setSession(token, req)
}
