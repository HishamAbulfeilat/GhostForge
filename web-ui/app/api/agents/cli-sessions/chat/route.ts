import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { getCurrentUser, hasPermission } from '@/lib/auth'
import { buildSnapshot } from '@/lib/cli-sessions.mjs'
import { CHAT_MAX_BODY_BYTES, sendChat, validateChat } from '@/app/agent-world/shared/server/chat.mjs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function requireAdminUser(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user || !hasPermission(user, 'admin_tools')) return null
  return user
}

/**
 * Agent World chat box: POST { sessionId, message } -> { reply, isError }.
 * Resumes the Claude Code or Copilot CLI session headless in its own folder
 * (`claude -p --resume <id>` / `copilot --resume <id>`, message on stdin, no
 * shell) and returns the reply.
 * Only sessions in the current CLI snapshot can be messaged. Off with
 * GF_CLI_SESSIONS=0 or GF_CLI_CHAT=0.
 */
export async function POST(request: NextRequest) {
  const hostedBlock = hostedGuard(request)
  if (hostedBlock) return hostedBlock
  if (!await requireAdminUser(request)) {
    return NextResponse.json({ error: 'Admin tools permission required.' }, { status: 403 })
  }
  if (process.env.GF_CLI_SESSIONS === '0' || process.env.GF_CLI_CHAT === '0') {
    return NextResponse.json({ error: 'CLI session chat is disabled on this server.', disabled: true }, { status: 404 })
  }
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 415 })
  }
  const origin = request.headers.get('origin')
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Cross-origin chat requests are refused.' }, { status: 403 })
  }
  try {
    const text = await request.text()
    if (Buffer.byteLength(text, 'utf8') > CHAT_MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 })
    }
    let body: unknown
    try { body = JSON.parse(text || '{}') } catch { return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 }) }
    const world = await buildSnapshot({ maxSessions: 150 }) as { sessions?: unknown[] }
    const check = validateChat(body, world.sessions)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })
    return NextResponse.json(await sendChat(check.session, check.message))
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 500
    const message = error instanceof Error ? error.message : 'Chat failed.'
    return NextResponse.json({ error: message }, { status })
  }
}
