/**
 * Defensive security-scan runner for the admin-only /security panel.
 *
 * Only the scanners in SCANNERS can run, each with a fixed argument list built
 * on the server. Callers pick a scanner id; they never supply arguments, paths
 * or environment. Commands run through execFile (no shell) with a timeout, a
 * minimal environment, and their output is ANSI-stripped, secret-redacted and
 * truncated before it leaves the server. No pentest or offensive tooling.
 */
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

export type ScannerId = 'security-check' | 'gitleaks' | 'osv-scanner' | 'semgrep'

export interface ScannerDef {
  id: ScannerId
  label: string
  description: string
  /** Executable looked up on PATH */
  binary: string
  /** Fixed argument list; `root` is the server-resolved repository root */
  args: (root: string) => string[]
  /** Extra file that must exist for the scanner to count as installed */
  requires?: (root: string) => string
  installHint: string
}

export const SCAN_TIMEOUT_MS = 120_000
export const MAX_OUTPUT_CHARS = 20_000
const MAX_BUFFER_BYTES = 8 * 1024 * 1024

export const SCANNERS: readonly ScannerDef[] = [
  {
    id: 'security-check',
    label: 'GhostForge security check',
    description: 'npm audit summary and a scan of git history for committed .env files (scripts/security-check.sh).',
    binary: 'bash',
    args: root => [path.join(root, 'scripts', 'security-check.sh'), root],
    requires: root => path.join(root, 'scripts', 'security-check.sh'),
    installHint: 'Needs bash (Git Bash or WSL on Windows) and scripts/security-check.sh in the repository.',
  },
  {
    id: 'gitleaks',
    label: 'Gitleaks',
    description: 'Finds hard-coded secrets in the repository and its git history. Findings are redacted.',
    binary: 'gitleaks',
    args: root => ['detect', '--source', root, '--no-banner', '--redact', '--exit-code', '0'],
    installHint: 'Install from the Marketplace (Gitleaks) or https://github.com/gitleaks/gitleaks.',
  },
  {
    id: 'osv-scanner',
    label: 'OSV-Scanner',
    description: 'Checks lockfiles against the OSV vulnerability database.',
    binary: 'osv-scanner',
    args: root => ['--recursive', root],
    installHint: 'Install from the Marketplace (OSV-Scanner) or https://github.com/google/osv-scanner.',
  },
  {
    id: 'semgrep',
    label: 'Semgrep',
    description: 'Static analysis with the default community rule set. Metrics are turned off.',
    binary: 'semgrep',
    args: root => ['scan', '--config', 'p/default', '--metrics', 'off', '--quiet', root],
    installHint: 'Install from the Marketplace (Semgrep) or `pip install semgrep`.',
  },
]

export function isScannerId(value: unknown): value is ScannerId {
  return typeof value === 'string' && SCANNERS.some(s => s.id === value)
}

export function getScanner(id: ScannerId): ScannerDef {
  const scanner = SCANNERS.find(s => s.id === id)
  if (!scanner) throw new Error(`Unknown scanner: ${id}`)
  return scanner
}

/** Repository root, resolved on the server only (never from the request). */
export function resolveRepoRoot(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const marker = path.join('scripts', 'security-check.sh')
  const candidates = [env.GHOSTFORGE_ROOT, path.resolve(cwd, '..'), cwd].filter((c): c is string => Boolean(c))
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, marker))) return path.resolve(candidate)
  }
  return path.resolve(cwd, '..')
}

/** Find an executable on PATH without spawning a shell. */
export function findOnPath(binary: string, env: NodeJS.ProcessEnv = process.env, platform = process.platform): string | null {
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)
  // execFile without a shell cannot launch .cmd/.bat shims on Windows, so only real executables count.
  const exts = platform === 'win32' ? ['.exe', '.com'] : ['']
  for (const dir of dirs) {
    // The System32 bash.exe is the WSL launcher, which cannot read Windows paths; prefer Git Bash.
    if (platform === 'win32' && /[\\/]windows[\\/]system32$/i.test(dir.replace(/[\\/]+$/, ''))) continue
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch { /* not here */ }
    }
  }
  return null
}

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED]'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]'],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [REDACTED]'],
  [/\b([A-Za-z0-9_]*(?:secret|token|password|passwd|api[_-]?key|private[_-]?key)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)[^\s"']{6,}\3/gi, '$1$2$3[REDACTED]$3'],
]

export function redactSecrets(text: string): string {
  let out = text
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

export function truncateOutput(text: string, max = MAX_OUTPUT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: `${text.slice(0, max)}\n… output truncated (${text.length - max} more characters)`, truncated: true }
}

export function sanitizeOutput(raw: string): { text: string; truncated: boolean } {
  return truncateOutput(redactSecrets(raw.replace(ANSI_PATTERN, '').replace(/\r\n?/g, '\n')))
}

/** Minimal environment: no API keys or tokens from the web server reach scanners. */
export function scanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'APPDATA', 'LOCALAPPDATA']
  const out: Record<string, string | undefined> = { NO_COLOR: '1', SEMGREP_SEND_METRICS: 'off' }
  for (const key of keep) if (env[key]) out[key] = env[key]
  return out as NodeJS.ProcessEnv
}

export interface ScannerStatus {
  id: ScannerId
  label: string
  description: string
  installed: boolean
  installHint: string
}

export interface ScanDeps {
  root?: string
  env?: NodeJS.ProcessEnv
  which?: (binary: string) => string | null
  exists?: (file: string) => boolean
  exec?: typeof execFile
}

export function listScanners(deps: ScanDeps = {}): ScannerStatus[] {
  const root = deps.root ?? resolveRepoRoot()
  const which = deps.which ?? (b => findOnPath(b, deps.env))
  const exists = deps.exists ?? fs.existsSync
  return SCANNERS.map(s => ({
    id: s.id,
    label: s.label,
    description: s.description,
    installed: Boolean(which(s.binary)) && (!s.requires || exists(s.requires(root))),
    installHint: s.installHint,
  }))
}

export type ScanResult =
  | { id: ScannerId; status: 'not_installed'; installHint: string }
  | { id: ScannerId; status: 'ok' | 'findings' | 'error' | 'timeout'; exitCode: number | null; durationMs: number; output: string; truncated: boolean }

export function runScanner(id: ScannerId, deps: ScanDeps = {}): Promise<ScanResult> {
  const scanner = getScanner(id)
  const root = deps.root ?? resolveRepoRoot()
  const which = deps.which ?? (b => findOnPath(b, deps.env))
  const exists = deps.exists ?? fs.existsSync
  const exec = deps.exec ?? execFile

  const binaryPath = which(scanner.binary)
  if (!binaryPath || (scanner.requires && !exists(scanner.requires(root)))) {
    return Promise.resolve({ id, status: 'not_installed', installHint: scanner.installHint })
  }

  const started = Date.now()
  return new Promise(resolve => {
    exec(
      binaryPath,
      scanner.args(root),
      {
        cwd: root,
        env: scanEnv(deps.env),
        timeout: SCAN_TIMEOUT_MS,
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
        const status = timedOut ? 'timeout' : !err ? 'ok' : typeof err.code === 'number' ? 'findings' : 'error'
        resolve({
          id,
          status,
          exitCode,
          durationMs: Date.now() - started,
          output: text || (status === 'timeout' ? `Scan stopped after ${SCAN_TIMEOUT_MS / 1000}s.` : status === 'error' ? redactSecrets(err?.message ?? 'Scan failed') : 'No output.'),
          truncated,
        })
      },
    )
  })
}
