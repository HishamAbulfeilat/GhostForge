import { normalizeTaskStatus, type BoardStatus } from './dashboard-model'

export type AgentWorldSourceKind = 'local' | 'app' | 'cloud' | 'remote' | 'unknown'
export type AgentWorldSourceStatus = 'online' | 'degraded' | 'offline' | 'unknown'

export type RawAgent = {
  provider?: string | null
  state?: string
  task?: string | null
  model?: string | null
  since?: string | null
  cooldownUntil?: string | null
  leader?: boolean
  assignee?: string | null
  role?: string | null
  strengths?: string[]
  sourceId?: string | null
  sourceKind?: string | null
  project?: string | null
  workspace?: string | null
  device?: string | null
  updatedAt?: string | null
}

export type RawTask = {
  id?: string | null
  title?: string
  kind?: string
  status?: string
  owner?: string | null
  assignee?: string | null
  leader?: string | null
  dependencies?: string[]
  acceptanceCriteria?: string[]
  progress?: number | null
  project?: string | null
  workspace?: string | null
}

export type RawSource = {
  id?: string
  label?: string
  kind?: string
  status?: string
  project?: string | null
  workspace?: string | null
  device?: string | null
  provider?: string | null
  updatedAt?: string | null
}

export type RawSession = {
  id?: string
  name?: string
  sourceId?: string | null
  sourceKind?: string | null
  state?: string
  taskId?: string | null
  role?: string | null
  leader?: boolean
  progress?: number | null
  project?: string | null
  workspace?: string | null
  device?: string | null
  provider?: string | null
  model?: string | null
  since?: string | null
  updatedAt?: string | null
}

export type AgentTeamSnapshot = {
  health?: number | null
  running?: boolean
  agents?: Record<string, RawAgent>
  tasks?: RawTask[]
  messages?: Array<Record<string, unknown>>
  phase?: number
  workflow?: {
    leader?: string | null
    mode?: string
    specialists?: string[]
  }
  sources?: RawSource[]
  sessions?: RawSession[]
  updatedAt?: string | null
}

export type AgentWorldSource = {
  id: string
  label: string
  kind: AgentWorldSourceKind
  status: AgentWorldSourceStatus
  project: string | null
  workspace: string | null
  device: string | null
  provider: string | null
  updatedAt: string | null
  stale: boolean
}

export type AgentWorldSession = {
  id: string
  name: string
  sourceId: string
  sourceKind: AgentWorldSourceKind
  state: string
  taskId: string | null
  taskTitle: string | null
  role: string
  leader: boolean
  progress: number | null
  project: string | null
  workspace: string | null
  device: string | null
  provider: string | null
  model: string | null
  since: string | null
  updatedAt: string | null
  stale: boolean
}

export type AgentWorldTask = {
  id: string
  title: string
  kind: string
  status: BoardStatus
  owner: string | null
  assignee: string | null
  leader: string | null
  dependencies: string[]
  acceptanceCriteria: string[]
  progress: number | null
  project: string | null
  workspace: string | null
}

export type AgentWorldEvent = {
  id: string
  from: string
  to: string
  text: string
  timestamp: string | null
  sourceId: string | null
  project: string | null
  workspace: string | null
}

export type AgentWorldEdge = {
  id: string
  from: string
  to: string
  kind: 'dependency' | 'assignment' | 'leadership'
}

export type AgentWorld = {
  health: number | null
  running: boolean
  phase: number | null
  workflowMode: string | null
  sources: AgentWorldSource[]
  sessions: AgentWorldSession[]
  tasks: AgentWorldTask[]
  events: AgentWorldEvent[]
  edges: AgentWorldEdge[]
  projects: string[]
  workspaces: string[]
  updatedAt: string | null
}

export type AgentWorldFilters = {
  project: string
  workspace: string
  source: string
}

const STALE_AFTER_MS = 90_000

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function finiteProgress(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.round(value)))
}

function sourceKind(value: unknown): AgentWorldSourceKind {
  const normalized = text(value)?.toLowerCase()
  if (normalized === 'local' || normalized === 'app' || normalized === 'cloud' || normalized === 'remote') return normalized
  return 'unknown'
}

function sourceStatus(value: unknown): AgentWorldSourceStatus {
  const normalized = text(value)?.toLowerCase()
  if (normalized === 'online' || normalized === 'connected' || normalized === 'running') return 'online'
  if (normalized === 'degraded' || normalized === 'stale' || normalized === 'cooldown') return 'degraded'
  if (normalized === 'offline' || normalized === 'stopped' || normalized === 'error') return 'offline'
  return 'unknown'
}

function timestampIsStale(value: string | null, now: number, fallback: string | null): boolean {
  const parsed = Date.parse(value || fallback || '')
  return Number.isFinite(parsed) && now - parsed > STALE_AFTER_MS
}

function inferSourceKind(agent: RawAgent): AgentWorldSourceKind {
  const explicit = sourceKind(agent.sourceKind)
  if (explicit !== 'unknown') return explicit
  if (text(agent.device)) return 'remote'
  return 'local'
}

function assignedProgress(sessionId: string, tasks: AgentWorldTask[]): number | null {
  const assigned = tasks.filter(task => task.owner === sessionId || task.assignee === sessionId)
  if (!assigned.length) return null
  const completed = assigned.filter(task => task.status === 'done').length
  return Math.round((completed / assigned.length) * 100)
}

function normalizeTasks(input: RawTask[] | undefined): AgentWorldTask[] {
  return (Array.isArray(input) ? input : []).map((task, index) => ({
    id: text(task.id) ?? `unidentified-task-${index + 1}`,
    title: text(task.title) ?? 'Untitled task',
    kind: text(task.kind) ?? 'task',
    status: normalizeTaskStatus(text(task.status) ?? 'todo'),
    owner: text(task.owner),
    assignee: text(task.assignee) ?? text(task.owner),
    leader: text(task.leader),
    dependencies: Array.isArray(task.dependencies) ? task.dependencies.map(text).filter((entry): entry is string => Boolean(entry)) : [],
    acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.map(text).filter((entry): entry is string => Boolean(entry)) : [],
    progress: finiteProgress(task.progress),
    project: text(task.project),
    workspace: text(task.workspace),
  }))
}

function normalizeEvents(input: Array<Record<string, unknown>> | undefined): AgentWorldEvent[] {
  return (Array.isArray(input) ? input : []).flatMap((event, index) => {
    const body = text(event.text)
    if (!body) return []
    const rawTimestamp = typeof event.ts === 'number' ? new Date(event.ts).toISOString() : text(event.ts)
    return [{
      id: `${rawTimestamp ?? 'undated'}-${index}`,
      from: text(event.from) ?? 'unknown',
      to: text(event.to) ?? 'all',
      text: body,
      timestamp: rawTimestamp,
      sourceId: text(event.sourceId),
      project: text(event.project),
      workspace: text(event.workspace),
    }]
  })
}

export function buildAgentWorld(snapshot: AgentTeamSnapshot, now = Date.now()): AgentWorld {
  const tasks = normalizeTasks(snapshot.tasks)
  const snapshotUpdatedAt = text(snapshot.updatedAt)
  const sourceMap = new Map<string, AgentWorldSource>()

  for (const source of Array.isArray(snapshot.sources) ? snapshot.sources : []) {
    const id = text(source.id)
    if (!id) continue
    const updatedAt = text(source.updatedAt)
    const stale = timestampIsStale(updatedAt, now, snapshotUpdatedAt)
    const status = stale ? 'degraded' : sourceStatus(source.status)
    sourceMap.set(id, {
      id,
      label: text(source.label) ?? id,
      kind: sourceKind(source.kind),
      status,
      project: text(source.project),
      workspace: text(source.workspace),
      device: text(source.device),
      provider: text(source.provider),
      updatedAt,
      stale,
    })
  }

  const sessionMap = new Map<string, AgentWorldSession>()
  const reportedSessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : []
  for (const [index, session] of reportedSessions.entries()) {
    const id = text(session.id) ?? `unidentified-session-${index + 1}`
    const kind = sourceKind(session.sourceKind)
    const sourceId = text(session.sourceId) ?? `${kind}:unreported`
    const updatedAt = text(session.updatedAt)
    const stale = timestampIsStale(updatedAt, now, snapshotUpdatedAt)
    const taskId = text(session.taskId)
    const matchingTask = taskId ? tasks.find(task => task.id === taskId) : null
    sessionMap.set(id, {
      id,
      name: text(session.name) ?? id,
      sourceId,
      sourceKind: kind,
      state: stale ? 'stale' : text(session.state) ?? 'unknown',
      taskId,
      taskTitle: matchingTask?.title ?? null,
      role: text(session.role) ?? (session.leader ? 'leader' : 'worker'),
      leader: Boolean(session.leader),
      progress: finiteProgress(session.progress) ?? assignedProgress(id, tasks),
      project: text(session.project),
      workspace: text(session.workspace),
      device: text(session.device),
      provider: text(session.provider),
      model: text(session.model),
      since: text(session.since),
      updatedAt,
      stale,
    })
    if (!sourceMap.has(sourceId)) {
      sourceMap.set(sourceId, {
        id: sourceId,
        label: sourceId,
        kind,
        status: stale ? 'degraded' : 'unknown',
        project: text(session.project),
        workspace: text(session.workspace),
        device: text(session.device),
        provider: text(session.provider),
        updatedAt,
        stale,
      })
    }
  }

  for (const [id, agent] of Object.entries(snapshot.agents ?? {})) {
    if (sessionMap.has(id)) continue
    const kind = inferSourceKind(agent)
    const sourceId = text(agent.sourceId) ?? `${kind}:agent-team`
    const updatedAt = text(agent.updatedAt)
    const stale = timestampIsStale(updatedAt, now, snapshotUpdatedAt)
    const taskId = text(agent.task)
    const matchingTask = taskId ? tasks.find(task => task.id === taskId) : null
    sessionMap.set(id, {
      id,
      name: id,
      sourceId,
      sourceKind: kind,
      state: stale ? 'stale' : text(agent.state) ?? 'unknown',
      taskId,
      taskTitle: matchingTask?.title ?? taskId,
      role: text(agent.role) ?? (agent.leader ? 'leader' : 'worker'),
      leader: Boolean(agent.leader) || snapshot.workflow?.leader === id,
      progress: assignedProgress(id, tasks),
      project: text(agent.project),
      workspace: text(agent.workspace),
      device: text(agent.device),
      provider: text(agent.provider),
      model: text(agent.model),
      since: text(agent.since),
      updatedAt,
      stale,
    })
    if (!sourceMap.has(sourceId)) {
      sourceMap.set(sourceId, {
        id: sourceId,
        label: kind === 'local' ? 'Local agent team' : sourceId,
        kind,
        status: snapshot.running === false ? 'offline' : 'unknown',
        project: text(agent.project),
        workspace: text(agent.workspace),
        device: text(agent.device),
        provider: text(agent.provider),
        updatedAt,
        stale,
      })
    }
  }

  const sessions = [...sessionMap.values()]
  const edges: AgentWorldEdge[] = []
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (tasks.some(candidate => candidate.id === dependency)) {
        edges.push({ id: `dependency:${dependency}:${task.id}`, from: dependency, to: task.id, kind: 'dependency' })
      }
    }
    const assignee = task.assignee ?? task.owner
    if (assignee && sessions.some(session => session.id === assignee)) {
      edges.push({ id: `assignment:${assignee}:${task.id}`, from: assignee, to: task.id, kind: 'assignment' })
    }
    if (task.leader && task.leader !== assignee && sessions.some(session => session.id === task.leader)) {
      edges.push({ id: `leadership:${task.leader}:${task.id}`, from: task.leader, to: task.id, kind: 'leadership' })
    }
  }

  const unique = (values: Array<string | null>) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort()

  return {
    health: typeof snapshot.health === 'number' && Number.isFinite(snapshot.health) ? snapshot.health : null,
    running: Boolean(snapshot.running),
    phase: typeof snapshot.phase === 'number' && Number.isFinite(snapshot.phase) ? snapshot.phase : null,
    workflowMode: text(snapshot.workflow?.mode),
    sources: [...sourceMap.values()],
    sessions,
    tasks,
    events: normalizeEvents(snapshot.messages),
    edges,
    projects: unique([...sourcesForOptions(sourceMap).map(source => source.project), ...sessions.map(session => session.project), ...tasks.map(task => task.project)]),
    workspaces: unique([...sourcesForOptions(sourceMap).map(source => source.workspace), ...sessions.map(session => session.workspace), ...tasks.map(task => task.workspace)]),
    updatedAt: snapshotUpdatedAt,
  }

  function sourcesForOptions(sourceMap: Map<string, AgentWorldSource>): AgentWorldSource[] {
    return [...sourceMap.values()]
  }
}

export function filterAgentWorld(world: AgentWorld, filters: AgentWorldFilters): AgentWorld {
  const matches = (project: string | null, workspace: string | null, sourceId?: string) => (
    (!filters.project || project === filters.project)
    && (!filters.workspace || workspace === filters.workspace)
    && (!filters.source || sourceId === filters.source)
  )
  const sources = world.sources.filter(source => matches(source.project, source.workspace, source.id))
  const sourceIds = new Set(sources.map(source => source.id))
  const sessions = world.sessions.filter(session => (
    sourceIds.has(session.sourceId)
    && matches(session.project, session.workspace, session.sourceId)
  ))
  const sessionIds = new Set(sessions.map(session => session.id))
  const sessionById = new Map(world.sessions.map(session => [session.id, session]))
  const selectedTaskIds = new Set(world.tasks.filter(task => {
    const assignee = task.assignee ?? task.owner
    const session = assignee ? sessionById.get(assignee) : undefined
    return matches(task.project ?? session?.project ?? null, task.workspace ?? session?.workspace ?? null, session?.sourceId)
      && (!filters.source || !assignee || sessionIds.has(assignee))
  }).map(task => task.id))
  let previousSize = -1
  while (previousSize !== selectedTaskIds.size) {
    previousSize = selectedTaskIds.size
    for (const task of world.tasks) {
      if (selectedTaskIds.has(task.id)) {
        task.dependencies.forEach(dependency => selectedTaskIds.add(dependency))
      }
    }
  }
  const tasks = world.tasks.filter(task => selectedTaskIds.has(task.id))
  const taskIds = new Set(tasks.map(task => task.id))
  const filtering = Boolean(filters.project || filters.workspace || filters.source)
  const events = filtering
    ? world.events.filter(event => {
      const fromSession = sessionById.get(event.from)
      const toSession = sessionById.get(event.to)
      const participant = fromSession ?? toSession
      const sourceId = event.sourceId ?? participant?.sourceId
      return Boolean(
        (event.project || event.workspace || sourceId)
        && matches(event.project ?? participant?.project ?? null, event.workspace ?? participant?.workspace ?? null, sourceId),
      )
    })
    : world.events

  return {
    ...world,
    sources,
    sessions,
    tasks,
    events,
    edges: world.edges.filter(edge => (
      (sessionIds.has(edge.from) || taskIds.has(edge.from))
      && (sessionIds.has(edge.to) || taskIds.has(edge.to))
    )),
  }
}

export function agentWorldCounts(world: AgentWorld) {
  const active = world.sessions.filter(session => ['working', 'running', 'busy', 'reviewing'].includes(session.state.toLowerCase())).length
  return {
    active,
    sessions: world.sessions.length,
    openTasks: world.tasks.filter(task => task.status !== 'done').length,
    blocked: world.tasks.filter(task => task.status === 'blocked').length,
    sources: world.sources.length,
  }
}
