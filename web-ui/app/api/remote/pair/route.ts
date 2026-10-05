import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import QRCode from 'qrcode'
import { auditLog } from '@/lib/audit'
import { getCurrentUser } from '@/lib/auth'
import { htmlPage } from '@/lib/remote/html'
import { listAddresses, tunnelStatus } from '@/lib/remote/network'
import { createPairing, PAIR_TTL_MS } from '@/lib/remote/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function pairUrl(base: string, code: string) {
  return `${base.replace(/\/$/, '')}/api/remote/pair?code=${encodeURIComponent(code)}`
}

/**
 * POST /api/remote/pair { label? } — signed-in user creates a one-time link (and
 * QR code) that signs a phone/tablet in as them. Valid for 10 minutes, once.
 */
export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
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
 * GET /api/remote/pair?code=… — opened on the phone. Public, and it does NOT
 * use the code: chat apps (WhatsApp, iMessage, Slack, mail scanners) fetch
 * links to build previews, and a GET that signed in would burn the one-time
 * code before the person taps it. It shows a "Sign in this device" button that
 * POSTs to /api/remote/pair/redeem instead.
 */
export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const code = req.nextUrl.searchParams.get('code') || ''
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) {
    return htmlPage('This pairing link is incomplete', 'Scan the QR code again, or copy the whole link.', 400)
  }
  return htmlPage('Sign in this device?', 'This signs this browser in to GhostForge as the person who created the code. Only continue if you scanned it from your own computer just now.', 200, undefined, code)
}
