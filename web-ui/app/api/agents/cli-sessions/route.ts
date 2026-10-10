import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { buildSnapshot, getSessionDetail, WATCH_ROOTS } from '@/lib/cli-sessions.mjs'
import { connectorSnapshot } from '@/app/agent-world/shared/server/connector.mjs'
import { createSnapshotHub, STREAM_HEADERS } from '@/app/agent-world/shared/server/push.mjs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Reading a whole week of transcripts takes a few seconds the first time;
// concurrent requests share one build, and later builds are incremental.
let pending: Promise<Record<string, unknown>> | null = null
function snapshot() {
  pending ??= buildSnapshot({ maxSessions: 150 }).finally(() => { pending = null })
  return pending
}

// Pushes changed snapshots to open pages (?stream=1). It watches the
// transcript folders only while at least one page is connected.
const hub = createSnapshotHub({ build: snapshot, roots: WATCH_ROOTS, intervalMs: 5000 })

/**
 * Server-Sent Events: the snapshot on connect, then `world` when it changes
 * and `heartbeat` otherwise. The subscription ends when the client goes
 * (request aborted or stream cancelled), and after the hub's maximum stream
 * age, so a reconnecting browser is authorised again.
 */
function streamSnapshots(request: NextRequest) {
  if (hub.full) return NextResponse.json({ error: 'Too many live streams; polling instead.' }, { status: 503 })
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        try { controller.close() } catch { /* already closed */ }
      }
      unsubscribe = hub.subscribe(chunk => {
        if (!closed) controller.enqueue(encoder.encode(chunk))
      }, close)
      if (!unsubscribe) { close(); return }
      if (request.signal.aborted) close()
      else request.signal.addEventListener('abort', close, { once: true })
    },
    cancel() {
      closed = true
      unsubscribe?.()
    },
  })
  return new Response(stream, { headers: STREAM_HEADERS })
}

async function requireAdminUser(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user || !hasPermission(user, 'admin_tools')) return null
  return user
}

/**
 * Claude Code and Copilot CLI sessions on this machine (metadata only).
 * GET                 -> world snapshot (sessions, agents, totals)
 * GET ?session=<id>   -> one session's detail (tools, events, subagents, usage)
 * GET ?format=connector -> the snapshot in the /api/agents connector format,
 *                         trimmed below the 65,536-byte connector limit
 * GET ?stream=1       -> the snapshot as Server-Sent Events (see streamSnapshots)
 */
export async function GET(request: NextRequest) {
  const hostedBlock = hostedGuard(request)
  if (hostedBlock) return hostedBlock
  if (!await requireAdminUser(request)) {
    return NextResponse.json({ error: 'Admin tools permission required.' }, { status: 403 })
  }
  if (process.env.GF_CLI_SESSIONS === '0') {
    return NextResponse.json({ error: 'CLI sessions are disabled (GF_CLI_SESSIONS=0).', disabled: true }, { status: 404 })
  }
  if (request.nextUrl.searchParams.get('stream') === '1') return streamSnapshots(request)
  try {
    const id = request.nextUrl.searchParams.get('session')
    if (id) {
      let detail = getSessionDetail(id)
      if (!detail) { await snapshot(); detail = getSessionDetail(id) }
      return detail
        ? NextResponse.json(detail)
        : NextResponse.json({ error: 'Session is not in the current snapshot.' }, { status: 404 })
    }
    if (request.nextUrl.searchParams.get('format') === 'connector') {
      return NextResponse.json(connectorSnapshot(await snapshot()))
    }
    return NextResponse.json(await snapshot())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLI session snapshot failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
