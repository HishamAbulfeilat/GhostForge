import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { auditLog } from '@/lib/audit'
import { AUTH_COOKIE_NAME, createSessionToken, getCurrentUser } from '@/lib/auth'
import { getClientIP } from '@/lib/ratelimit'
import { listAddresses, tunnelStatus } from '@/lib/remote/network'
import { createPairing, deviceNameFromUA, PAIR_TTL_MS, redeemPairing } from '@/lib/remote/store'
import { getUserByUsername } from '@/lib/users'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Failed redemptions per IP: codes are 128-bit, but there is no reason to allow guessing.
const failures = new Map<string, { n: number; until: number }>()

function pairUrl(base: string, code: string) {
  return `${base.replace(/\/$/, '')}/api/remote/pair?code=${encodeURIComponent(code)}`
}

/**
 * POST /api/remote/pair { label? } — signed-in user creates a one-time link (and
 * QR code) that signs a phone/tablet in as them. Valid for 10 minutes, once.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { label?: string } = {}
  try { body = await req.json() } catch { /* label is optional */ }
  const { code, expiresAt } = await createPairing(user.username, typeof body.label === 'string' ? body.label : 'Phone')

  // Links for every way a phone could reach this machine; the first is the QR code.
  const proto = req.nextUrl.protocol
  const port = req.nextUrl.port ? `:${req.nextUrl.port}` : ''
  const tunnel = tunnelStatus().url
  const local = /^(localhost|127\.|\[::1\])/.test(req.nextUrl.hostname)
  const bases = [
    ...(tunnel ? [tunnel] : []),
    ...(!local ? [req.nextUrl.origin] : []),
    ...listAddresses().map(a => `${proto}//${a.address}${port}`),
  ]
  const links = [...new Set(bases)].map(base => pairUrl(base, code))
  const qrSvg = links[0] ? await QRCode.toString(links[0], { type: 'svg', margin: 1, width: 240 }) : ''
  void auditLog({ level: 'security', event: 'remote_pair_created', params: { username: user.username } })
  return NextResponse.json({ links, qrSvg, expiresAt, ttlMs: PAIR_TTL_MS })
}

/**
 * GET /api/remote/pair?code=… — opened on the phone (public: the one-time code
 * is the credential). Signs the device in and continues to /jarvis.
 */
export async function GET(req: NextRequest) {
  const ip = getClientIP(req)
  const now = Date.now()
  const f = failures.get(ip)
  if (f && f.until > now && f.n >= 10) return htmlPage('Too many attempts', 'Wait a few minutes and scan a new code.', 429)

  const code = req.nextUrl.searchParams.get('code') || ''
  const device = await redeemPairing(code, deviceNameFromUA(req.headers.get('user-agent')))
  const user = device ? await getUserByUsername(device.username) : null
  if (!device || !user || !user.active) {
    failures.set(ip, { n: (f && f.until > now ? f.n : 0) + 1, until: now + 10 * 60_000 })
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

/**
 * A tiny page instead of a redirect: the session cookie is SameSite=strict, and a
 * redirect that began in the camera app is a cross-site navigation that would not
 * send it. A same-site navigation started by this page does.
 */
function htmlPage(title: string, message: string, status: number, next?: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · GhostForge</title>${next ? `<meta http-equiv="refresh" content="1;url=${esc(next)}">` : ''}
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0B0D12;color:#E7E9EE;font:16px system-ui,sans-serif;padding:24px}main{max-width:28rem;text-align:center}h1{font-size:1.4rem}p{color:#9CA3AF}a{color:#38BDF8}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(message)}</p>${next ? `<p><a href="${esc(next)}">Continue</a></p><script>setTimeout(function(){location.replace(${JSON.stringify(next)})},300)</script>` : ''}</main></body></html>`
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
}
