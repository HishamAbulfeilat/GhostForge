/**
 * Tickets / Azure DevOps / estimate runner for the admin-only /tickets panel.
 *
 * Only the commands in TICKET_COMMANDS can run, each with a fixed script and a
 * fixed leading argv. The two commands that take free text (ticket id, task
 * description) validate it strictly and pass it as a single argv entry through
 * execFile (no shell). Output is ANSI-stripped, secret-redacted and capped
 * (shared with the security-scan runner).
 */
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { resolveRepoRoot, sanitizeOutput, scanEnv, redactSecrets } from '../security-scan/scanners'

export type TicketCommandId = 'ticket' | 'ado-status' | 'ado-tickets' | 'ado-pipelines' | 'estimate'

export interface TicketCommandDef {
  id: TicketCommandId
  label: string
  description: string
  /** Script path relative to the repository root */
  script: string
  /** Fixed leading script arguments (never derived from user input) */
  scriptArgs: readonly string[]
  /** Free-text input this command requires, if any */
  input?: 'ticket-id' | 'description'
}

export const TICKET_TIMEOUT_MS = 60_000
const MAX_BUFFER_BYTES = 2 * 1024 * 1024
export const MAX_DESCRIPTION_CHARS = 500

export const TICKET_COMMANDS: readonly TicketCommandDef[] = [
  {
    id: 'ticket',
    label: 'Ticket scaffold',
    description: 'Suggests a branch name, commit template and file layout for a ticket id such as PROJ-123 (scripts/ticket.sh). Creates nothing.',
    script: 'scripts/ticket.sh',
    scriptArgs: [],
    input: 'ticket-id',
  },
  {
    id: 'ado-status',
    label: 'Azure DevOps status',
    description: 'Checks the Azure DevOps connection configured on this server (scripts/ado.sh status).',
    script: 'scripts/ado.sh',
    scriptArgs: ['status'],
  },
  {
    id: 'ado-tickets',
    label: 'Azure DevOps work items',
    description: 'Lists your Azure DevOps work items, read only (scripts/ado.sh tickets).',
    script: 'scripts/ado.sh',
    scriptArgs: ['tickets'],
  },
  {
    id: 'ado-pipelines',
    label: 'Azure DevOps pipeline runs',
    description: 'Lists recent Azure DevOps pipeline runs, read only (scripts/ado.sh pipelines).',
    script: 'scripts/ado.sh',
    scriptArgs: ['pipelines'],
  },
  {
    id: 'estimate',
    label: 'Story point estimate',
    description: 'Estimates story points for a described task from the size and complexity of this repository (scripts/estimate.sh).',
    script: 'scripts/estimate.sh',
    scriptArgs: [],
    input: 'description',
  },
]

export function isTicketCommandId(value: unknown): value is TicketCommandId {
  return typeof value === 'string' && TICKET_COMMANDS.some(c => c.id === value)
}

export function getTicketCommand(id: TicketCommandId): TicketCommandDef {
  const command = TICKET_COMMANDS.find(c => c.id === id)
  if (!command) throw new Error(`Unknown ticket command: ${id}`)
  return command
}

const TICKET_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,15}-\d{1,8}$/

/** Returns the validated free-text input, or an error message. */
export function validateTicketInput(command: TicketCommandDef, input: unknown): { value?: string; error?: string } {
  if (!command.input) return input === undefined ? {} : { error: 'This command does not take input' }
  if (typeof input !== 'string') return { error: command.input === 'ticket-id' ? 'A ticket id is required' : 'A task description is required' }
  const value = input.trim()
  if (command.input === 'ticket-id') {
    return TICKET_ID_PATTERN.test(value) ? { value } : { error: 'Ticket id must look like PROJ-123' }
  }
  if (!value) return { error: 'A task description is required' }
  if (value.length > MAX_DESCRIPTION_CHARS) return { error: `Description must be at most ${MAX_DESCRIPTION_CHARS} characters` }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return { error: 'Description must be a single line of plain text' }
  // estimate.sh treats leading "--" arguments as options
  if (value.startsWith('-')) return { error: 'Description must not start with "-"' }
  return { value }
}

/** Full argv for bash: the script path under the server-resolved root, fixed arguments, then validated input. */
export function ticketArgv(command: TicketCommandDef, root: string, input?: string): string[] {
  return [path.join(root, command.script), ...command.scriptArgs, ...(input === undefined ? [] : [input])]
}

export interface TicketCommandStatus {
  id: TicketCommandId
  label: string
  description: string
  input: TicketCommandDef['input'] | null
  available: boolean
}

export interface TicketRunDeps {
  root?: string
  env?: NodeJS.ProcessEnv
  bash?: string
  exists?: (file: string) => boolean
  exec?: typeof execFile
}

function rootOf(deps: TicketRunDeps): string {
  return deps.root ?? resolveRepoRoot()
}

export function listTicketCommands(deps: TicketRunDeps = {}): TicketCommandStatus[] {
  const r = rootOf(deps)
  const exists = deps.exists ?? fs.existsSync
  return TICKET_COMMANDS.map(c => ({
    id: c.id,
    label: c.label,
    description: c.description,
    input: c.input ?? null,
    available: exists(path.join(r, c.script)),
  }))
}

export type TicketRunResult =
  | { id: TicketCommandId; status: 'unavailable' }
  | { id: TicketCommandId; status: 'pass' | 'fail' | 'error' | 'timeout'; exitCode: number | null; durationMs: number; output: string; truncated: boolean }

export function runTicketCommand(id: TicketCommandId, input?: string, deps: TicketRunDeps = {}): Promise<TicketRunResult> {
  const command = getTicketCommand(id)
  const checked = validateTicketInput(command, input)
  if (checked.error) throw new Error(checked.error)
  const r = rootOf(deps)
  const exists = deps.exists ?? fs.existsSync
  const exec = deps.exec ?? execFile

  if (!exists(path.join(r, command.script))) return Promise.resolve({ id, status: 'unavailable' })

  const started = Date.now()
  return new Promise(resolve => {
    exec(
      deps.bash ?? 'bash',
      ticketArgv(command, r, checked.value),
      {
        cwd: r,
        env: scanEnv(deps.env),
        timeout: TICKET_TIMEOUT_MS,
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
          output: text || (status === 'timeout' ? `Run stopped after ${TICKET_TIMEOUT_MS / 1000}s.` : status === 'error' ? redactSecrets(err?.message ?? 'Run failed') : 'No output.'),
          truncated,
        })
      },
    )
  })
}
