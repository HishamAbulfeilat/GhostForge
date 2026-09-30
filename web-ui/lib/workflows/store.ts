/**
 * Workflow engine storage — one JSON file per GhostForge user:
 *   ~/.ghostforge/workflows/<username>.json
 *
 * A workflow is a plan: an ordered/dependent set of steps that each map to an
 * agent, a skill, a shell command, or a manual task. GhostForge (and JARVIS)
 * author, visualize and track workflows here; execution is driven by the agent
 * layer, which updates step status as it progresses.
 */
import { mkdir, readFile, writeFile, rename, readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

export type StepKind = 'agent' | 'skill' | 'command' | 'manual'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked' | 'skipped'
export type WorkflowStatus = 'draft' | 'running' | 'paused' | 'done' | 'failed'

export interface WorkflowStep {
  id: string
  title: string
  kind: StepKind
  /** agent name / skill name / command string / free text for manual */
  ref: string
  /** step ids this step depends on */
  deps: string[]
  status: StepStatus
  notes: string
  startedAt?: string
  finishedAt?: string
  log: Array<{ at: string; msg: string }>
}

export interface Workflow {
  id: string
  name: string
  goal: string
  status: WorkflowStatus
  steps: WorkflowStep[]
  createdAt: string
  updatedAt: string
}

export interface WorkflowInput {
  name: string
  goal?: string
  steps?: Array<Partial<WorkflowStep> & { title: string }>
}

// ── per-user lock + atomic write (same discipline as the job-hunter store) ──────
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(key, next.catch(() => {}))
  return next
}

function safeUser(username: string): string {
  const u = String(username || '').toLowerCase().replace(/[^a-z0-9._-]/g, '')
  if (!u || u.startsWith('.')) throw new Error('Invalid username')
  return u
}

function dir(): string {
  return join(homedir(), '.ghostforge', 'workflows')
}
function userFile(username: string): string {
  return join(dir(), `${safeUser(username)}.json`)
}

async function readAll(username: string): Promise<Workflow[]> {
  try {
    const raw = JSON.parse(await readFile(userFile(username), 'utf8')) as { workflows?: Workflow[] }
    return Array.isArray(raw.workflows) ? raw.workflows : []
  } catch {
    return []
  }
}

async function writeAll(username: string, workflows: Workflow[]): Promise<void> {
  await mkdir(dir(), { recursive: true })
  const path = userFile(username)
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify({ workflows }, null, 2), 'utf8')
  await rename(tmp, path)
}

const now = () => new Date().toISOString()
const sid = () => randomUUID().slice(0, 8)

function normalizeStep(s: Partial<WorkflowStep> & { title: string }, knownIds: Set<string>): WorkflowStep {
  const kind: StepKind = (['agent', 'skill', 'command', 'manual'] as const).includes(s.kind as StepKind) ? s.kind as StepKind : 'manual'
  const id = s.id && !knownIds.has(s.id) ? s.id : sid()
  knownIds.add(id)
  return {
    id,
    title: String(s.title || 'Untitled step').slice(0, 200),
    kind,
    ref: String(s.ref || '').slice(0, 2000),
    deps: Array.isArray(s.deps) ? s.deps.map(String) : [],
    status: (['pending', 'running', 'done', 'failed', 'blocked', 'skipped'] as const).includes(s.status as StepStatus) ? s.status as StepStatus : 'pending',
    notes: String(s.notes || '').slice(0, 4000),
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    log: Array.isArray(s.log) ? s.log.slice(-50) : [],
  }
}

// ── public API ─────────────────────────────────────────────────────────────

export async function listWorkflows(username: string): Promise<Workflow[]> {
  return (await readAll(username)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

export async function getWorkflow(username: string, id: string): Promise<Workflow | null> {
  return (await readAll(username)).find(w => w.id === id) || null
}

export function createWorkflow(username: string, input: WorkflowInput): Promise<Workflow> {
  return withLock(userFile(username), async () => {
    const all = await readAll(username)
    const ids = new Set<string>()
    const wf: Workflow = {
      id: sid(),
      name: String(input.name || 'Untitled workflow').slice(0, 200),
      goal: String(input.goal || '').slice(0, 4000),
      status: 'draft',
      steps: (input.steps || []).slice(0, 100).map(s => normalizeStep(s, ids)),
      createdAt: now(),
      updatedAt: now(),
    }
    all.push(wf)
    await writeAll(username, all)
    return wf
  })
}

export function updateWorkflow(
  username: string,
  id: string,
  patch: Partial<Pick<Workflow, 'name' | 'goal' | 'status'>> & { steps?: WorkflowInput['steps'] },
): Promise<Workflow | null> {
  return withLock(userFile(username), async () => {
    const all = await readAll(username)
    const wf = all.find(w => w.id === id)
    if (!wf) return null
    if (patch.name !== undefined) wf.name = String(patch.name).slice(0, 200)
    if (patch.goal !== undefined) wf.goal = String(patch.goal).slice(0, 4000)
    if (patch.status !== undefined) wf.status = patch.status
    if (patch.steps !== undefined) {
      const ids = new Set<string>()
      wf.steps = patch.steps.slice(0, 100).map(s => normalizeStep(s, ids))
    }
    wf.updatedAt = now()
    await writeAll(username, all)
    return wf
  })
}

export function updateStep(
  username: string,
  workflowId: string,
  stepId: string,
  patch: Partial<Pick<WorkflowStep, 'status' | 'notes' | 'title' | 'ref'>>,
  logMsg?: string,
): Promise<Workflow | null> {
  return withLock(userFile(username), async () => {
    const all = await readAll(username)
    const wf = all.find(w => w.id === workflowId)
    const step = wf?.steps.find(s => s.id === stepId)
    if (!wf || !step) return null
    if (patch.status !== undefined) {
      step.status = patch.status
      if (patch.status === 'running' && !step.startedAt) step.startedAt = now()
      if (patch.status === 'done' || patch.status === 'failed') step.finishedAt = now()
    }
    if (patch.notes !== undefined) step.notes = String(patch.notes).slice(0, 4000)
    if (patch.title !== undefined) step.title = String(patch.title).slice(0, 200)
    if (patch.ref !== undefined) step.ref = String(patch.ref).slice(0, 2000)
    if (logMsg) step.log = [...(step.log || []), { at: now(), msg: String(logMsg).slice(0, 500) }].slice(-50)
    // Roll workflow status up from its steps
    if (wf.steps.some(s => s.status === 'running')) wf.status = 'running'
    else if (wf.steps.length && wf.steps.every(s => s.status === 'done' || s.status === 'skipped')) wf.status = 'done'
    else if (wf.steps.some(s => s.status === 'failed')) wf.status = 'failed'
    wf.updatedAt = now()
    await writeAll(username, all)
    return wf
  })
}

export function deleteWorkflow(username: string, id: string): Promise<boolean> {
  return withLock(userFile(username), async () => {
    const all = await readAll(username)
    const next = all.filter(w => w.id !== id)
    if (next.length === all.length) return false
    await writeAll(username, next)
    return true
  })
}

/** Overall progress for display */
export function progress(wf: Workflow): { done: number; total: number; pct: number } {
  const total = wf.steps.length
  const done = wf.steps.filter(s => s.status === 'done' || s.status === 'skipped').length
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

/** Steps whose dependencies are all satisfied and are still pending — the runnable set */
export function readySteps(wf: Workflow): WorkflowStep[] {
  const doneIds = new Set(wf.steps.filter(s => s.status === 'done' || s.status === 'skipped').map(s => s.id))
  return wf.steps.filter(s => s.status === 'pending' && s.deps.every(d => doneIds.has(d)))
}

/** Every user with workflow data (for schedulers / JARVIS) */
export async function listWorkflowUsers(): Promise<string[]> {
  try {
    return (await readdir(dir())).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
  } catch {
    return []
  }
}
