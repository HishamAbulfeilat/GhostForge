import { spawn, spawnSync } from 'child_process'
import { hostedGuard } from '@/lib/hosted'
import { NextRequest, NextResponse } from 'next/server'
import { bridgeArgv, resolveBridgeLauncher } from '@/lib/bridge-launcher'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/bridge-start
 *
 * Starts or stops the GhostForge bridge (port 4747) on the machine running
 * the web-ui server. Cross-platform:
 *  - Windows: runs scripts\bridge.cmd
 *  - macOS/Linux: runs scripts/bridge.sh via bash
 *
 * Body: { action: 'start' | 'stop' } (defaults to start)
 *
 * The launcher is a constant path inside the validated repository root
 * (lib/bridge-launcher): the root is resolved server-side and only accepted
 * when it really is a GhostForge checkout, and it travels as the child's
 * working directory rather than as command-line text, so nothing a caller can
 * influence reaches the shell's parser.
 *
 * Returns immediately after the command is kicked off; the dashboard polls
 * /api/bridge-status to confirm the bridge state changed.
 */
export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { action?: string }
  const action = body.action === 'stop' ? 'stop' : 'start'

  const launcher = resolveBridgeLauncher()
  if (!launcher) {
    // Never echo the configured root back: it can be attacker-supplied via env.
    console.error('[bridge-start] no GhostForge checkout with a bridge launcher was found')
    return NextResponse.json(
      { error: 'Bridge launcher not found', ok: false, online: false, action },
      { status: 500 }
    )
  }

  const { file, args } = bridgeArgv(launcher, action)
  const cwd = launcher.repoRoot
  const env = { ...process.env, GF_NON_INTERACTIVE: '1' }

  // Stopping is fast and synchronous enough to verify right away.
  if (action === 'stop') {
    try {
      spawnSync(file, args, { cwd, stdio: 'ignore', env })
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

  const started = spawn(file, args, { cwd, detached: true, stdio: 'ignore', env })
  // Let the bridge outlive the request; unref so the server can close the response.
  started.on('error', error => console.error('[bridge-start] spawn failed:', error.message))
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