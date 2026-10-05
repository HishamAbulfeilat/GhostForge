import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { buildSnapshot, getSessionDetail } from '@/lib/cli-sessions.mjs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Reading a whole week of transcripts takes a few seconds the first time;
// concurrent requests share one build, and later builds are incremental.
let pending: Promise<Record<string, unknown>> | null = null
function snapshot() {
  pending ??= buildSnapshot({ maxSessions: 150 }).finally(() => { pending = null })
  return pending
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
 */
export async function GET(request: NextRequest) {
  if (!await requireAdminUser(request)) {
    return NextResponse.json({ error: 'Admin tools permission required.' }, { status: 403 })
  }
  if (process.env.GF_CLI_SESSIONS === '0') {
    return NextResponse.json({ error: 'CLI sessions are disabled (GF_CLI_SESSIONS=0).', disabled: true }, { status: 404 })
  }
  try {
    const id = request.nextUrl.searchParams.get('session')
    if (id) {
      let detail = getSessionDetail(id)
      if (!detail) { await snapshot(); detail = getSessionDetail(id) }
      return detail
        ? NextResponse.json(detail)
        : NextResponse.json({ error: 'Session is not in the current snapshot.' }, { status: 404 })
    }
    return NextResponse.json(await snapshot())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLI session snapshot failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
