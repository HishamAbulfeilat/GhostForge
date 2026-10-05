import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { auditLog } from '@/lib/audit'
import { getCurrentUser } from '@/lib/auth'
import { listAddresses, startTunnel, stopTunnel, tailscaleName, tunnelStatus } from '@/lib/remote/network'
import { isOwner } from '@/lib/users'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/** GET /api/remote/network — how other devices can reach this machine. */
export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const proto = req.nextUrl.protocol
  const port = req.nextUrl.port ? `:${req.nextUrl.port}` : ''
  const ts = await tailscaleName()
  return NextResponse.json({
    addresses: listAddresses().map(a => ({ ...a, url: `${proto}//${a.address}${port}` })),
    tailscale: ts ? { name: ts, url: `${proto}//${ts}${port}` } : null,
    tunnel: tunnelStatus(),
    canManageTunnel: isOwner(user),
  })
}

/**
 * POST /api/remote/network { action: 'tunnel-start' | 'tunnel-stop' } — owner only.
 * A Cloudflare quick tunnel gives a public https link to this server; the
 * GhostForge login still protects every page.
 */
export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user)) return NextResponse.json({ error: 'Only the owner account can open a public tunnel.' }, { status: 403 })
  let body: { action?: string } = {}
  try { body = await req.json() } catch { /* handled below */ }
  if (body.action === 'tunnel-stop') {
    stopTunnel()
    void auditLog({ level: 'security', event: 'remote_tunnel_stopped', params: { username: user.username } })
    return NextResponse.json({ tunnel: tunnelStatus() })
  }
  if (body.action === 'tunnel-start') {
    const local = `${req.nextUrl.protocol}//127.0.0.1${req.nextUrl.port ? `:${req.nextUrl.port}` : ''}`
    const tunnel = await startTunnel(local)
    void auditLog({ level: 'security', event: 'remote_tunnel_started', params: { username: user.username, url: tunnel.url } })
    return NextResponse.json({ tunnel })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
