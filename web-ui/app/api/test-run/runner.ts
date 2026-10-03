/**
 * Test-run runner for the admin-only /testing panel.
 *
 * Only the commands in TEST_COMMANDS can run, each with a fixed argument list
 * built on the server. Callers pick a command id; they never supply arguments,
 * paths or environment. Commands run through execFile (no shell) with the
 * current Node binary, a timeout, a minimal environment, and capped output that
 * is ANSI-stripped and secret-redacted (shared with the security-scan runner).
 */
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { resolveRepoRoot, sanitizeOutput, scanEnv, redactSecrets } from '../security-scan/scanners'

export type TestCommandId = 'smoke' | 'coverage'

export interface TestCommandDef {
  id: TestCommandId
  label: string
  description: string
  /** Fixed argument list for the Node binary; `root` is the server-resolved repository root */
  args: (root: string) => string[]
  /** File that must exist for the command to be available */
  requires: (root: string) => string
}

export const TEST_TIMEOUT_MS = 180_000
const MAX_BUFFER_BYTES = 8 * 1024 * 1024

export const TEST_COMMANDS: readonly TestCommandDef[] = [
  {
    id: 'smoke',
    label: 'Root smoke test',
    description: 'Runs the dependency-free root test (npm test → scripts/test.js): TUI syntax, marketplace JSON validity and required fields.',
    args: root => [path.join(root, 'scripts', 'test.js')],
    requires: root => path.join(root, 'scripts', 'test.js'),
  },
  {
    id: 'coverage',
    label: 'Coverage summary',
    description: 'Runs the root node:test suites with Node’s built-in coverage report and shows the summary table.',
    args: () => ['--test', '--experimental-test-coverage', 'scripts/test/*.test.mjs'],
    requires: root => path.join(root, 'scripts', 'test.js'),
  },
]

export function isTestCommandId(value: unknown): value is TestCommandId {
  return typeof value === 'string' && TEST_COMMANDS.some(c => c.id === value)
}

export function getTestCommand(id: TestCommandId): TestCommandDef {
  const command = TEST_COMMANDS.find(c => c.id === id)
  if (!command) throw new Error(`Unknown test command: ${id}`)
  return command
}

export interface TestCommandStatus {
  id: TestCommandId
  label: string
  description: string
  available: boolean
}

export interface TestRunDeps {
  root?: string
  env?: NodeJS.ProcessEnv
  node?: string
  exists?: (file: string) => boolean
  exec?: typeof execFile
}

function root(deps: TestRunDeps): string {
  return deps.root ?? resolveRepoRoot()
}

export function listTestCommands(deps: TestRunDeps = {}): TestCommandStatus[] {
  const r = root(deps)
  const exists = deps.exists ?? fs.existsSync
  return TEST_COMMANDS.map(c => ({ id: c.id, label: c.label, description: c.description, available: exists(c.requires(r)) }))
}

export type TestRunResult =
  | { id: TestCommandId; status: 'unavailable' }
  | { id: TestCommandId; status: 'pass' | 'fail' | 'error' | 'timeout'; exitCode: number | null; durationMs: number; output: string; truncated: boolean }

export function runTestCommand(id: TestCommandId, deps: TestRunDeps = {}): Promise<TestRunResult> {
  const command = getTestCommand(id)
  const r = root(deps)
  const exists = deps.exists ?? fs.existsSync
  const exec = deps.exec ?? execFile

  if (!exists(command.requires(r))) return Promise.resolve({ id, status: 'unavailable' })

  const started = Date.now()
  return new Promise(resolve => {
    exec(
      deps.node ?? process.execPath,
      command.args(r),
      {
        cwd: r,
        env: scanEnv(deps.env),
        timeout: TEST_TIMEOUT_MS,
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
          output: text || (status === 'timeout' ? `Run stopped after ${TEST_TIMEOUT_MS / 1000}s.` : status === 'error' ? redactSecrets(err?.message ?? 'Run failed') : 'No output.'),
          truncated,
        })
      },
    )
  })
}
