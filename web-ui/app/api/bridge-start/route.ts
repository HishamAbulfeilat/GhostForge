import { spawn, spawnSync } from 'child_process'
import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/bridge-start
 *
 * Starts or stops the GhostForge bridge (port 4747) on the machine running
 * the web-ui server. Cross-platform:
 *  - Windows: runs scripts\\bridge.cmd (cmd wrapper so bash isn't required)
 *  - macOS/Linux: runs scripts/bridge.sh via bash
 *
 * Body: { action: 'start' | 'stop' } (defaults to start)
 *
 * Returns immediately after the command is kicked off; the dashboard polls
 * /api/bridge-status to confirm the bridge state changed.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { action?: string }
  const action = body.action === 'stop' ? 'stop' : 'start'

  // Resolve the GhostForge repo root: env override, or walk up from the
  // web-ui server directory (works no matter where the repo is cloned).
  const repoRoot = process.env.GHOSTFORGE_ROOT ?? path.resolve(process.cwd(), '..')
  const isWindows = process.platform === 'win32'
  const scriptPath = path.join(repoRoot, 'scripts', isWindows ? 'bridge.cmd' : 'bridge.sh')

  // Stopping is fast and synchronous enough to verify right away.
  if (action === 'stop') {
    try {
      spawnSync(isWindows ? 'cmd.exe' : 'bash', isWindows ? ['/c', scriptPath, 'stop'] : [scriptPath, 'stop'], {
        cwd: repoRoot,
        stdio: 'ignore',
        env: { ...process.env, GF_NON_INTERACTIVE: '1' },
      })
    } catch { /* report unreachable below */ }
    let online = false
    try {
      const res = await fetch('http://localhost:4747/health', { signal: AbortSignal.timeout(1200) })
      online = res.ok
    } catch { online = false }
    return NextResponse.json({
      ok: !online,
      online,
      action,
      message: online
        ? 'Bridge is still responding — it may need a moment to shut down.'
        : 'Bridge stopped.',
    })
  }

  const started = spawn(isWindows ? 'cmd.exe' : 'bash', isWindows ? ['/c', scriptPath, 'start'] : [scriptPath, 'start'], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, GF_NON_INTERACTIVE: '1' },
  })
  // Let the bridge outlive the request; unref so the server can close the response.
  started.unref()

  // Give it a moment to bind, then report status so the client gets a useful
  // signal right away (it still re-polls bridge-status afterwards).
  await new Promise(resolve => setTimeout(resolve, 1500))

  let online = false
  try {
    const res = await fetch('http://localhost:4747/health', { signal: AbortSignal.timeout(1500) })
    online = res.ok
  } catch {
    online = false
  }

  return NextResponse.json({
    ok: true,
    online,
    message: online
      ? 'Bridge started successfully.'
      : 'Bridge start initiated — it may take a few more seconds. Polling status…',
  })
}
