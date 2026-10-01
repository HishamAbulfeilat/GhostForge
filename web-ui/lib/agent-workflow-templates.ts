import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const MAX_TEMPLATES = 50
export const MAX_TEMPLATE_BYTES = 8192
export const MAX_STORAGE_BYTES = 128 * 1024
const TEMPLATE_KINDS = ['feature', 'bugfix', 'security', 'performance', 'refactor', 'test', 'docs', 'chore'] as const
const WORKFLOW_MODES = ['ordered', 'parallel'] as const
const TEMPLATE_KEYS = ['name', 'title', 'kind', 'leader', 'assignee', 'workflow', 'dependencies', 'acceptanceCriteria'] as const
const SAVED_KEYS = [...TEMPLATE_KEYS, 'id', 'createdAt'] as const
const locks = new Map<string, Promise<unknown>>()

export interface AgentWorkflowTemplateInput {
  name: string
  title: string
  kind: typeof TEMPLATE_KINDS[number]
  leader: string
  assignee: string
  workflow: typeof WORKFLOW_MODES[number]
  dependencies: string[]
  acceptanceCriteria: string[]
}

export interface AgentWorkflowTemplate extends AgentWorkflowTemplateInput {
  id: string
  createdAt: string
}

export class AgentWorkflowTemplateError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'AgentWorkflowTemplateError'
    this.status = status
  }
}

function withLock<T>(key: string, callback: () => T): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.then(callback, callback)
  locks.set(key, next.catch(() => {}))
  return next
}

function safeUsername(username: string): string {
  if (typeof username !== 'string' || !username.trim() || username.length > 128) {
    throw new AgentWorkflowTemplateError('A valid admin account is required.')
  }
  return crypto.createHash('sha256').update(username.trim().toLowerCase()).digest('hex')
}

function storageFile(username: string, storageRoot = path.join(os.homedir(), '.ghostforge', 'agent-workflow-templates')): string {
  return path.join(storageRoot, `${safeUsername(username)}.json`)
}

function ownKeysExactly(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every(key => expected.includes(key))
}

function safeText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new AgentWorkflowTemplateError(`${field} must be text.`)
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new AgentWorkflowTemplateError(`${field} must be 1-${maxLength} characters without control characters.`)
  }
  return text
}

function safeIdentity(value: unknown, field: string): string {
  const text = safeText(value, field, 64)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw new AgentWorkflowTemplateError(`${field} contains unsupported characters.`)
  }
  return text
}

function normalizeTemplate(input: unknown): AgentWorkflowTemplateInput {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ownKeysExactly(input as Record<string, unknown>, TEMPLATE_KEYS)) {
    throw new AgentWorkflowTemplateError('Template must contain exactly the supported fields.')
  }
  const source = input as Record<string, unknown>
  const name = safeText(source.name, 'Template name', 80)
  const title = safeText(source.title, 'Task title', 180)
  if (title.startsWith('-')) throw new AgentWorkflowTemplateError('Task title cannot start with a dash.')
  if (!(TEMPLATE_KINDS as readonly unknown[]).includes(source.kind)) throw new AgentWorkflowTemplateError('Template task kind is unsupported.')
  if (!(WORKFLOW_MODES as readonly unknown[]).includes(source.workflow)) throw new AgentWorkflowTemplateError('Template workflow mode is unsupported.')
  const leader = safeIdentity(source.leader, 'Workflow leader')
  const assignee = safeIdentity(source.assignee, 'Workflow assignee')
  if (!Array.isArray(source.dependencies) || source.dependencies.length > 20) {
    throw new AgentWorkflowTemplateError('Dependencies must be a list of at most 20 task IDs.')
  }
  const dependencies = source.dependencies.map((entry, index) => {
    const dependency = safeText(entry, `Dependency ${index + 1}`, 64)
    if (!/^[A-Za-z0-9][A-Za-z0-9._#-]*$/.test(dependency)) {
      throw new AgentWorkflowTemplateError(`Dependency ${index + 1} contains unsupported characters.`)
    }
    return dependency
  })
  if (new Set(dependencies).size !== dependencies.length) {
    throw new AgentWorkflowTemplateError('Dependencies cannot contain duplicates.')
  }
  if (!Array.isArray(source.acceptanceCriteria) || source.acceptanceCriteria.length > 20) {
    throw new AgentWorkflowTemplateError('Acceptance criteria must be a list of at most 20 items.')
  }
  const acceptanceCriteria = source.acceptanceCriteria.map((entry, index) => safeText(entry, `Acceptance criterion ${index + 1}`, 240))
  return {
    name,
    title,
    kind: source.kind as AgentWorkflowTemplateInput['kind'],
    leader,
    assignee,
    workflow: source.workflow as AgentWorkflowTemplateInput['workflow'],
    dependencies,
    acceptanceCriteria,
  }
}

function normalizeSavedTemplate(input: unknown): AgentWorkflowTemplate {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ownKeysExactly(input as Record<string, unknown>, SAVED_KEYS)) {
    throw new Error('Stored workflow template has an invalid shape.')
  }
  const source = input as Record<string, unknown>
  const normalized = normalizeTemplate(Object.fromEntries(TEMPLATE_KEYS.map(key => [key, source[key]])))
  if (typeof source.id !== 'string' || !/^[a-f0-9-]{36}$/.test(source.id)) {
    throw new Error('Stored workflow template has an invalid ID.')
  }
  if (typeof source.createdAt !== 'string' || Number.isNaN(Date.parse(source.createdAt))) {
    throw new Error('Stored workflow template has an invalid timestamp.')
  }
  return { ...normalized, id: source.id, createdAt: source.createdAt }
}

function readAll(username: string, storageRoot?: string): AgentWorkflowTemplate[] {
  const file = storageFile(username, storageRoot)
  let fd: number | undefined
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    fd = fs.openSync(file, flags)
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_STORAGE_BYTES) {
      throw new Error('Stored workflow templates exceed the storage limit or are not a regular file.')
    }
    const raw = fs.readFileSync(fd, 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > MAX_STORAGE_BYTES) throw new Error('Stored workflow templates exceed the storage limit.')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1 ||
        !Array.isArray((parsed as { templates?: unknown }).templates) ||
        (parsed as { templates: unknown[] }).templates.length > MAX_TEMPLATES) {
      throw new Error('Stored workflow templates have an invalid format.')
    }
    return (parsed as { templates: unknown[] }).templates.map(normalizeSavedTemplate)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw new Error('Unable to read workflow templates: stored data is invalid or unavailable.')
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function writeAll(username: string, templates: AgentWorkflowTemplate[], storageRoot?: string): void {
  const file = storageFile(username, storageRoot)
  const encoded = JSON.stringify({ version: 1, templates })
  if (Buffer.byteLength(encoded, 'utf8') > MAX_STORAGE_BYTES) {
    throw new AgentWorkflowTemplateError('Workflow template storage limit reached.', 413)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, encoded, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, file)
  } finally {
    try {
      fs.unlinkSync(temporary)
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    }
  }
}

export function listAgentWorkflowTemplates(username: string, storageRoot?: string): AgentWorkflowTemplate[] {
  return readAll(username, storageRoot).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function getAgentWorkflowTemplate(username: string, id: string, storageRoot?: string): AgentWorkflowTemplate | null {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new AgentWorkflowTemplateError('Template ID is invalid.')
  return readAll(username, storageRoot).find(template => template.id === id) ?? null
}

export async function saveAgentWorkflowTemplate(
  username: string,
  input: unknown,
  storageRoot?: string,
): Promise<AgentWorkflowTemplate> {
  const template = normalizeTemplate(input)
  const file = storageFile(username, storageRoot)
  return withLock(file, () => {
    const templates = readAll(username, storageRoot)
    if (templates.length >= MAX_TEMPLATES) {
      throw new AgentWorkflowTemplateError(`At most ${MAX_TEMPLATES} workflow templates can be saved.`, 413)
    }
    if (templates.some(existing => existing.name.toLowerCase() === template.name.toLowerCase())) {
      throw new AgentWorkflowTemplateError('A template with that name already exists.', 409)
    }
    const saved = { ...template, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    const next = [...templates, saved]
    if (Buffer.byteLength(JSON.stringify({ version: 1, templates: next }), 'utf8') > MAX_STORAGE_BYTES ||
        Buffer.byteLength(JSON.stringify(saved), 'utf8') > MAX_TEMPLATE_BYTES) {
      throw new AgentWorkflowTemplateError('Workflow template storage limit reached.', 413)
    }
    writeAll(username, next, storageRoot)
    return saved
  })
}
