import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { isAuthorizedRequest } from '@/lib/auth'
import { collectHealth, type HealthReport } from '@/lib/health-core.mjs'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — "Health at a glance".
 *
 * One status contract (ready / missing / offline / error + a fix-it step) for
 * the bridge, voice pipeline, OmniRoute, Ollama, gh auth, HTTPS and push keys.
 * The dashboard, the setup checklist and the TUI doctor all read the same
 * checks (the TUI imports lib/health-core.mjs directly).
 *
 * Results are cached for a few seconds so several panels polling at once share
 * one round of probes; ?fresh=1 skips the cache. Host-only: blocked in hosted
 * mode (it reveals what runs on the host).
 */
const CACHE_MS = 10_000
let cached: { at: number; report: HealthReport } | null = null
let inFlight: Promise<HealthReport> | null = null

function loadHealth(fresh: boolean): Promise<HealthReport> {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.report)
  if (inFlight) return inFlight
  inFlight = collectHealth()
    .then(report => {
      cached = { at: Date.now(), report }
      return report
    })
    .finally(() => { inFlight = null })
  return inFlight
}

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const fresh = req.nextUrl?.searchParams.get('fresh') === '1'
  const report = await loadHealth(fresh)
  return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
}
