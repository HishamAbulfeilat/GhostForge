import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import os from 'os'
import { getBridgeUrlCandidates, getLiveBridgeToken } from '@/lib/bridge-token'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const PLATFORM_LABEL: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
  android: 'Android',
  freebsd: 'FreeBSD',
  openbsd: 'OpenBSD',
}

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  // Host details (hostname, platform, bridge URL) must not leak to unauthenticated
  // callers — the middleware does not cover /api/*, so guard in-route.
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const candidates = getBridgeUrlCandidates()
  const bridgeToken = getLiveBridgeToken()

  // Probe each candidate bridge URL's health endpoint (no auth needed) and
  // use the first reachable one — local first, then tunnel/LAN fallbacks.
  let bridgeUrl = candidates[0]
  let reachable = false
  for (const candidate of candidates) {
    try {
      const res = await fetch(`${candidate}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        bridgeUrl = candidate
        reachable = true
        break
      }
    } catch {
      // try next candidate
    }
  }

  let status: 'connected' | 'unconfigured' | 'disconnected'
  if (reachable) {
    status = 'connected'
  } else {
    status = bridgeToken ? 'disconnected' : 'unconfigured'
  }

  const platform = process.platform
  return NextResponse.json({
    status,
    url: bridgeUrl,
    tokenConfigured: Boolean(bridgeToken),
    device: {
      hostname: os.hostname(),
      platform,
      platformLabel: PLATFORM_LABEL[platform] ?? platform,
      arch: os.arch(),
      uptimeSec: Math.round(os.uptime()),
    },
  })
}
