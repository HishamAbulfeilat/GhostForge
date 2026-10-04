/**
 * GhostForge web-push backend.
 *
 * Subscriptions are persisted per user at
 * ~/.ghostforge/users/<username>/push-subscriptions.json, mirroring how
 * `lib/devices.ts` stores its per-user registry, so a user keeps their
 * subscriptions across restarts and devices never leak across users.
 *
 * Sending is only possible when the instance has VAPID keys
 * (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Without them we stay HONEST: we still
 * store subscriptions, but every send reports `configured: false` instead of
 * pretending a notification went out.
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export interface PushSubscriptionRecord {
  endpoint: string
  keys: { p256dh: string; auth: string }
  createdAt: string
  updatedAt: string
  userAgent?: string
}

interface PushSubscriptionFile {
  subscriptions: PushSubscriptionRecord[]
}

const _cache = new Map<string, { subscriptions: PushSubscriptionRecord[]; ts: number }>()
const CACHE_TTL = 2000

/** Push services report gone/replaced endpoints with these HTTP statuses. */
const GONE_STATUSES = new Set([404, 410])

export function subscriptionsFile(username: string): string {
  return join(homedir(), '.ghostforge', 'users', String(username).toLowerCase(), 'push-subscriptions.json')
}

/** The VAPID identity of this instance, or null when it is not configured. */
export function getVapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return null
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@localhost'
  return { publicKey, privateKey, subject }
}

export function isPushConfigured(): boolean {
  return getVapidConfig() !== null
}

async function readSubscriptions(username: string): Promise<PushSubscriptionRecord[]> {
  const file = subscriptionsFile(username)
  const cached = _cache.get(file)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.subscriptions
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as PushSubscriptionFile
    const subscriptions = Array.isArray(parsed.subscriptions) ? parsed.subscriptions : []
    _cache.set(file, { subscriptions, ts: Date.now() })
    return subscriptions
  } catch {
    return []
  }
}

async function writeSubscriptions(username: string, subscriptions: PushSubscriptionRecord[]): Promise<void> {
  const file = subscriptionsFile(username)
  await mkdir(join(homedir(), '.ghostforge', 'users', String(username).toLowerCase()), { recursive: true })
  await writeFile(file, JSON.stringify({ subscriptions }, null, 2), 'utf8')
  _cache.set(file, { subscriptions, ts: Date.now() })
}

/** Minimal structural validation of a browser PushSubscription payload. */
export function isValidSubscription(value: unknown): value is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  if (typeof candidate.endpoint !== 'string' || !candidate.endpoint.startsWith('https://')) return false
  const keys = candidate.keys
  if (!keys || typeof keys !== 'object') return false
  return typeof keys.p256dh === 'string' && keys.p256dh.length > 0
    && typeof keys.auth === 'string' && keys.auth.length > 0
}

/** Add or refresh a subscription for a user. Endpoint is the natural key. */
export async function saveSubscription(
  username: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string,
): Promise<PushSubscriptionRecord[]> {
  const subscriptions = await readSubscriptions(username)
  const now = new Date().toISOString()
  const existing = subscriptions.find(s => s.endpoint === subscription.endpoint)
  const record: PushSubscriptionRecord = {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    userAgent: userAgent || existing?.userAgent,
  }
  const next = [...subscriptions.filter(s => s.endpoint !== subscription.endpoint), record]
  await writeSubscriptions(username, next)
  return next
}

/** Remove a subscription (or all of them when endpoint is omitted). */
export async function removeSubscription(username: string, endpoint?: string): Promise<PushSubscriptionRecord[]> {
  const subscriptions = await readSubscriptions(username)
  const next = endpoint ? subscriptions.filter(s => s.endpoint !== endpoint) : []
  await writeSubscriptions(username, next)
  return next
}

export async function listSubscriptions(username: string): Promise<PushSubscriptionRecord[]> {
  return readSubscriptions(username)
}

export interface SendResult {
  endpoint: string
  ok: boolean
  statusCode?: number
  error?: string
}

export interface SendSummary {
  /** True only when a notification really was handed to the push service. */
  sent: boolean
  delivered: number
  failed: number
  removed: number
  results: SendResult[]
}

/** Load web-push lazily and configured with this instance's VAPID identity. */
async function getWebPush(): Promise<typeof import('web-push') | null> {
  const vapid = getVapidConfig()
  if (!vapid) return null
  try {
    const webpush = (await import('web-push')) as unknown as typeof import('web-push')
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
    return webpush
  } catch (error) {
    console.error('[push] web-push unavailable:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Send one notification to every stored subscription for a user.
 *
 * Returns `sent: false, delivered: 0` when VAPID keys are missing or the
 * web-push dependency cannot be loaded — callers must surface that as
 * "not configured" (HTTP 501), never as a delivered notification.
 */
export async function sendToUser(
  username: string,
  payload: { title: string; body: string; tag?: string; url?: string },
): Promise<SendSummary> {
  const subscriptions = await readSubscriptions(username)
  const empty: SendSummary = { sent: false, delivered: 0, failed: 0, removed: 0, results: [] }
  if (subscriptions.length === 0) return empty

  const webpush = await getWebPush()
  if (!webpush) return empty

  const body = JSON.stringify(payload)
  const results: SendResult[] = []
  const gone: string[] = []

  for (const subscription of subscriptions) {
    try {
      const response = await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        body,
      )
      const statusCode = response?.statusCode ?? 201
      results.push({ endpoint: subscription.endpoint, ok: true, statusCode })
      if (GONE_STATUSES.has(statusCode)) gone.push(subscription.endpoint)
    } catch (error) {
      const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : undefined
      const message = error instanceof Error ? error.message : String(error)
      if (statusCode && GONE_STATUSES.has(statusCode)) gone.push(subscription.endpoint)
      results.push({ endpoint: subscription.endpoint, ok: false, statusCode, error: message })
    }
  }

  if (gone.length) await removeSubscription(username, gone[0])
  for (const endpoint of gone.slice(1)) await removeSubscription(username, endpoint)

  return {
    sent: true,
    delivered: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    removed: gone.length,
    results,
  }
}