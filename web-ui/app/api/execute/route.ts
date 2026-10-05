import { execFile } from 'child_process'
import { hostedGuard } from '@/lib/hosted'
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
  | { kind: 'exec'; command: string; file: string; args: string[]; timeoutMs?: number }
  | { kind: 'output'; output: string }

export const dynamic = 'force-dynamic'

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
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
        output: 'Script not found: ~/GhostForge/scripts/doctor.sh — run ghostforge doctor to check setup',
      }
    }

    return { kind: 'exec', command: `bash ${shellQuote(scriptPath)}`, file: 'bash', args: [scriptPath] }
  }

  for (const [subcommand, scriptName] of GHOSTFORGE_SCRIPT_MAP) {
    const match = normalized.match(new RegExp(`^ghostforge\\s+${subcommand}(?:\\s+([\\s\\S]+))?$`))
    if (!match) continue

    const scriptPath = path.join(scriptsRoot, scriptName)
    if (!(await fileExists(scriptPath))) {
      return {
        kind: 'output',
        output: `Script not found: ~/GhostForge/scripts/${scriptName} — run ghostforge doctor to check setup`,
      }
    }

    const args = match[1]?.trim()
    const argList = args ? args.split(/\s+/).filter(Boolean) : []
    return {
      kind: 'exec',
      command: `bash ${shellQuote(scriptPath)}${argList.length ? ` ${argList.map(shellQuote).join(' ')}` : ''}`,
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
    output: `Unknown command. Supported: ${supported.map(s => `ghostforge ${s}`).join(', ')}`,
  }
}

async function executeBridgeCommand(command: string, bridgeToken: string, timeoutMs = 2000) {
  const response = await fetch(`${normalizeBridgeHttpUrl(getBridgeUrl())}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bridgeToken}`,
    },
    body: JSON.stringify({ command }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`Bridge execution failed with status ${response.status}`)
  }

  return (await response.json()) as ExecuteBridgeResponse
}

export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const access = await requirePermission(req, 'terminal')
  if (access instanceof NextResponse) return access

  const body = (await req.json()) as { command?: string }
  const command = body.command?.trim()

  if (!command) {
    return NextResponse.json({ error: 'Command is required' }, { status: 400 })
  }

  const home = os.homedir()
  const ghostforgeRoot = path.join(home, 'GhostForge')
  const resolved = await resolveGhostforgeCommand(command, ghostforgeRoot)

  if (resolved.kind === 'output') {
    return NextResponse.json({ output: resolved.output, connected: true })
  }

  const bridgeToken = getLiveBridgeToken()
  if (bridgeToken) {
    try {
      const data = await executeBridgeCommand(resolved.command, bridgeToken, resolved.timeoutMs)
      return NextResponse.json(data)
    } catch {
      return NextResponse.json({ error: 'Bridge execution failed' }, { status: 502 })
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
      timeout: resolved.timeoutMs ?? 15000,
      cwd: ghostforgeRoot,
    })
    return NextResponse.json({ output: stdout.trim() || stderr.trim() || 'Done', connected: true })
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    const output = ((err.stdout || '') + (err.stderr || '')).trim() || err.message || 'Command failed'
    return NextResponse.json({ output, error: output, connected: true })
  }
}
