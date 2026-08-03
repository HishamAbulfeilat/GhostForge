import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, AUTH_COOKIE_NAME, createSessionToken, getAccessPin, isValidAuthToken } from '@/lib/auth'
import { ensureUserStore, getUserByUsername, verifyPassword } from '@/lib/users'

export async function POST(req: NextRequest) {
  await ensureUserStore()

  let body: { pin?: string; username?: string; password?: string }
  try {
    body = (await req.json()) as { pin?: string; username?: string; password?: string }
  } catch {
    body = {}
  }
  const pin = body.pin?.trim()

  // Legacy PIN login: maps to the default admin account.
  if (pin) {
    if (pin === getAccessPin()) {
      const admin = await getUserByUsername(process.env.ADMIN_USERNAME || 'hisham')
      if (admin) {
        const token = createSessionToken(admin)
        return setSession(token, req)
      }
    }
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 })
  }

  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
  }

  const user = await getUserByUsername(username)
  if (!user || !user.active) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

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