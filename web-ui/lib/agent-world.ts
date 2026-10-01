export type AgentWorldTheme = 'taskville' | 'office' | 'town'
export type AgentWorldVariant = 'product' | 'maintainer'

export type AgentWorldAgent = {
  provider: string | null
  state: string
  task: string | null
  model: string | null
  since: string | null
  cooldownUntil: string | null
  enabled?: boolean
  role?: string
  strengths?: string[]
  branch?: string | null
}

export type AgentWorldTask = {
  id: string | null
  title: string
  kind: string
  status: string
  owner: string | null
}

export type AgentWorldMessage = {
  ts?: string | number | null
  from?: string | null
  to?: string | null
  text?: string | null
}

export type AgentWorldSnapshot = {
  health: number | null
  running: boolean
  agents: Record<string, AgentWorldAgent>
  tasks: AgentWorldTask[]
  messages: AgentWorldMessage[]
  phase: number
}

export type AgentWorldNode = {
  id: string
  label: string
  kind: 'agent' | 'workflow'
  role: string
  source: string
  status: string
  task: string
  progress: number
  stale: boolean
  active: boolean
  enabled: boolean
  details: string[]
}

export type AgentWorldEdge = {
  id: string
  from: string
  to: string
  label: string
  type: 'owner' | 'message'
}

export type AgentWorldProjection = {
  title: string
  subtitle: string
  summary: {
    online: number
    tasks: number
    active: number
    blocked: number
    health: number | null
    phase: number
  }
  nodes: AgentWorldNode[]
  edges: AgentWorldEdge[]
  notices: string[]
  ready: boolean
}

export const THEME_OPTIONS: Array<{ id: AgentWorldTheme; label: string; description: string }> = [
  { id: 'taskville', label: 'TaskVille', description: 'Work arranged as live delivery lanes' },
  { id: 'town', label: 'AI Town', description: 'Agents and workflows grouped as districts' },
  { id: 'office', label: 'Agent Office', description: 'A focused roster of desks and review pods' },
]

const ACTIVE_STATES = new Set(['active', 'in-progress', 'review', 'running', 'working'])
const COMPLETE_STATES = new Set(['completed', 'done', 'success'])
const BLOCKED_STATES = new Set(['blocked', 'error', 'stalled'])

export function getThemeStorageKey(variant: AgentWorldVariant): string {
  return `ghostforge-agent-world-theme:${variant}`
}

export function listThemeLabels(): string[] {
  return THEME_OPTIONS.map(theme => theme.label)
}

export function statusProgress(status: string): number {
  const normalized = normalizeStatus(status)
  if (COMPLETE_STATES.has(normalized)) return 1
  if (['pending-review', 'review', 'waiting-merge'].includes(normalized)) return 0.8
  if (ACTIVE_STATES.has(normalized)) return 0.65
  if (['queued', 'todo', 'waiting'].includes(normalized)) return 0.25
  if (BLOCKED_STATES.has(normalized)) return 0.2
  if (['idle', 'ready', 'unknown'].includes(normalized)) return 0
  return 0.35
}

function normalizeStatus(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replaceAll('_', '-') || 'unknown'
}

function isFreshActivity(since: string | null, now: number): boolean {
  if (!since) return false
  const timestamp = Date.parse(since)
  return Number.isFinite(timestamp) && now - timestamp <= 15 * 60 * 1000
}

function safeHealth(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null
}

export function sanitizeText(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/(token|secret|api[_-]?key|password|authorization)\s*[:=]\s*[^\s\n]+/gi, '$1=[redacted]')
    .replace(/[A-Za-z]:\\[^\s\n]+/g, '[local path redacted]')
    .replace(/(?:^|\s)\/(?:Users|home|var|tmp)\/[^\s\n]+/g, ' [local path redacted]')
    .trim()
}

function taskNodeId(task: AgentWorldTask, index: number): string {
  const identity = sanitizeText(task.id) || sanitizeText(task.title) || `task-${index + 1}`
  return `task:${identity}`
}

export function deriveWorkflowEdges(
  tasks: AgentWorldTask[],
  agents: Record<string, AgentWorldAgent>,
  messages: AgentWorldMessage[] = [],
): AgentWorldEdge[] {
  const edges: AgentWorldEdge[] = []
  const seen = new Set<string>()

  tasks.forEach((task, index) => {
    const owner = task.owner?.trim()
    if (!owner || !(owner in agents)) return
    const to = taskNodeId(task, index)
    const id = `owner:${owner}->${to}`
    if (seen.has(id)) return
    seen.add(id)
    edges.push({ id, from: owner, to, label: normalizeStatus(task.status), type: 'owner' })
  })

  messages.forEach(message => {
    const from = message.from?.trim()
    const to = message.to?.trim()
    if (!from || !to || from === to || !(from in agents) || !(to in agents)) return
    const id = `message:${from}->${to}`
    if (seen.has(id)) return
    seen.add(id)
    edges.push({ id, from, to, label: 'coordination', type: 'message' })
  })

  return edges
}

export function deriveAgentWorldProjection(
  snapshot: AgentWorldSnapshot | null | undefined,
  variant: AgentWorldVariant,
  now = Date.now(),
): AgentWorldProjection {
  const source: AgentWorldSnapshot = snapshot ?? {
    health: null,
    running: false,
    agents: {},
    tasks: [],
    messages: [],
    phase: 1,
  }
  const tasks = Array.isArray(source.tasks) ? source.tasks : []
  const messages = Array.isArray(source.messages) ? source.messages : []
  const agents = source.agents && typeof source.agents === 'object' ? source.agents : {}
  const visibleAgentEntries = Object.entries(agents).filter(([, agent]) => (
    variant === 'maintainer' || (agent.enabled !== false && normalizeStatus(agent.state) !== 'disabled')
  ))
  const visibleAgents = Object.fromEntries(visibleAgentEntries)

  const agentNodes: AgentWorldNode[] = visibleAgentEntries.map(([id, agent]) => {
    const state = normalizeStatus(agent.state)
    const active = ACTIVE_STATES.has(state)
    const enabled = agent.enabled !== false
    const stale = active && !isFreshActivity(agent.since, now)
    const assignedTask = tasks.find(task => task.owner === id && !COMPLETE_STATES.has(normalizeStatus(task.status)))
    const progressStatus = assignedTask?.status ?? state
    const strengths = Array.isArray(agent.strengths) ? agent.strengths.map(sanitizeText).filter(Boolean) : []
    const privateDetails = [
      `role: ${sanitizeText(agent.role) || 'worker'}`,
      agent.model ? `model: ${sanitizeText(agent.model)}` : '',
      agent.branch ? `branch: ${sanitizeText(agent.branch)}` : '',
      strengths.length ? `strengths: ${strengths.join(', ')}` : '',
      enabled ? 'configured: enabled' : 'configured: disabled',
    ].filter(Boolean)
    const publicDetails = [
      `provider: ${sanitizeText(agent.provider) || 'unknown'}`,
      active ? (stale ? 'activity: stale' : 'activity: current') : `activity: ${state}`,
    ]

    return {
      id,
      label: sanitizeText(id),
      kind: 'agent',
      role: sanitizeText(agent.role) || (variant === 'maintainer' ? 'worker' : 'agent'),
      source: sanitizeText(agent.provider) || 'local',
      status: enabled ? state : 'disabled',
      task: sanitizeText(assignedTask?.title ?? agent.task) || 'No active task',
      progress: statusProgress(progressStatus),
      stale,
      active,
      enabled,
      details: variant === 'maintainer' ? privateDetails : publicDetails,
    }
  })

  const taskNodes: AgentWorldNode[] = tasks.map((task, index) => {
    const status = normalizeStatus(task.status)
    const rawOwner = sanitizeText(task.owner)
    const owner = rawOwner && (variant === 'maintainer' || rawOwner in visibleAgents) ? rawOwner : 'unassigned'
    return {
      id: taskNodeId(task, index),
      label: sanitizeText(task.id) || `Task ${index + 1}`,
      kind: 'workflow',
      role: sanitizeText(task.kind) || 'task',
      source: owner,
      status,
      task: sanitizeText(task.title) || 'Untitled task',
      progress: statusProgress(status),
      stale: BLOCKED_STATES.has(status),
      active: !COMPLETE_STATES.has(status) && !BLOCKED_STATES.has(status),
      enabled: true,
      details: [`owner: ${owner}`, `kind: ${sanitizeText(task.kind) || 'task'}`, `status: ${status}`],
    }
  })

  const nodes = [...agentNodes, ...taskNodes]
  const edges = deriveWorkflowEdges(tasks, visibleAgents, variant === 'maintainer' ? messages : [])
  const activeTasks = tasks.filter(task => {
    const status = normalizeStatus(task.status)
    return !COMPLETE_STATES.has(status) && !BLOCKED_STATES.has(status)
  }).length
  const blockedTasks = tasks.filter(task => BLOCKED_STATES.has(normalizeStatus(task.status))).length
  const online = agentNodes.filter(node => node.enabled && node.active && !node.stale).length
  const notices: string[] = []

  if (!nodes.length) notices.push('No agent or workflow data is available in the current snapshot.')
  if (!source.running) notices.push('The agent team is offline. This view shows the latest stored snapshot.')
  if (variant === 'maintainer' && !agentNodes.length) {
    notices.push('No configured Copilot or Claude sessions are present in the current workspace snapshot.')
  }

  return {
    title: variant === 'maintainer' ? 'GhostForge Maintainer World' : 'GhostForge Agent World',
    subtitle: variant === 'maintainer'
      ? 'Private workspace monitor for configured sessions, active work, and coordination.'
      : 'Operator-safe view of the agents and workflows active across this GhostForge project.',
    summary: {
      online,
      tasks: tasks.length,
      active: activeTasks,
      blocked: blockedTasks,
      health: safeHealth(source.health),
      phase: Number.isFinite(source.phase) && source.phase > 0 ? source.phase : 1,
    },
    nodes,
    edges,
    notices,
    ready: nodes.length > 0,
  }
}
