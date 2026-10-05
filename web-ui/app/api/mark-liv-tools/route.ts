import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { isAuthorizedRequest } from '@/lib/auth'
import { requirePermission } from '@/lib/access'
import { ensureMarkLivBridge, type MarkLivTool } from '@/lib/mark-liv-bridge'
import { getLiveBridgeToken } from '@/lib/bridge-token'
import { getMarkLBridgeUrl } from '@/lib/bridge-url'
import { parseMarkLivToolsRequest } from '@/lib/mark-liv-tools-request'

export const dynamic = 'force-dynamic'

/**
 * Authenticated proxy for the web Mark-LV tools panel: weather, flight
 * finder, reminders, and listing/running Mark-LV tools on the bridge. Same
 * pattern as /api/device-controls — the bridge token stays server-side and is
 * only sent to a validated (loopback by default) bridge URL.
 */
async function bridgeFetch(pathname: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  // Validated: loopback only unless GF_ALLOW_REMOTE_BRIDGE=1, so the bridge token never leaves the host.
  const bridgeUrl = getMarkLBridgeUrl()
  return fetch(`${bridgeUrl}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getLiveBridgeToken()}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/**
 * Fast reachability probe — no auto-start, so the panel can show "offline"
 * quickly. Any HTTP answer below 500 means the bridge process is up (same rule
 * as isBridgeUp in lib/mark-liv-bridge.ts).
 */
async function bridgeOnline(): Promise<boolean> {
  try {
    const res = await bridgeFetch('/api/mark-l/health', { method: 'GET' }, 1500)
    return res.status < 500
  } catch {
    return false
  }
}

/** GET — list Mark-LV tools; { online: false } when the bridge is down. */
export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await bridgeOnline())) {
    return NextResponse.json({ online: false, tools: [] })
  }
  try {
    const res = await bridgeFetch('/api/mark-liv/tools', { method: 'GET' }, 20_000)
    if (!res.ok) {
      return NextResponse.json({ online: true, tools: [], error: `Tool discovery failed (${res.status}).` })
    }
    const body = await res.json().catch(() => null) as { data?: { tools?: MarkLivTool[] } } | null
    const tools = (body?.data?.tools ?? [])
      .filter(t => t && typeof t.name === 'string')
      .map(t => ({ name: t.name, description: String(t.description ?? ''), parameters: t.parameters ?? {} }))
    return NextResponse.json({ online: true, tools })
  } catch {
    return NextResponse.json({ online: false, tools: [] })
  }
}

/** POST { kind: 'weather' | 'flight' | 'reminder' | 'run', ... } — run one action on the bridge. */
export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = parseMarkLivToolsRequest(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { request } = parsed

  const access = await requirePermission(req, request.permission)
  if (access instanceof NextResponse) return access

  // Risky Mark-LV tools (send messages, delete files, run code, power off…) need an explicit confirm.
  if (request.confirmReason) {
    return NextResponse.json({ confirm: request.confirmReason }, { status: 409 })
  }

  try {
    if (!(await ensureMarkLivBridge())) {
      return NextResponse.json({ error: 'Bridge is not running and could not be started.', offline: true }, { status: 503 })
    }
    const response = await bridgeFetch(request.endpoint, { method: 'POST', body: JSON.stringify(request.payload) }, 180_000)
    if (!response.ok) {
      // The bridge sends detail as a string (HTTPException) or { ok: false, error } (_err).
      const errorBody = await response.json().catch(() => null) as { detail?: string | { error?: unknown } } | null
      const rawDetail = typeof errorBody?.detail === 'string' ? errorBody.detail : errorBody?.detail?.error
      const detail = typeof rawDetail === 'string' ? rawDetail : `Bridge request failed (${response.status}).`
      return NextResponse.json({ error: detail }, { status: response.status === 404 ? 404 : 502 })
    }
    const body = await response.json().catch(() => null) as { data?: unknown } | null
    const data = body?.data as { result?: unknown } | string | null | undefined
    const result = typeof data === 'string'
      ? data
      : data && typeof data === 'object' && typeof data.result === 'string'
        ? data.result
        : data == null ? 'Done.' : JSON.stringify(data, null, 2)
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bridge request failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
