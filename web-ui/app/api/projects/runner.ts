/**
 * Project scaffolder + registry for the admin-only /projects panel.
 *
 * Scaffolding wraps scripts/create-project.sh. That script is an interactive
 * wizard, so we drive it by writing a fixed answer script to its stdin: the
 * caller picks a TEMPLATE (an allow-listed id, never a script path, argument or
 * flag) and a project NAME, and this module expands those into the wizard's
 * answer sequence. execFile runs bash with no shell, so no answer can reach a
 * command line, and the argv is built entirely server-side.
 *
 * The answer sequences below were derived by running the real script and
 * recording the prompts it asks, in order, for each branch. They are positional:
 * adding, removing or reordering a prompt in the wizard silently shifts every
 * later answer, so the `template still selects its own branch` test in
 * test/projects.test.js re-derives this by execution rather than trusting it.
 */
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { resolveRepoRoot, sanitizeOutput, scanEnv } from '../security-scan/scanners'

export type TemplateId = 'nextjs' | 'react-vite' | 'react-native' | 'nestjs'

export interface TemplateDef {
  id: TemplateId
  label: string
  description: string
}

export const TEMPLATES: readonly TemplateDef[] = [
  {
    id: 'nextjs',
    label: 'Next.js',
    description: 'Web app with the App Router, TypeScript, Tailwind and shadcn/ui.',
  },
  {
    id: 'react-vite',
    label: 'React + Vite',
    description: 'Web SPA with Vite, TypeScript and Tailwind.',
  },
  {
    id: 'react-native',
    label: 'React Native (Expo)',
    description: 'Mobile app with Expo, expo-router and NativeWind.',
  },
  {
    id: 'nestjs',
    label: 'NestJS',
    description: 'TypeScript backend API with auth, validation and config modules.',
  },
]

/** create-project.sh, resolved on the server only — never from the request. */
export const CREATE_PROJECT_SCRIPT = 'scripts/create-project.sh'

export const SCAFFOLD_TIMEOUT_MS = 300_000
const MAX_BUFFER_BYTES = 8 * 1024 * 1024
export const MAX_NAME_LENGTH = 64

/**
 * The wizard asks for the project type before the framework, and the two
 * branches ask a different number of questions. These are the answer slots for
 * manual mode, in the order the script reads them.
 *
 * Positions, from the recorded run of manual mode:
 *   1 mode          2 project name   3 project type   4 framework
 *   5 language      6 tailwind       7 UI library     8 state
 *   9 auth          10 backend/API  11 testing       12 git
 *   13 CI/CD       14 deploy        15 proceed
 */
const MODE_MANUAL = '2'
const TYPE_FRONTEND = '1'
const TYPE_BACKEND = '2'
const FRAMEWORK_CHOICE = { 'nextjs': '2', 'react-vite': '3', 'react-native': '1', nestjs: '1' } as const
const DEPLOY_CHOICE = { 'nextjs': '5', 'react-vite': '5', 'react-native': '4', nestjs: '5' } as const

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && TEMPLATES.some(t => t.id === value)
}

export function getTemplate(id: TemplateId): TemplateDef {
  const template = TEMPLATES.find(t => t.id === id)
  if (!template) throw new Error(`Unknown project template: ${id}`)
  return template
}

/**
 * A project name becomes a directory name (`npx create-next-app <name>`) and is
 * written straight into the wizard's stdin, so it must be a single plain path
 * segment: no separators, no traversal, no shell/control characters, no leading
 * dash (the scaffolders treat a leading "-" as an option).
 */
export function validateProjectName(value: unknown): { value?: string; error?: string } {
  if (typeof value !== 'string') return { error: 'A project name is required' }
  const name = value.trim()
  if (!name) return { error: 'A project name is required' }
  if (name.length > MAX_NAME_LENGTH) return { error: `Project name must be at most ${MAX_NAME_LENGTH} characters` }
  if (name.startsWith('-')) return { error: 'Project name must not start with "-"' }
  if (/[\u0000-\u001f\u007f]/.test(name)) return { error: 'Project name must be a single line of plain text' }
  if (/[/\\]/.test(name)) return { error: 'Project name must be a single folder name, without "/" or "\\"' }
  if (name === '.' || name === '..') return { error: 'Project name must be a folder name' }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    return { error: 'Project name may only use letters, digits, dot, dash and underscore' }
  }
  return { value: name }
}

/**
 * The lines fed to create-project.sh's stdin. Fixed choices only — the project
 * name is the sole caller-supplied value, and it has already been validated.
 */
export function scaffoldAnswers(template: TemplateId, name: string): string {
  const backend = template === 'nestjs'
  return [
    MODE_MANUAL,                       // how to set up: manual
    name,                              // project name
    backend ? TYPE_BACKEND : TYPE_FRONTEND,
    FRAMEWORK_CHOICE[template],        // framework (nestjs: the backend framework)
    '1',                               // language: TypeScript
    'y',                               // use Tailwind
    '1',                               // UI library: shadcn/ui
    '1',                               // state: Zustand + React Query
    '5',                               // auth: none
    '3',                               // backend/API: none
    '1',                               // testing: full
    '4',                               // git: skip (never pushes from a web request)
    '3',                               // CI/CD: skip
    DEPLOY_CHOICE[template],           // deployment
    'y',                               // ready to generate
  ].join('\n') + '\n'
}

/** Full argv for bash: the script under the server-resolved root, no user arguments. */
export function scaffoldArgv(root: string): string[] {
  return [path.join(root, CREATE_PROJECT_SCRIPT)]
}

// ── Registered projects (the same list the TUI shows) ────────────────────────

const REGISTERED_FILE = '.registered-projects'
const MAX_REGISTERED = 200

function readRegistered(root: string): string[] {
  try {
    return fs.readFileSync(path.join(root, REGISTERED_FILE), 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, MAX_REGISTERED)
  } catch {
    return []
  }
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

/** A project is "open" when it is a directory that carries the GhostForge toolkit. */
function toolkitInstalled(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'ghostforge'))
    || fs.existsSync(path.join(dir, '.github', 'copilot-instructions.md'))
}

export interface ProjectSummary {
  path: string
  name: string
  exists: boolean
  toolkit: boolean
}

/** Absolute paths only: a relative entry would depend on the server's cwd. */
function absoluteEntry(root: string, entry: string): string | null {
  return path.isAbsolute(entry) ? path.normalize(entry) : path.resolve(root, entry)
}

export function listProjects(root = resolveRepoRoot()): ProjectSummary[] {
  return readRegistered(root).map(entry => {
    const full = absoluteEntry(root, entry)
    const exists = full !== null && isDirectory(full)
    return {
      path: full ?? entry,
      name: path.basename(full ?? entry),
      exists,
      toolkit: exists && toolkitInstalled(full!),
    }
  })
}

// ── Running the scaffolder ───────────────────────────────────────────────────

export type ScaffoldResult =
  | { status: 'unavailable'; template: TemplateId }
  | { status: 'cancelled' }
  | { status: 'pass' | 'fail' | 'error' | 'timeout'; template: TemplateId; projectPath: string; exitCode: number | null; durationMs: number; output: string; truncated: boolean }

export interface ScaffoldDeps {
  root?: string
  env?: NodeJS.ProcessEnv
  bash?: string
  exists?: (file: string) => boolean
  exec?: typeof execFile
}

/** Where a scaffolded project lands: the web server's repo root, the script's cwd. */
function projectPathFor(root: string, name: string): string {
  return path.join(root, name)
}

export function runScaffold(template: TemplateId, name: string, deps: ScaffoldDeps = {}): Promise<ScaffoldResult> {
  const root = deps.root ?? resolveRepoRoot()
  const exists = deps.exists ?? fs.existsSync
  const exec = deps.exec ?? execFile
  const script = path.join(root, CREATE_PROJECT_SCRIPT)

  if (!exists(script)) return Promise.resolve({ status: 'unavailable', template })

  const started = Date.now()
  return new Promise(resolve => {
    const child = exec(
      deps.bash ?? 'bash',
      scaffoldArgv(root),
      {
        cwd: root,
        env: scanEnv(deps.env),
        timeout: SCAFFOLD_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string | null; code?: number | string }) | null
        const combined = [String(stdout ?? ''), String(stderr ?? '')].filter(s => s.trim()).join('\n')
        const { text, truncated } = sanitizeOutput(combined)
        const projectPath = projectPathFor(root, name)
        // "Cancelled." is the wizard's own response to a negative proceed answer.
        if (/^Cancelled\.$/m.test(text)) {
          resolve({ status: 'cancelled' })
          return
        }
        const overflow = err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        const timedOut = !overflow && Boolean(err?.killed && err.signal === 'SIGTERM')
        const exitCode = err ? (typeof err.code === 'number' ? err.code : null) : 0
        const status = timedOut ? 'timeout' : !err ? 'pass' : typeof err.code === 'number' ? 'fail' : 'error'
        resolve({
          status,
          template,
          projectPath,
          exitCode,
          durationMs: Date.now() - started,
          output: text || (timedOut
            ? `Scaffolding stopped after ${SCAFFOLD_TIMEOUT_MS / 1000}s.`
            : status === 'error' ? 'The scaffolder could not be started. Is bash installed?' : 'No output.'),
          truncated,
        })
      },
    )
    // The wizard reads its answers from stdin; execFile gives us the writable end.
    const stdin = child.stdin
    if (stdin) {
      stdin.on('error', () => { /* the child may exit before reading everything */ })
      stdin.end(scaffoldAnswers(template, name))
    }
  })
}