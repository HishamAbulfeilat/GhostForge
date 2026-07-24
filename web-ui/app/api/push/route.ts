import { NextRequest, NextResponse } from 'next/server'

interface PushRequestBody {
  subscription?: unknown
  notification?: {
    title?: string
    body?: string
    tag?: string
    url?: string
  }
}

export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY || null
  return NextResponse.json({ publicKey: key, configured: Boolean(key) })
}

export async function POST(req: NextRequest) {
  const { subscription, notification } = await req.json() as PushRequestBody
  return NextResponse.json({
    ok: true,
    message: 'Subscription received',
    hasSubscription: Boolean(subscription),
    preview: notification ?? null,
  })
}
