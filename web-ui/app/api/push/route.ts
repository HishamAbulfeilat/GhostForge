import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { getCurrentUser, isAuthorizedRequest } from '@/lib/auth'
import {
  isPushConfigured,
  isValidSubscription,
  listSubscriptions,
  removeSubscription,
  saveSubscription,
  sendToUser,
} from '@/lib/push'

export const runtime = 'nodejs'

interface PushRequestBody {
  subscription?: unknown
  endpoint?: unknown
  notification?: {
    title?: string
    body?: string
    tag?: string
    url?: string
  }
}

const NOT_CONFIGURED = 'Push notifications are not configured: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the server.'

/** Config + the caller's own subscription count, so the panel can be honest. */
export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const configured = isPushConfigured()
  const subscriptions = await listSubscriptions(user.username)
  return NextResponse.json({
    publicKey: configured ? process.env.VAPID_PUBLIC_KEY! : null,
    configured,
    subscriptions: subscriptions.length,
  })
}

/**
 * `subscription: <object>` stores it for the caller,
 * `subscription: null` (+ optional `endpoint`) removes it, and
 * `notification: { title, body }` sends a real push via web-push.
 *
 * Storing never requires VAPID keys — only sending does, and sending without
 * them answers 501 with `configured: false` rather than reporting success.
 */
export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let parsed: PushRequestBody
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { subscription, notification } = parsed
  const wantsSend = Boolean(notification)
  const configured = isPushConfigured()

  // ── send a notification ────────────────────────────────────────────────
  if (wantsSend) {
    if (!configured) {
      return NextResponse.json({ error: NOT_CONFIGURED, configured: false, sent: false }, { status: 501 })
    }
    const title = notification?.title?.trim() || 'GhostForge'
    const body = notification?.body?.trim() || 'New notification'
    const summary = await sendToUser(user.username, { title, body, tag: notification?.tag, url: notification?.url })
    return NextResponse.json({ ok: true, configured: true, ...summary })
  }

  // ── remove a subscription ──────────────────────────────────────────────
  if (subscription === null) {
    const endpoint = typeof parsed.endpoint === 'string' ? parsed.endpoint : undefined
    const remaining = await removeSubscription(user.username, endpoint)
    return NextResponse.json({ ok: true, subscription: null, subscriptions: remaining.length })
  }

  // ── store a subscription ───────────────────────────────────────────────
  if (!isValidSubscription(subscription)) {
    return NextResponse.json(
      { error: 'A push subscription with an https endpoint and p256dh/auth keys is required.' },
      { status: 400 },
    )
  }

  const stored = await saveSubscription(
    user.username,
    subscription,
    req.headers.get('user-agent') || undefined,
  )
  return NextResponse.json({
    ok: true,
    message: 'Subscription received',
    hasSubscription: true,
    subscriptions: stored.length,
    // Storing works without VAPID keys; sending does not.
    configured,
    ...(configured ? {} : { warning: NOT_CONFIGURED }),
  })
}