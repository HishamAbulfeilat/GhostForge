import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, getAccessPin, getAuthSecret, isAuthorizedRequest } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { pin?: string }
  const pin = body.pin?.trim()

  if (pin === getAccessPin()) {
    const response = NextResponse.json({ ok: true })
    response.cookies.set(AUTH_COOKIE_NAME, getAuthSecret(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
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
