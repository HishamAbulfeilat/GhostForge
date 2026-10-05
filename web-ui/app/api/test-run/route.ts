import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { isTestCommandId, listTestCommands, runTestCommand } from './runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 200

// One test run at a time per server process; runs are CPU heavy.
let runInProgress = false

async function requireAdmin(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(me)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { me }
}

/** GET — list the allowlisted test commands and whether each is available. */
export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const { error } = await requireAdmin(req)
  if (error) return error
  return NextResponse.json({ commands: listTestCommands() })
}

/**
 * POST { command } — run one allowlisted test command on this repository.
 * The body may only name a command; arguments, paths and options are rejected.
 */
export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
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
  if (keys.length !== 1 || keys[0] !== 'command') {
    return NextResponse.json({ error: 'Only { "command": "<id>" } is accepted; arguments and paths are not allowed' }, { status: 400 })
  }
  const command = (body as { command: unknown }).command
  if (!isTestCommandId(command)) {
    return NextResponse.json({ error: 'Unknown command' }, { status: 400 })
  }

  if (runInProgress) {
    return NextResponse.json({ error: 'A test run is already in progress' }, { status: 409 })
  }
  runInProgress = true
  try {
    const result = await runTestCommand(command)
    void auditLog({
      level: 'info',
      event: 'test_run',
      tool: command,
      params: { user: me.username },
      result: result.status,
    })
    return NextResponse.json(result)
  } finally {
    runInProgress = false
  }
}
