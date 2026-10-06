import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const MAX_WORKFLOW_TASKS = 20
export const MAX_WORKFLOW_MEMBERS = 12
export const MAX_WORKFLOW_TEMPLATE_BYTES = 32 * 1024
const KINDS = ['feature', 'bugfix', 'security', 'performance', 'refactor', 'test', 'docs', 'chore'] as const
const TEMPLATE_VERSION = 1
const WORKFLOW_TEMPLATE_PREFIX = 'workflow-'

export type WorkflowTaskKind = typeof KINDS[number]
export type WorkflowMode = 'ordered' | 'dependent'

export interface WorkflowMember {
  id: string
  provider: string
  model: string
}

export interface AgentWorkflowTask {
  id: string
  title: string
  kind: WorkflowTaskKind
  assignee: string
  area: string[]
  dependsOn: string[]
  acceptanceCriteria: string[]
}

export interface AgentWorkflowInput {
  name: string
  description: string
  leader: string
  workers: WorkflowMember[]
  mode: WorkflowMode
  tasks: AgentWorkflowTask[]
}

export interface AgentWorkflowTemplate extends AgentWorkflowInput {
  id: string
  version: typeof TEMPLATE_VERSION
}

export interface AgentTeamTemplate {
  id: string
  name: string
  description: string
  agents: string[]
}

export class AgentWorkflowError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'AgentWorkflowError'
    this.status = status
  }
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new AgentWorkflowError(`${field} must be text.`)
  const result = value.trim()
  if (!result || result.length > maxLength || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new AgentWorkflowError(`${field} must be 1-${maxLength} characters without control characters.`)
  }
  return result
}

function identity(value: unknown, field: string): string {
  const result = text(value, field, 64)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result)) {
    throw new AgentWorkflowError(`${field} contains unsupported characters.`)
  }
  return result
}

function stringList(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AgentWorkflowError(`${field} must be a list of at most ${maxItems} items.`)
  }
  return value.map((item, index) => text(item, `${field} ${index + 1}`, maxLength))
}

function exactKeys(source: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.keys(source).length !== keys.length) return false
  const allowed = new Set(keys)
  return Object.keys(source).every(key => allowed.has(key))
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentWorkflowError(`${field} must be an object.`)
  }
  return value as Record<string, unknown>
}

function validateWorkflow(input: unknown): AgentWorkflowInput {
  const source = requireRecord(input, 'Workflow')
  const keys = ['name', 'description', 'leader', 'workers', 'mode', 'tasks']
  if (!exactKeys(source, keys)) throw new AgentWorkflowError('Workflow must contain exactly the supported fields.')

  const name = text(source.name, 'Workflow name', 80)
  const description = text(source.description, 'Workflow description', 240)
  const leader = identity(source.leader, 'Workflow leader')
  if (source.mode !== 'ordered' && source.mode !== 'dependent') {
    throw new AgentWorkflowError('Workflow mode must be ordered or dependent.')
  }
  if (!Array.isArray(source.workers) || source.workers.length < 1 || source.workers.length > MAX_WORKFLOW_MEMBERS) {
    throw new AgentWorkflowError(`Choose 1-${MAX_WORKFLOW_MEMBERS} workflow workers.`)
  }
  const workers = source.workers.map((entry, index) => {
    const member = requireRecord(entry, `Worker ${index + 1}`)
    if (!exactKeys(member, ['id', 'provider', 'model'])) {
      throw new AgentWorkflowError(`Worker ${index + 1} must contain exactly an ID, provider, and model.`)
    }
    return {
      id: identity(member.id, `Worker ${index + 1} ID`),
      provider: text(member.provider, `Worker ${index + 1} provider`, 64),
      model: text(member.model, `Worker ${index + 1} model`, 128),
    }
  })
  if (new Set(workers.map(worker => worker.id)).size !== workers.length) {
    throw new AgentWorkflowError('Workflow workers cannot contain duplicates.')
  }

  if (!Array.isArray(source.tasks) || source.tasks.length < 1 || source.tasks.length > MAX_WORKFLOW_TASKS) {
    throw new AgentWorkflowError(`A workflow must contain 1-${MAX_WORKFLOW_TASKS} tasks.`)
  }
  const tasks = source.tasks.map((entry, index) => {
    const task = requireRecord(entry, `Task ${index + 1}`)
    const taskKeys = ['id', 'title', 'kind', 'assignee', 'area', 'dependsOn', 'acceptanceCriteria']
    if (!exactKeys(task, taskKeys)) {
      throw new AgentWorkflowError(`Task ${index + 1} must contain exactly the supported fields.`)
    }
    const id = identity(task.id, `Task ${index + 1} ID`)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(id)) {
      throw new AgentWorkflowError(`Task ${index + 1} ID contains unsupported characters.`)
    }
    const title = text(task.title, `Task ${index + 1} title`, 180)
    if (title.startsWith('-')) throw new AgentWorkflowError(`Task ${index + 1} title cannot start with a dash.`)
    if (!(KINDS as readonly unknown[]).includes(task.kind)) {
      throw new AgentWorkflowError(`Task ${index + 1} kind is unsupported.`)
    }
    const assignee = identity(task.assignee, `Task ${index + 1} assignee`)
    const area = stringList(task.area, `Task ${index + 1} area`, 10, 180)
    if (area.some(item => item.startsWith('-') || item.includes('..') || item.includes('\\'))) {
      throw new AgentWorkflowError(`Task ${index + 1} area contains an unsupported path.`)
    }
    const dependsOn = stringList(task.dependsOn, `Task ${index + 1} dependency`, MAX_WORKFLOW_TASKS, 64)
    if (new Set(dependsOn).size !== dependsOn.length) {
      throw new AgentWorkflowError(`Task ${index + 1} dependencies cannot contain duplicates.`)
    }
    const acceptanceCriteria = stringList(task.acceptanceCriteria, `Task ${index + 1} acceptance criterion`, 20, 240)
    if (acceptanceCriteria.length === 0) {
      throw new AgentWorkflowError(`Task ${index + 1} must include at least one acceptance criterion.`)
    }
    return {
      id,
      title,
      kind: task.kind as WorkflowTaskKind,
      assignee,
      area,
      dependsOn,
      acceptanceCriteria,
    }
  })

  const taskIds = new Set(tasks.map(task => task.id))
  if (taskIds.size !== tasks.length) throw new AgentWorkflowError('Workflow task IDs must be unique.')
  if (new Set(tasks.map(task => task.title.toLowerCase())).size !== tasks.length) {
    throw new AgentWorkflowError('Workflow task titles must be unique.')
  }
  const workerIds = new Set(workers.map(worker => worker.id))
  if (workerIds.has(leader)) throw new AgentWorkflowError('The workflow leader cannot also be a worker.')
  workerIds.add(leader)
  for (const task of tasks) {
    if (!workerIds.has(task.assignee)) throw new AgentWorkflowError(`Task "${task.title}" is assigned to a worker outside this team.`)
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) throw new AgentWorkflowError(`Task "${task.title}" cannot depend on itself.`)
      if (!taskIds.has(dependency) && !/^T-\d{1,6}$/.test(dependency)) {
        throw new AgentWorkflowError(`Task "${task.title}" has an unknown dependency "${dependency}".`)
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(tasks.map(task => [task.id, task]))
  const visit = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new AgentWorkflowError('Workflow dependencies cannot contain a cycle.')
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (taskIds.has(dependency)) visit(dependency)
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks) visit(task.id)

  return {
    name,
    description,
    leader,
    workers,
    mode: source.mode,
    tasks,
  }
}

export function normalizeAgentWorkflow(input: unknown, availableAgentIds?: readonly string[]): AgentWorkflowInput {
  const workflow = validateWorkflow(input)
  if (availableAgentIds) {
    const available = new Set(availableAgentIds)
    if (!available.has(workflow.leader)) throw new AgentWorkflowError('The selected workflow leader is not an enabled agent.')
    for (const worker of workflow.workers) {
      if (!available.has(worker.id)) throw new AgentWorkflowError(`Workflow worker "${worker.id}" is not enabled.`)
    }
  }
  return workflow
}

export function orderWorkflowTasks(workflow: AgentWorkflowInput): AgentWorkflowTask[] {
  const byId = new Map(workflow.tasks.map(task => [task.id, task]))
  const ordered: AgentWorkflowTask[] = []
  const visited = new Set<string>()
  const visit = (task: AgentWorkflowTask) => {
    if (visited.has(task.id)) return
    for (const dependency of task.dependsOn) {
      const prerequisite = byId.get(dependency)
      if (prerequisite) visit(prerequisite)
    }
    visited.add(task.id)
    ordered.push(task)
  }
  workflow.tasks.forEach(visit)
  return ordered
}

export function resolveWorkflowTaskDependencies(
  workflow: AgentWorkflowInput,
  taskIds: ReadonlyMap<string, string>,
): Array<{ task: AgentWorkflowTask; dependencies: string[] }> {
  const ordered = orderWorkflowTasks(workflow)
  return ordered.map(task => ({
    task,
    dependencies: resolveTaskDependencies(workflow, task, ordered, taskIds),
  }))
}

export function resolveWorkflowTaskDependenciesForTask(
  workflow: AgentWorkflowInput,
  task: AgentWorkflowTask,
  taskIds: ReadonlyMap<string, string>,
): string[] {
  return resolveTaskDependencies(workflow, task, orderWorkflowTasks(workflow), taskIds)
}

function resolveTaskDependencies(
  workflow: AgentWorkflowInput,
  task: AgentWorkflowTask,
  ordered: AgentWorkflowTask[],
  taskIds: ReadonlyMap<string, string>,
): string[] {
  const dependencies = task.dependsOn.map(dependency => {
    if (/^T-\d{1,6}$/.test(dependency)) return dependency
    const resolved = taskIds.get(dependency)
    if (!resolved) throw new AgentWorkflowError(`Workflow dependency "${dependency}" has not been launched yet.`)
    return resolved
  })
  const index = ordered.findIndex(candidate => candidate.id === task.id)
  if (workflow.mode === 'ordered' && index > 0) {
    const previousTask = ordered[index - 1]
    const previousId = taskIds.get(previousTask.id)
    if (!previousId) throw new AgentWorkflowError(`Workflow prerequisite "${previousTask.id}" has not been launched yet.`)
    dependencies.push(previousId)
  }
  return [...new Set(dependencies)]
}

function templateDirectory(workspaceRoot = path.resolve(__dirname, '../..')): string {
  return path.join(workspaceRoot, '.agent-sync', 'templates')
}

function workflowTemplateDirectory(workspaceRoot?: string): string {
  return path.join(templateDirectory(workspaceRoot), 'workflows')
}

function safeFilename(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!slug) throw new AgentWorkflowError('Workflow name must include at least one letter or number.')
  return `${WORKFLOW_TEMPLATE_PREFIX}${slug}.json`
}

function normalizeStoredWorkflow(value: unknown, filename: string): AgentWorkflowTemplate {
  const source = requireRecord(value, 'Workflow template')
  if (!exactKeys(source, ['version', 'type', 'id', 'name', 'description', 'leader', 'workers', 'mode', 'tasks'])) {
    throw new AgentWorkflowError(`Workflow template "${filename}" has an invalid shape.`, 500)
  }
  if (source.version !== TEMPLATE_VERSION || source.type !== 'workflow') {
    throw new AgentWorkflowError(`Workflow template "${filename}" has an unsupported version or type.`, 500)
  }
  const workflow = normalizeAgentWorkflow({
    name: source.name,
    description: source.description,
    leader: source.leader,
    workers: source.workers,
    mode: source.mode,
    tasks: source.tasks,
  })
  const id = identity(source.id, 'Workflow template ID')
  if (id !== filename.slice(WORKFLOW_TEMPLATE_PREFIX.length, -'.json'.length)) {
    throw new AgentWorkflowError(`Workflow template "${filename}" has a mismatched ID.`, 500)
  }
  return { ...workflow, id, version: TEMPLATE_VERSION }
}

function listStoredWorkflowTemplates(workspaceRoot?: string): AgentWorkflowTemplate[] {
  const directory = workflowTemplateDirectory(workspaceRoot)
  let filenames: string[]
  try {
    filenames = fs.readdirSync(directory).filter(name => name.startsWith(WORKFLOW_TEMPLATE_PREFIX) && name.endsWith('.json')).sort()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw new Error('Unable to list workflow templates.')
  }
  return filenames.map(filename => {
    try {
      const file = path.join(directory, filename)
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_WORKFLOW_TEMPLATE_BYTES) {
        throw new Error('Template file is not a bounded regular file.')
      }
      return normalizeStoredWorkflow(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown, filename)
    } catch {
      throw new Error(`Unable to read workflow template "${filename}".`)
    }
  })
}

export function listAgentWorkflowTemplates(
  availableAgentIds?: readonly string[],
  workspaceRoot?: string,
): AgentWorkflowTemplate[] {
  const templates = listStoredWorkflowTemplates(workspaceRoot)
  if (!availableAgentIds) return templates
  const available = new Set(availableAgentIds)
  return templates.filter(template => template.workers.every(worker => available.has(worker.id)) && available.has(template.leader))
}

export function listAgentTeamTemplates(workspaceRoot?: string): AgentTeamTemplate[] {
  const directory = templateDirectory(workspaceRoot)
  let filenames: string[]
  try {
    filenames = fs.readdirSync(directory).filter(name => name.endsWith('.json') && !name.startsWith(WORKFLOW_TEMPLATE_PREFIX)).sort()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw new Error('Unable to list agent team templates.')
  }
  return filenames.map(filename => {
    try {
      const file = path.join(directory, filename)
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_WORKFLOW_TEMPLATE_BYTES) {
        throw new Error('Template file is not a bounded regular file.')
      }
      const parsed = requireRecord(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown, 'Team template')
      const agents = Array.isArray(parsed.agents)
        ? parsed.agents.map((id, index) => identity(id, `Agent ${index + 1} ID`))
        : parsed.agents && typeof parsed.agents === 'object' && !Array.isArray(parsed.agents)
          ? Object.entries(parsed.agents).filter(([, enabled]) => enabled === true).map(([id]) => identity(id, 'Agent ID'))
          : null
      if (!agents || new Set(agents).size !== agents.length) throw new Error('Team template has invalid agents.')
      return {
        id: path.basename(filename, '.json'),
        name: text(parsed.name, 'Team template name', 80),
        description: text(parsed.description, 'Team template description', 240),
        agents,
      }
    } catch {
      throw new Error(`Unable to read agent team template "${filename}".`)
    }
  })
}

export function saveAgentWorkflowTemplate(
  input: unknown,
  availableAgentIds?: readonly string[],
  workspaceRoot?: string,
): AgentWorkflowTemplate {
  const workflow = normalizeAgentWorkflow(input, availableAgentIds)
  const id = safeFilename(workflow.name).slice(WORKFLOW_TEMPLATE_PREFIX.length, -'.json'.length)
  const filename = safeFilename(workflow.name)
  const directory = workflowTemplateDirectory(workspaceRoot)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (listStoredWorkflowTemplates(workspaceRoot).length >= 50) {
    throw new AgentWorkflowError('At most 50 reusable workflow templates can be saved.', 413)
  }
  const target = path.join(directory, filename)
  const saved = { ...workflow, id, version: TEMPLATE_VERSION as typeof TEMPLATE_VERSION }
  const encoded = JSON.stringify({ type: 'workflow', ...saved }, null, 2)
  if (Buffer.byteLength(encoded, 'utf8') > MAX_WORKFLOW_TEMPLATE_BYTES) {
    throw new AgentWorkflowError('Workflow template exceeds the storage limit.', 413)
  }
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, encoded, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    try {
      fs.linkSync(temporary, target)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        throw new AgentWorkflowError('A template with that workflow name already exists.', 409)
      }
      throw error
    }
  } finally {
    try {
      fs.unlinkSync(temporary)
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    }
  }
  return saved
}
