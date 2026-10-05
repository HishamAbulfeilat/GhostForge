import { spawn, spawnSync } from 'child_process'
import { hostedGuard } from '@/lib/hosted'
import { closeSync, mkdirSync, openSync } from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { requirePermission } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
const MAX_BODY_BYTES = 1024

function repoRoot() {
  return process.env.GHOSTFORGE_ROOT || path.resolve(process.cwd(), '..')
}

function readWorldStatus() {
  const root = repoRoot()
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'worlds.mjs'), 'status', 'ai-town', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    },
  )
  const output = String(result.stdout || '').trim()
  if (result.error) {
    throw new Error(`Could not read AI Town status: ${result.error.message}`)
  }
  try {
    return JSON.parse(output) as Record<string, unknown>
  } catch {
    const detail = String(result.stderr || output || '').trim()
    throw new Error(detail || 'AI Town status returned invalid JSON.')
  }
}

function requireAdmin(request: NextRequest) {
  return requirePermission(request, 'admin_tools')
}

export async function GET(request: NextRequest) {
  const hostedBlock = hostedGuard(request)
  if (hostedBlock) return hostedBlock
  const access = await requireAdmin(request)
  if (access instanceof NextResponse) return access
  try {
    const status = readWorldStatus()
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read AI Town status.'
    return NextResponse.json({ error: message }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function POST(request: NextRequest) {
  const hostedBlock = hostedGuard(request)
  if (hostedBlock) return hostedBlock
  const access = await requireAdmin(request)
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

  const root = repoRoot()
  const script = path.join(root, 'scripts', 'worlds.mjs')
  if (action === 'start') {
    let status: Record<string, unknown>
    try {
      status = readWorldStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read AI Town status.'
      return NextResponse.json({ error: message }, { status: 503 })
    }
    if (status.status === 'unavailable') {
      return NextResponse.json({
        error: typeof status.error === 'string' ? status.error : 'AI Town is not configured. Run the setup script first.',
      }, { status: 503 })
    }
    if (status.status === 'running') return NextResponse.json({ ok: true, ...status })

    let child: ReturnType<typeof spawn>
    const logDirectory = path.join(root, 'apps', 'worlds', 'ai-town', '.state')
    let log: number | undefined
    try {
      mkdirSync(logDirectory, { recursive: true })
      log = openSync(path.join(logDirectory, 'start.log'), 'w', 0o600)
      child = spawn(process.execPath, [script, 'start', 'ai-town'], {
        cwd: root,
        detached: true,
        stdio: ['ignore', log, log],
        windowsHide: true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to launch AI Town.'
      return NextResponse.json({ error: message }, { status: 500 })
    } finally {
      if (log !== undefined) closeSync(log)
    }
    child.once('error', error => console.error(`AI Town start process failed: ${error.message}`))
    child.unref()
    return NextResponse.json({ ok: true, action: 'start', status: 'starting' }, { status: 202 })
  }

  const result = spawnSync(process.execPath, [script, 'stop', 'ai-town'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 55_000,
    windowsHide: true,
    stdio: 'pipe',
  })
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim()
    const message = result.error?.message || detail || `AI Town stop exited with status ${result.status}.`
    return NextResponse.json({ error: message }, { status: 500 })
  }

  try {
    return NextResponse.json({ ok: true, action: 'stop', ...readWorldStatus() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to confirm AI Town stopped.'
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
