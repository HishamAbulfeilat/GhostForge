import type { AgentWorldData, AgentWorldRecord } from '@/app/agent-world/agent-world-model'

export type AgentWorldTheme = 'forge' | 'office' | 'town'
export type AgentWorldVariant = 'product' | 'maintainer'
export type AgentWorldNodeKind = 'agent' | 'session' | 'workflow' | 'source'

export type AgentWorldNode = {
  id: string
  entityId: string
  scope: string
  label: string
  kind: AgentWorldNodeKind
  role: string
  source: string
  status: string
  task: string
  progress: number | null
  stale: boolean
  active: boolean
  leader: boolean
  details: string[]
}

export type AgentWorldEdge = {
  id: string
  from: string
  to: string
  label: string
  type: 'owner' | 'dependency' | 'message' | 'session' | 'source'
}

export type AgentWorldMeta = {
  health?: number | null
  phase?: number
  running?: boolean
  workflow?: AgentWorldRecord | null
}

export type AgentWorldProjection = {
  nodes: AgentWorldNode[]
  edges: AgentWorldEdge[]
  summary: {
    online: number
    sessions: number
    tasks: number
    active: number
    blocked: number
    sources: number
    health: number | null
    phase: number
  }
  notices: string[]
  ready: boolean
}

export type ScenePosition = {
  x: number
  y: number
}

export const THEME_OPTIONS: Array<{ id: AgentWorldTheme; label: string; description: string }> = [
  { id: 'forge', label: 'GhostForge Forge', description: 'Control hearth, worker anvils, and workflow conduits' },
  { id: 'office', label: 'Agent Office', description: 'Boss room, worker desks, and review pods' },
  { id: 'town', label: 'AI Town', description: 'Source districts, session buildings, and workflow paths' },
]

const ACTIVE_STATES = new Set(['active', 'busy', 'in-progress', 'review', 'running', 'working'])
const COMPLETE_STATES = new Set(['completed', 'done', 'success'])
const BLOCKED_STATES = new Set(['blocked', 'error', 'failed', 'offline', 'stalled'])

export function getThemeStorageKey(variant: AgentWorldVariant): string {
  return `ghostforge-agent-world-theme:${variant}`
}

export function migrateStoredTheme(value: string | null): AgentWorldTheme | null {
  if (value === 'taskville') return 'forge'
  return value === 'forge' || value === 'office' || value === 'town' ? value : null
}

export function listThemeLabels(): string[] {
  return THEME_OPTIONS.map(theme => theme.label)
}

function text(record: AgentWorldRecord, key: string): string {
  return sanitizeText(record[key])
}

function list(record: AgentWorldRecord, key: string): string[] {
  return Array.isArray(record[key])
    ? record[key].map(sanitizeText).filter(Boolean)
    : []
}

function boolean(record: AgentWorldRecord, key: string): boolean {
  return record[key] === true
}

function normalizeStatus(value: unknown): string {
  const normalized = sanitizeText(value).toLowerCase().replaceAll('_', '-')
  return normalized || 'unknown'
}

function entityId(record: AgentWorldRecord, fallback: string): string {
  return text(record, 'id') || text(record, 'sessionId') || text(record, 'name') || fallback
}

function scope(record: AgentWorldRecord): string {
  return text(record, 'source') || text(record, 'connectorId') || 'ghostforge-runtime'
}

function nodeId(kind: AgentWorldNodeKind, source: string, id: string): string {
  return `${kind}:${source}:${id}`
}

function isFresh(timestamp: string, now: number): boolean {
  if (!timestamp) return false
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) && now - parsed <= 15 * 60 * 1000
}

function reportedProgress(record: AgentWorldRecord, status: string): number | null {
  const raw = record.progress ?? record.progressPercent ?? record.percent
  const numeric = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
  if (Number.isFinite(numeric)) {
    const normalized = numeric > 1 ? numeric / 100 : numeric
    return Math.min(1, Math.max(0, normalized))
  }
  return COMPLETE_STATES.has(status) ? 1 : null
}

function providerRole(record: AgentWorldRecord, fallback = 'agent'): string {
  const haystack = [
    text(record, 'provider'),
    text(record, 'name'),
    text(record, 'agent'),
    text(record, 'source'),
    text(record, 'device'),
  ].join(' ').toLowerCase()
  if (haystack.includes('claude')) return 'Claude Code'
  if (haystack.includes('copilot') && /(app|desktop)/.test(haystack)) return 'Copilot App'
  if (haystack.includes('copilot')) return 'Copilot CLI'
  return text(record, 'role') || text(record, 'provider') || fallback
}

export function sanitizeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/(token|secret|api[_-]?key|password|authorization)\s*[:=]\s*[^\s\n]+/gi, '$1=[redacted]')
    .replace(/[A-Za-z]:\\[^\s\n]+/g, '[local path redacted]')
    .replace(/(?:^|\s)\/(?:Users|home|var|tmp)\/[^\s\n]+/g, ' [local path redacted]')
    .trim()
}

function agentNode(record: AgentWorldRecord, index: number, now: number): AgentWorldNode {
  const source = scope(record)
  const id = entityId(record, `agent-${index + 1}`)
  const status = normalizeStatus(record.state ?? record.status)
  const timestamp = text(record, 'since') || text(record, 'updatedAt')
  const active = ACTIVE_STATES.has(status)
  const leader = boolean(record, 'leader')
  const strengths = list(record, 'strengths')
  const role = leader ? (text(record, 'role') || 'boss / co-lead') : providerRole(record)
  return {
    id: nodeId('agent', source, id),
    entityId: id,
    scope: source,
    label: id,
    kind: 'agent',
    role,
    source,
    status,
    task: text(record, 'task') || 'No active task reported',
    progress: reportedProgress(record, status),
    stale: status === 'stale' || status === 'offline' || (active && !isFresh(timestamp, now)),
    active,
    leader,
    details: [
      `provider: ${text(record, 'provider') || 'unknown'}`,
      strengths.length ? `strengths: ${strengths.join(', ')}` : '',
      timestamp ? `last activity: ${timestamp}` : 'last activity: unknown',
      text(record, 'model') ? `model: ${text(record, 'model')}` : '',
    ].filter(Boolean),
  }
}

function sessionNode(record: AgentWorldRecord, index: number, now: number): AgentWorldNode {
  const source = scope(record)
  const id = entityId(record, `session-${index + 1}`)
  const status = normalizeStatus(record.state ?? record.status)
  const timestamp = text(record, 'updatedAt') || text(record, 'startedAt') || text(record, 'createdAt')
  const active = ACTIVE_STATES.has(status)
  return {
    id: nodeId('session', source, id),
    entityId: id,
    scope: source,
    label: text(record, 'name') || id,
    kind: 'session',
    role: providerRole(record, 'spawned session'),
    source,
    status,
    task: text(record, 'task') || 'No active task reported',
    progress: reportedProgress(record, status),
    stale: status === 'stale' || status === 'offline' || (active && !isFresh(timestamp, now)),
    active,
    leader: boolean(record, 'leader'),
    details: [
      text(record, 'agent') ? `agent: ${text(record, 'agent')}` : 'agent: unknown',
      `provider: ${text(record, 'provider') || 'unknown'}`,
      timestamp ? `last activity: ${timestamp}` : 'last activity: unknown',
    ],
  }
}

function workflowNode(record: AgentWorldRecord, index: number): AgentWorldNode {
  const source = scope(record)
  const id = entityId(record, `task-${index + 1}`)
  const status = normalizeStatus(record.status)
  const owner = text(record, 'assignee') || text(record, 'owner') || 'unassigned'
  const dependencies = list(record, 'dependencies')
  return {
    id: nodeId('workflow', source, id),
    entityId: id,
    scope: source,
    label: id,
    kind: 'workflow',
    role: text(record, 'kind') || 'task',
    source,
    status,
    task: text(record, 'title') || 'Untitled task',
    progress: reportedProgress(record, status),
    stale: BLOCKED_STATES.has(status),
    active: !COMPLETE_STATES.has(status) && !BLOCKED_STATES.has(status),
    leader: false,
    details: [
      `owner: ${owner}`,
      dependencies.length ? `depends on: ${dependencies.join(', ')}` : 'dependencies: none reported',
      text(record, 'leader') ? `lead: ${text(record, 'leader')}` : '',
    ].filter(Boolean),
  }
}

function sourceNode(record: AgentWorldRecord, index: number): AgentWorldNode {
  const id = entityId(record, `source-${index + 1}`)
  const status = normalizeStatus(record.status)
  return {
    id: nodeId('source', id, id),
    entityId: id,
    scope: id,
    label: text(record, 'project') || id,
    kind: 'source',
    role: text(record, 'source') || 'connector',
    source: id,
    status,
    task: text(record, 'error') || 'Session source',
    progress: reportedProgress(record, status),
    stale: status !== 'online',
    active: status === 'online',
    leader: false,
    details: [
      `connector: ${id}`,
      `source: ${text(record, 'source') || 'unknown'}`,
      text(record, 'provider') ? `provider: ${text(record, 'provider')}` : '',
      text(record, 'device') ? `device: ${text(record, 'device')}` : '',
    ].filter(Boolean),
  }
}

function findNode(
  nodes: AgentWorldNode[],
  kinds: AgentWorldNodeKind[],
  source: string,
  entity: string,
): AgentWorldNode | undefined {
  const kindSet = new Set(kinds)
  const candidates = nodes.filter(node => kindSet.has(node.kind) && node.entityId === entity)
  return candidates.find(node => node.scope === source)
    ?? candidates.find(node => node.scope === 'ghostforge-runtime')
    ?? (candidates.length === 1 ? candidates[0] : undefined)
}

function addEdge(edges: AgentWorldEdge[], seen: Set<string>, edge: Omit<AgentWorldEdge, 'id'>) {
  if (edge.from === edge.to) return
  const id = `${edge.type}:${edge.from}->${edge.to}`
  if (seen.has(id)) return
  seen.add(id)
  edges.push({ ...edge, id })
}

function deriveEdges(data: AgentWorldData, nodes: AgentWorldNode[]): AgentWorldEdge[] {
  const edges: AgentWorldEdge[] = []
  const seen = new Set<string>()

  for (const node of nodes) {
    if (node.kind === 'source') continue
    const sourceId = node.scope === 'ghostforge-runtime' ? 'ghostforge-local' : node.scope
    const source = nodes.find(candidate => candidate.kind === 'source' && candidate.entityId === sourceId)
    if (source) addEdge(edges, seen, { from: source.id, to: node.id, label: 'reports', type: 'source' })
  }

  data.tasks.forEach((record, index) => {
    const source = scope(record)
    const task = findNode(nodes, ['workflow'], source, entityId(record, `task-${index + 1}`))
    if (!task) return
    const owner = text(record, 'assignee') || text(record, 'owner')
    const ownerNode = owner ? findNode(nodes, ['agent', 'session'], source, owner) : undefined
    if (ownerNode) addEdge(edges, seen, { from: ownerNode.id, to: task.id, label: 'owns', type: 'owner' })
    for (const dependency of list(record, 'dependencies')) {
      const dependencyNode = findNode(nodes, ['workflow'], source, dependency)
      if (dependencyNode) addEdge(edges, seen, { from: dependencyNode.id, to: task.id, label: 'precedes', type: 'dependency' })
    }
  })

  data.sessions.forEach((record, index) => {
    const source = scope(record)
    const session = findNode(nodes, ['session'], source, entityId(record, `session-${index + 1}`))
    const agent = text(record, 'agent')
    const agentNode = agent ? findNode(nodes, ['agent'], source, agent) : undefined
    if (session && agentNode) addEdge(edges, seen, { from: agentNode.id, to: session.id, label: 'spawned', type: 'session' })
  })

  for (const record of data.events) {
    const source = scope(record)
    const from = text(record, 'from')
    const to = text(record, 'to')
    const fromNode = from ? findNode(nodes, ['agent', 'session'], source, from) : undefined
    const toNode = to ? findNode(nodes, ['agent', 'session'], source, to) : undefined
    if (fromNode && toNode) addEdge(edges, seen, { from: fromNode.id, to: toNode.id, label: 'message', type: 'message' })
  }

  return edges
}

export function deriveAgentWorldProjection(
  data: AgentWorldData,
  variant: AgentWorldVariant,
  meta: AgentWorldMeta = {},
  now = Date.now(),
): AgentWorldProjection {
  const records: AgentWorldData = {
    connectors: Array.isArray(data?.connectors) ? data.connectors : [],
    sessions: Array.isArray(data?.sessions) ? data.sessions : [],
    agents: Array.isArray(data?.agents) ? data.agents : [],
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    events: Array.isArray(data?.events) ? data.events : [],
  }
  const sourceNodes = records.connectors.map(sourceNode)
  const sessionNodes = variant === 'maintainer' ? records.sessions.map((record, index) => sessionNode(record, index, now)) : []
  const agentNodes = records.agents.map((record, index) => agentNode(record, index, now))
  const workflowNodes = records.tasks.map(workflowNode)
  const nodes = [...sourceNodes, ...sessionNodes, ...agentNodes, ...workflowNodes]
  const edges = deriveEdges(
    variant === 'maintainer' ? records : { ...records, sessions: [], events: [] },
    nodes,
  )
  const notices: string[] = []

  if (!nodes.length) notices.push('No real agent, session, task, or connector records are available.')
  if (meta.running === false) notices.push('The local agent runtime is offline; stored and federated records remain visible.')
  if (variant === 'maintainer' && !sessionNodes.length) notices.push('No bounded local or federated session records were reported.')
  if (sourceNodes.some(node => node.stale)) notices.push('One or more connector sources are stale or offline.')

  return {
    nodes,
    edges,
    summary: {
      online: nodes.filter(node => node.active && !node.stale).length,
      sessions: sessionNodes.length,
      tasks: workflowNodes.length,
      active: workflowNodes.filter(node => node.active).length,
      blocked: workflowNodes.filter(node => BLOCKED_STATES.has(node.status)).length,
      sources: sourceNodes.length,
      health: typeof meta.health === 'number' && Number.isFinite(meta.health)
        ? Math.max(0, Math.min(100, meta.health))
        : null,
      phase: typeof meta.phase === 'number' && Number.isFinite(meta.phase) && meta.phase > 0 ? meta.phase : 1,
    },
    notices,
    ready: nodes.length > 0,
  }
}

function hash(value: string): number {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function spread(nodes: AgentWorldNode[], y: number, start: number, end: number): Map<string, ScenePosition> {
  const positions = new Map<string, ScenePosition>()
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
  ordered.forEach((node, index) => {
    const x = ordered.length === 1 ? (start + end) / 2 : start + ((end - start) * index) / (ordered.length - 1)
    const jitter = (hash(node.id) % 25) - 12
    positions.set(node.id, { x: Math.round(x), y: y + jitter })
  })
  return positions
}

function mergePositions(target: Map<string, ScenePosition>, source: Map<string, ScenePosition>) {
  for (const [id, position] of source) target.set(id, position)
}

export function layoutWorldNodes(nodes: AgentWorldNode[], theme: AgentWorldTheme): Map<string, ScenePosition> {
  const positions = new Map<string, ScenePosition>()
  const sources = nodes.filter(node => node.kind === 'source')
  const leaders = nodes.filter(node => node.kind === 'agent' && node.leader)
  const workers = nodes.filter(node => node.kind === 'agent' && !node.leader)
  const sessions = nodes.filter(node => node.kind === 'session')
  const tasks = nodes.filter(node => node.kind === 'workflow')

  if (theme === 'forge') {
    mergePositions(positions, spread(sources, 74, 90, 910))
    mergePositions(positions, spread(leaders, 150, 420, 580))
    mergePositions(positions, spread(tasks, 286, 130, 870))
    mergePositions(positions, spread(sessions, 400, 140, 860))
    mergePositions(positions, spread(workers, 510, 100, 900))
  } else if (theme === 'office') {
    mergePositions(positions, spread(sources, 80, 100, 420))
    mergePositions(positions, spread(leaders, 105, 730, 875))
    mergePositions(positions, spread(workers, 270, 120, 630))
    mergePositions(positions, spread(sessions, 445, 120, 630))
    mergePositions(positions, spread(tasks, 350, 750, 895))
  } else {
    mergePositions(positions, spread(sources, 105, 120, 880))
    const people = [...leaders, ...workers, ...sessions].sort((a, b) => a.id.localeCompare(b.id))
    people.forEach(node => {
      const seed = hash(`${node.scope}:${node.id}`)
      positions.set(node.id, {
        x: 90 + (seed % 820),
        y: 205 + ((seed >>> 8) % 185),
      })
    })
    mergePositions(positions, spread(tasks, 505, 120, 880))
  }

  return positions
}
