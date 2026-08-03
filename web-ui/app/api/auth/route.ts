import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, AUTH_COOKIE_NAME, getAccessPin, getAuthSecret, isAuthorizedRequest } from '@/lib/auth'

export async function POST(req: NextRequest) {
  if (!process.env.ACCESS_PIN || !process.env.AUTH_SECRET) {
    console.warn('[auth] Using default credentials — set ACCESS_PIN and AUTH_SECRET before deploying to production.')
  }

  const body = (await req.json()) as { pin?: string }
  const pin = body.pin?.trim()

  if (pin === getAccessPin()) {
    const response = NextResponse.json({ ok: true })
    const forwardedProto = req.headers.get('x-forwarded-proto')
    const isSecure = forwardedProto ? forwardedProto === 'https' : req.nextUrl.protocol === 'https:'
    response.cookies.set(AUTH_COOKIE_NAME, getAuthSecret(), {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    })
    return response
  }

  return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  if (isAuthorizedRequest(req)) {
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
