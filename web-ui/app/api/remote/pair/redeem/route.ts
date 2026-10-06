import { NextRequest } from 'next/server'
import { auditLog } from '@/lib/audit'
import { AUTH_COOKIE_NAME, createSessionToken } from '@/lib/auth'
import { getClientIP } from '@/lib/ratelimit'
import { htmlPage } from '@/lib/remote/html'
import { tunnelStatus } from '@/lib/remote/network'
import { deviceNameFromUA, redeemPairing } from '@/lib/remote/store'
import { getUserByUsername } from '@/lib/users'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Failed redemptions per IP: codes are 128-bit, but there is no reason to allow guessing.
const failures = new Map<string, { n: number; until: number }>()

/**
 * The form must come from our own pairing page, never from another site
 * ("sign in as me" login CSRF). Modern browsers say so in Sec-Fetch-Site;
 * otherwise the Origin (or Referer) must be this host. An opaque "null" origin
 * (sandboxed frames, no-referrer pages) is refused.
 */
function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin'
  const source = req.headers.get('origin') || req.headers.get('referer')
  if (!source) return true // very old browsers send none of these; the one-time code is still required
  if (source === 'null') return false
  const tunnel = tunnelStatus().url
  const hosts = new Set([req.headers.get('x-forwarded-host'), req.headers.get('host'), req.nextUrl.host, tunnel ? new URL(tunnel).host : null].filter(Boolean))
  try { return hosts.has(new URL(source).host) } catch { return false }
}

/**
 * POST /api/remote/pair/redeem (form field `code`) — the "Sign in this device"
 * button on the pairing page. Public: the one-time code is the credential.
 * Signs the device in with a revocable device session and continues to /jarvis.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIP(req)
  const now = Date.now()
  const f = failures.get(ip)
  if (f && f.until > now && f.n >= 10) return htmlPage('Too many attempts', 'Wait a few minutes and scan a new code.', 429)
  if (!sameOrigin(req)) return htmlPage('Pairing refused', 'Open the pairing link from your computer\'s QR code directly.', 403)

  let code = ''
  try {
    const type = req.headers.get('content-type') || ''
    if (type.includes('application/json')) code = String((await req.json())?.code || '')
    else code = String((await req.formData()).get('code') || '')
  } catch { /* empty code fails below */ }

  const device = await redeemPairing(code, deviceNameFromUA(req.headers.get('user-agent')))
  const user = device ? await getUserByUsername(device.username) : null
  if (!device || !user || !user.active) {
    failures.set(ip, { n: (f && f.until > now ? f.n : 0) + 1, until: now + 10 * 60_000 })
    if (failures.size > 5000) failures.clear()
    void auditLog({ level: 'security', event: 'remote_pair_failed', ip, params: {} })
    return htmlPage('This pairing link has expired', 'Pairing links work once, for 10 minutes. Create a new one on your computer under Remote → Pair a device.', 410)
  }

  void auditLog({ level: 'security', event: 'remote_device_paired', ip, params: { username: user.username, device: device.name } })
  const response = htmlPage('Device paired', 'Opening GhostForge…', 200, '/jarvis')
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const secure = forwardedProto ? forwardedProto === 'https' : req.nextUrl.protocol === 'https:'
  response.cookies.set(AUTH_COOKIE_NAME, createSessionToken(user, { deviceId: device.id }), {
    httpOnly: true, secure, sameSite: 'strict', maxAge: 30 * 24 * 60 * 60, path: '/',
  })
  return response
}
