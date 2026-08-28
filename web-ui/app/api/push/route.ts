import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'

interface PushRequestBody {
  subscription?: unknown
  notification?: {
    title?: string
    body?: string
    tag?: string
    url?: string
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = process.env.VAPID_PUBLIC_KEY || null
  return NextResponse.json({ publicKey: key, configured: Boolean(key) })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let parsed: PushRequestBody
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { subscription, notification } = parsed
  return NextResponse.json({
    ok: true,
    message: 'Subscription received',
    hasSubscription: Boolean(subscription),
    preview: notification ?? null,
  })
}
