import { execFile } from 'child_process'
import { access, readFile } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { requirePermission } from '@/lib/access'
import { getBridgeUrl, getLiveBridgeToken } from '@/lib/bridge-token'
import { normalizeBridgeHttpUrl, type ExecuteBridgeResponse } from '@/lib/ws-client'

const execFileAsync = promisify(execFile)

const GHOSTFORGE_SCRIPT_MAP = [
  ['carbon', 'carbon.sh'],
  ['health-score', 'health-score.sh'],
  ['dep-health', 'dep-health.sh'],
  ['bundle', 'bundle.sh'],
  ['coverage', 'coverage.sh'],
  ['ai-review', 'ai-review.sh'],
  ['standup', 'standup.sh'],
  ['explain', 'explain.sh'],
  ['tech-debt', 'tech-debt.sh'],
  ['commit', 'commit.sh'],
  ['release', 'release.sh'],
  ['upgrade', 'upgrade.sh'],
  ['pr-description', 'pr-description.sh'],
  ['git-hooks-setup', 'git-hooks-setup.sh'],
  ['component-gen', 'component-gen.sh'],
  ['api-docs', 'api-docs.sh'],
  ['api-types', 'api-types.sh'],
  ['api-mock', 'api-mock.sh'],
  ['docker-gen', 'docker-gen.sh'],
  ['schema-viz', 'schema-viz.sh'],
  ['marketplace', 'marketplace.sh'],
  ['lighthouse', 'lighthouse.sh'],
  ['a11y', 'a11y.sh'],
] as const

type ResolvedCommand =
  | { kind: 'exec'; bridgeCommand: string; file: string; args: string[]; timeoutMs?: number }
  | { kind: 'output'; output: string; status?: number }

/** scripts/bridge-server.js kills a `ghostforge` run after 30 s. */
const BRIDGE_TIMEOUT_MS = 30_000
const LOCAL_TIMEOUT_MS = 30_000

export const dynamic = 'force-dynamic'

/**
 * The bridge's /execute only accepts `ghostforge <subcommand> [args]` and splits
 * it itself (whitespace, honouring "double" and 'single' quotes), then runs
 * ROOT/ghostforge with execFile — no shell. Args here never contain
 * whitespace, so they go bare; one containing a quote character is wrapped in
 * the other kind so the bridge's tokenizer hands it over unchanged.
 */
function bridgeArg(value: string): string | null {
  const hasSingle = value.includes("'")
  const hasDouble = value.includes('"')
  if (hasSingle && hasDouble) return null
  if (hasSingle) return `"${value}"`
  if (hasDouble) return `'${value}'`
  return value
}

function bridgeCommandFor(subcommand: string, args: string[]): string | null {
  const parts = args.map(bridgeArg)
  if (parts.some(p => p === null)) return null
  return ['ghostforge', subcommand, ...(parts as string[])].join(' ')
}

function buildPath(...segments: string[]) {
  return segments.join(path.delimiter)
}

async function fileExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveGhostforgeCommand(command: string, ghostforgeRoot: string): Promise<ResolvedCommand> {
  const normalized = command.trim()
  const scriptsRoot = path.join(ghostforgeRoot, 'scripts')

  if (/^ghostforge\s+carbon\s+weekly\s*$/.test(normalized)) {
    const weeklyPath = path.join(ghostforgeRoot, 'data', 'carbon-weekly.json')
    if (await fileExists(weeklyPath)) {
      const output = (await readFile(weeklyPath, 'utf8')).trim()
      return { kind: 'output', output: output || 'Done' }
    }

    return {
      kind: 'output',
      output: 'Carbon tracking not configured yet. Run: ghostforge carbon status first.',
    }
  }

  if (/^ghostforge\s+doctor\s*$/.test(normalized)) {
    const scriptPath = path.join(scriptsRoot, 'doctor.sh')
    if (!(await fileExists(scriptPath))) {
      return {
        kind: 'output',
        status: 404,
        output: 'Script not found: ~/GhostForge/scripts/doctor.sh — run ghostforge doctor to check setup',
      }
    }

    return { kind: 'exec', bridgeCommand: 'ghostforge doctor', file: 'bash', args: [scriptPath] }
  }

  for (const [subcommand, scriptName] of GHOSTFORGE_SCRIPT_MAP) {
    const match = normalized.match(new RegExp(`^ghostforge\\s+${subcommand}(?:\\s+([\\s\\S]+))?$`))
    if (!match) continue

    const scriptPath = path.join(scriptsRoot, scriptName)
    if (!(await fileExists(scriptPath))) {
      return {
        kind: 'output',
        status: 404,
        output: `Script not found: ~/GhostForge/scripts/${scriptName} — run ghostforge doctor to check setup`,
      }
    }

    const args = match[1]?.trim()
    const argList = args ? args.split(/\s+/).filter(Boolean) : []
    const bridgeCommand = bridgeCommandFor(subcommand, argList)
    if (!bridgeCommand) {
      return { kind: 'output', status: 400, output: 'An argument cannot contain both \' and " quote characters.' }
    }
    return {
      kind: 'exec',
      bridgeCommand,
      file: 'bash',
      args: [scriptPath, ...argList],
      ...(subcommand === 'upgrade' ? { timeoutMs: 180_000 } : {}),
    }
  }

  const supported = [
    'doctor',
    'carbon weekly',
    ...GHOSTFORGE_SCRIPT_MAP.map(([subcommand]) => subcommand),
  ]
  return {
    kind: 'output',
    status: 400,
    output: `Unknown command. Supported: ${supported.map(s => `ghostforge ${s}`).join(', ')}`,
  }
}

class BridgeUnreachableError extends Error {}

/**
 * Run `ghostforge <subcommand> ...` on the bridge. Returns the HTTP response
 * to send, or throws BridgeUnreachableError when nothing is listening (so the
 * caller can run the same script locally instead).
 */
async function executeOnBridge(command: string, bridgeToken: string, timeoutMs: number): Promise<NextResponse> {
  let response: Response
  try {
    response = await fetch(`${normalizeBridgeHttpUrl(getBridgeUrl())}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeToken}`,
      },
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return NextResponse.json({ error: 'The command did not finish in time', connected: true }, { status: 504 })
    }
    throw new BridgeUnreachableError(error instanceof Error ? error.message : 'Bridge unreachable')
  }

  const data = (await response.json().catch(() => ({}))) as ExecuteBridgeResponse
  if (response.status === 401) {
    return NextResponse.json({
      error: 'The bridge rejected its token (it may have restarted). Restart the bridge and try again.',
      connected: true,
    }, { status: 502 })
  }
  if (!response.ok) {
    const detail = typeof data.error === 'string' ? data.error : `HTTP ${response.status}`
    return NextResponse.json({ error: `Bridge refused the command: ${detail}`, connected: true }, { status: 502 })
  }
  const output = typeof data.output === 'string' ? data.output : ''
  if (data.error) {
    // The bridge reports a script that exited non-zero as 200 { output, error: true }.
    return NextResponse.json({ output, error: output || 'Command failed', connected: true }, { status: 500 })
  }
  return NextResponse.json({ output: output || 'Done', connected: true })
}

export async function POST(req: NextRequest) {
  const access = await requirePermission(req, 'terminal')
  if (access instanceof NextResponse) return access

  let body: { command?: unknown }
  try {
    body = (await req.json()) as { command?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const command = typeof body?.command === 'string' ? body.command.trim() : ''

  if (!command) {
    return NextResponse.json({ error: 'Command is required' }, { status: 400 })
  }

  const home = os.homedir()
  const ghostforgeRoot = path.join(home, 'GhostForge')
  const resolved = await resolveGhostforgeCommand(command, ghostforgeRoot)

  if (resolved.kind === 'output') {
    if (resolved.status && resolved.status >= 400) {
      return NextResponse.json({ error: resolved.output, connected: true }, { status: resolved.status })
    }
    return NextResponse.json({ output: resolved.output, connected: true })
  }

  // The bridge enforces its own 30 s limit, so longer commands (upgrade) run here.
  const bridgeToken = getLiveBridgeToken()
  if (bridgeToken && (resolved.timeoutMs ?? BRIDGE_TIMEOUT_MS) <= BRIDGE_TIMEOUT_MS) {
    try {
      return await executeOnBridge(resolved.bridgeCommand, bridgeToken, BRIDGE_TIMEOUT_MS + 5_000)
    } catch (error) {
      if (!(error instanceof BridgeUnreachableError)) {
        return NextResponse.json({ error: 'Bridge execution failed', connected: true }, { status: 502 })
      }
      // Stale token file and no bridge listening: run the same script locally.
    }
  }
  const env = {
    ...process.env,
    PATH: buildPath(
      path.join(ghostforgeRoot, 'bin'),
      path.join(ghostforgeRoot, 'node_modules', '.bin'),
      path.join(ghostforgeRoot, 'web-ui', 'node_modules', '.bin'),
      path.join(home, '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      process.env.PATH || '',
    ),
    HOME: home,
    GHOSTFORGE_ROOT: ghostforgeRoot,
    GF_NON_INTERACTIVE: '1',
  }

  try {
    const { stdout, stderr } = await execFileAsync(resolved.file, resolved.args, {
      env,
      timeout: resolved.timeoutMs ?? LOCAL_TIMEOUT_MS,
      cwd: ghostforgeRoot,
    })
    return NextResponse.json({ output: stdout.trim() || stderr.trim() || 'Done', connected: true })
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    const output = ((err.stdout || '') + (err.stderr || '')).trim() || err.message || 'Command failed'
    return NextResponse.json({ output, error: output, connected: true }, { status: 500 })
  }
}
