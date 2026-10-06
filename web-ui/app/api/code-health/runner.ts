/**
 * Code-health runner for the admin-only /code-health panel.
 *
 * Only the scripts in HEALTH_COMMANDS can run, each with a fixed argv array built
 * on the server. Callers pick a script id; they never supply arguments, paths or
 * environment. Scripts run through execFile (no shell) with `bash`, a timeout, a
 * minimal environment, and capped output that is ANSI-stripped and
 * secret-redacted (shared with the security-scan runner).
 */
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { resolveRepoRoot, sanitizeOutput, scanEnv, redactSecrets } from '../security-scan/scanners'

export type HealthCommandId = 'perf' | 'bundle' | 'unused' | 'dep-health'

export interface HealthCommandDef {
  id: HealthCommandId
  label: string
  description: string
  /** Script path relative to the repository root */
  script: string
  /** Fixed script arguments (never derived from user input) */
  scriptArgs: readonly string[]
}

export const HEALTH_TIMEOUT_MS = 180_000
const MAX_BUFFER_BYTES = 8 * 1024 * 1024

export const HEALTH_COMMANDS: readonly HealthCommandDef[] = [
  {
    id: 'perf',
    label: 'Performance audit',
    description: 'Lighthouse audit (scripts/perf.sh) of the local web UI at http://localhost:3000. Needs the dev server and Lighthouse.',
    script: 'scripts/perf.sh',
    scriptArgs: ['http://localhost:3000', 'desktop', 'json'],
  },
  {
    id: 'bundle',
    label: 'Bundle size',
    description: 'Measures the built JavaScript weight of web-ui and records it in the bundle history (scripts/bundle.sh track).',
    script: 'scripts/bundle.sh',
    scriptArgs: ['track', 'web-ui'],
  },
  {
    id: 'unused',
    label: 'Unused code',
    description: 'Dead code, exports and dependency finder (scripts/unused.sh, report only, never --fix).',
    script: 'scripts/unused.sh',
    scriptArgs: [],
  },
  {
    id: 'dep-health',
    label: 'Dependency health',
    description: 'Audit, outdated packages and upgrade drift (scripts/dep-health.sh full).',
    script: 'scripts/dep-health.sh',
    scriptArgs: ['full'],
  },
]

export function isHealthCommandId(value: unknown): value is HealthCommandId {
  return typeof value === 'string' && HEALTH_COMMANDS.some(c => c.id === value)
}

export function getHealthCommand(id: HealthCommandId): HealthCommandDef {
  const command = HEALTH_COMMANDS.find(c => c.id === id)
  if (!command) throw new Error(`Unknown code-health command: ${id}`)
  return command
}

/** Full argv for bash: the script path under the server-resolved root plus fixed arguments. */
export function healthArgv(command: HealthCommandDef, root: string): string[] {
  return [path.join(root, command.script), ...command.scriptArgs]
}

export interface HealthCommandStatus {
  id: HealthCommandId
  label: string
  description: string
  available: boolean
}

export interface HealthRunDeps {
  root?: string
  env?: NodeJS.ProcessEnv
  bash?: string
  exists?: (file: string) => boolean
  exec?: typeof execFile
}

function rootOf(deps: HealthRunDeps): string {
  return deps.root ?? resolveRepoRoot()
}

export function listHealthCommands(deps: HealthRunDeps = {}): HealthCommandStatus[] {
  const r = rootOf(deps)
  const exists = deps.exists ?? fs.existsSync
  return HEALTH_COMMANDS.map(c => ({ id: c.id, label: c.label, description: c.description, available: exists(path.join(r, c.script)) }))
}

export type HealthRunResult =
  | { id: HealthCommandId; status: 'unavailable' }
  | { id: HealthCommandId; status: 'pass' | 'fail' | 'error' | 'timeout'; exitCode: number | null; durationMs: number; output: string; truncated: boolean }

export function runHealthCommand(id: HealthCommandId, deps: HealthRunDeps = {}): Promise<HealthRunResult> {
  const command = getHealthCommand(id)
  const r = rootOf(deps)
  const exists = deps.exists ?? fs.existsSync
  const exec = deps.exec ?? execFile

  if (!exists(path.join(r, command.script))) return Promise.resolve({ id, status: 'unavailable' })

  const started = Date.now()
  return new Promise(resolve => {
    exec(
      deps.bash ?? 'bash',
      healthArgv(command, r),
      {
        cwd: r,
        env: scanEnv(deps.env),
        timeout: HEALTH_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string | null; code?: number | string }) | null
        const combined = [String(stdout ?? ''), String(stderr ?? '')].filter(s => s.trim()).join('\n')
        const { text, truncated } = sanitizeOutput(combined)
        const overflow = err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        const timedOut = !overflow && Boolean(err?.killed && err.signal === 'SIGTERM')
        const exitCode = err ? (typeof err.code === 'number' ? err.code : null) : 0
        const status = timedOut ? 'timeout' : !err ? 'pass' : typeof err.code === 'number' ? 'fail' : 'error'
        resolve({
          id,
          status,
          exitCode,
          durationMs: Date.now() - started,
          output: text || (status === 'timeout' ? `Run stopped after ${HEALTH_TIMEOUT_MS / 1000}s.` : status === 'error' ? redactSecrets(err?.message ?? 'Run failed') : 'No output.'),
          truncated,
        })
      },
    )
  })
}
