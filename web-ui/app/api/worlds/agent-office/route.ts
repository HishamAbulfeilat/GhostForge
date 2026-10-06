import { spawnSync } from 'child_process'
import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { requirePermission } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
const MAX_BODY_BYTES = 1024
const WORLD = 'agent-office'

function repoRoot() {
  return process.env.GHOSTFORGE_ROOT || path.resolve(process.cwd(), '..')
}

// Runs the shared world manager (scripts/worlds.mjs -> scripts/worlds/cli.mjs);
// the action and world are fixed strings, never user input.
function runWorlds(args: string[], timeout: number) {
  const root = repoRoot()
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'worlds.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    stdio: 'pipe',
  })
}

function readWorldStatus() {
  const result = runWorlds(['status', WORLD, '--json'], 15_000)
  if (result.error) throw new Error(`Could not read Agent Office status: ${result.error.message}`)
  const output = String(result.stdout || '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error(String(result.stderr || output || '').trim() || 'Agent Office status returned invalid JSON.')
  }
  const status = Array.isArray(parsed) ? parsed.find(item => item?.world === WORLD) : parsed
  if (!status || typeof status !== 'object') throw new Error('Agent Office status was missing.')
  return status as Record<string, unknown>
}

export async function GET(request: NextRequest) {
  const access = await requirePermission(request, 'admin_tools')
  if (access instanceof NextResponse) return access
  try {
    return NextResponse.json(readWorldStatus(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read Agent Office status.'
    return NextResponse.json({ error: message }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function POST(request: NextRequest) {
  const access = await requirePermission(request, 'admin_tools')
  if (access instanceof NextResponse) return access

  let body: unknown
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 })
    }
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 })
  }
  const action = (body as { action?: unknown }).action
  if (action !== 'start' && action !== 'stop') {
    return NextResponse.json({ error: 'Action must be start or stop.' }, { status: 400 })
  }

  if (action === 'start') {
    let status: Record<string, unknown>
    try {
      status = readWorldStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read Agent Office status.'
      return NextResponse.json({ error: message }, { status: 503 })
    }
    if (status.installed === false) {
      return NextResponse.json({ error: 'Agent Office is not set up. Run: ghostforge worlds setup agent-office' }, { status: 503 })
    }
    if (status.status === 'running') return NextResponse.json({ ok: true, ...status })
  }

  // start spawns detached server/ui processes and returns at once; stop kills them.
  const result = runWorlds([action, WORLD], 30_000)
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim()
    const message = result.error?.message || detail || `Agent Office ${action} exited with status ${result.status}.`
    return NextResponse.json({ error: message }, { status: 500 })
  }
  try {
    return NextResponse.json({ ok: true, action, ...readWorldStatus() }, { status: action === 'start' ? 202 : 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to confirm Agent Office state.'
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
