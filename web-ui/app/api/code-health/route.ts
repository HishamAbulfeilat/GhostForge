import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { isHealthCommandId, listHealthCommands, runHealthCommand } from './runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 200

// One run at a time per server process; these scripts are CPU heavy.
let runInProgress = false

async function requireAdmin(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(me)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { me }
}

/** GET — list the allowlisted code-health scripts and whether each is available. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req)
  if (error) return error
  return NextResponse.json({ commands: listHealthCommands() })
}

/**
 * POST { script } — run one allowlisted code-health script on this repository.
 * The body may only name a script id; arguments, paths and options are rejected.
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
  if (keys.length !== 1 || keys[0] !== 'script') {
    return NextResponse.json({ error: 'Only { "script": "<id>" } is accepted; arguments and paths are not allowed' }, { status: 400 })
  }
  const script = (body as { script: unknown }).script
  if (!isHealthCommandId(script)) {
    return NextResponse.json({ error: 'Unknown script' }, { status: 400 })
  }

  if (runInProgress) {
    return NextResponse.json({ error: 'A code-health run is already in progress' }, { status: 409 })
  }
  runInProgress = true
  try {
    const result = await runHealthCommand(script)
    void auditLog({
      level: 'info',
      event: 'code_health_run',
      tool: script,
      params: { user: me.username },
      result: result.status,
    })
    return NextResponse.json(result)
  } finally {
    runInProgress = false
  }
}
