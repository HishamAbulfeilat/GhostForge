import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { getTicketCommand, isTicketCommandId, listTicketCommands, runTicketCommand, validateTicketInput } from './runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

// One run at a time per server process.
let runInProgress = false

async function requireAdmin(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(me)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { me }
}

/** GET — list the allowlisted ticket, Azure DevOps and estimate commands. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error
  return NextResponse.json({ commands: listTicketCommands() })
}

/**
 * POST { command, input? } — run one allowlisted command. `input` is accepted only
 * for commands that need it (ticket id, task description) and is strictly validated.
 */
export async function POST(req: NextRequest) {
  const { me, error } = await requireAdmin(req)
  if (error) return error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 })
  }
  const keys = Object.keys(body)
  if (!keys.includes('command') || keys.some(k => k !== 'command' && k !== 'input')) {
    return NextResponse.json({ error: 'Only { "command": "<id>", "input"?: "<text>" } is accepted' }, { status: 400 })
  }
  const { command, input } = body as { command: unknown; input?: unknown }
  if (!isTicketCommandId(command)) {
    return NextResponse.json({ error: 'Unknown command' }, { status: 400 })
  }
  const checked = validateTicketInput(getTicketCommand(command), input)
  if (checked.error) {
    return NextResponse.json({ error: checked.error }, { status: 400 })
  }

  if (runInProgress) {
    return NextResponse.json({ error: 'A ticket command is already running' }, { status: 409 })
  }
  runInProgress = true
  try {
    const result = await runTicketCommand(command, checked.value)
    void auditLog({
      level: 'info',
      event: 'tickets_run',
      tool: command,
      params: { user: me.username },
      result: result.status,
    })
    return NextResponse.json(result)
  } finally {
    runInProgress = false
  }
}
