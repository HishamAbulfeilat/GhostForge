import { exec } from 'child_process'
import { access, readFile } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { isAuthorizedRequest } from '@/lib/auth'
import { getBridgeUrl, getLiveBridgeToken } from '@/lib/bridge-token'
import { normalizeBridgeHttpUrl, type ExecuteBridgeResponse } from '@/lib/ws-client'

const execAsync = promisify(exec)

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
  ['pr-description', 'pr-description.sh'],
  ['git-hooks-setup', 'git-hooks-setup.sh'],
  ['component-gen', 'component-gen.sh'],
  ['api-docs', 'api-docs.sh'],
  ['docker-gen', 'docker-gen.sh'],
  ['schema-viz', 'schema-viz.sh'],
  ['marketplace', 'marketplace.sh'],
  ['lighthouse', 'lighthouse.sh'],
  ['a11y', 'a11y.sh'],
] as const

type ResolvedCommand =
  | { kind: 'exec'; command: string }
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

    return { kind: 'exec', command: `bash ${shellQuote(scriptPath)}` }
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
    return {
      kind: 'exec',
      command: `bash ${shellQuote(scriptPath)}${args ? ` ${args}` : ''}`,
    }
  }

  return { kind: 'exec', command }
}

async function executeBridgeCommand(command: string, bridgeToken: string) {
  const response = await fetch(`${normalizeBridgeHttpUrl(getBridgeUrl())}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bridgeToken}`,
    },
    body: JSON.stringify({ command }),
    signal: AbortSignal.timeout(2000),
  })

  if (!response.ok) {
    throw new Error(`Bridge execution failed with status ${response.status}`)
  }

  return (await response.json()) as ExecuteBridgeResponse
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
      const data = await executeBridgeCommand(resolved.command, bridgeToken)
      return NextResponse.json(data)
    } catch {
      // Fall through to direct local execution.
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
    const { stdout, stderr } = await execAsync(resolved.command, {
      env,
      timeout: 15000,
      cwd: ghostforgeRoot,
    })
    return NextResponse.json({ output: stdout.trim() || stderr.trim() || 'Done', connected: true })
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    const output = ((err.stdout || '') + (err.stderr || '')).trim() || err.message || 'Command failed'
    return NextResponse.json({ output, error: output, connected: true })
  }
}
