export type Agent = {
  provider: string | null
  state: string
  task: string | null
  model: string | null
  since: string | null
  cooldownUntil: string | null
  enabled?: boolean
}

export type Task = {
  id: string | null
  title: string
  kind: string
  status: string
  owner: string | null
  dependencies?: string[]
  acceptanceCriteria?: string[]
  lastFailure?: string | null
  attempts?: number | null
  updatedAt?: string | null
}

export type TaskCardDetails = {
  failure: string | null
  attempts: number | null
  updatedAt: string | null
}

export type DependencyGraphNode = {
  key: string
  anchorId: string
  task: Task
  dependencyNodeKeys: string[]
  missingDependencies: string[]
  ambiguousDependencies: string[]
  cyclic: boolean
}

export const BOARD_COLUMNS = ['todo', 'in-progress', 'review', 'done', 'blocked'] as const
export type BoardStatus = (typeof BOARD_COLUMNS)[number]

export const FAILURE_SUMMARY_MAX_LENGTH = 200
export const DETAIL_STATUSES: ReadonlySet<BoardStatus> = new Set<BoardStatus>(['blocked', 'review'])

const activeStatuses = new Set<BoardStatus>(['in-progress', 'review'])

export function getEnabledAgentIds(agents: Record<string, Agent>): string[] {
  return Object.entries(agents)
    .filter(([, agent]) => agent.enabled !== false)
    .map(([id]) => id)
}

export function buildDependencyGraph(tasks: Task[]): DependencyGraphNode[] {
  const idIndexes = new Map<string, number[]>()
  for (const [index, task] of tasks.entries()) {
    const id = typeof task.id === 'string' ? task.id.trim() : ''
    if (!id) continue
    const indexes = idIndexes.get(id) ?? []
    indexes.push(index)
    idIndexes.set(id, indexes)
  }

  const graph = tasks.map((task, index) => {
    const dependencyNodeIndexes: number[] = []
    const missingDependencies: string[] = []
    const ambiguousDependencies: string[] = []
    const dependencies = Array.isArray(task.dependencies)
      ? [...new Set(task.dependencies.filter((dependency): dependency is string => typeof dependency === 'string')
        .map(dependency => dependency.trim()).filter(Boolean))]
      : []

    for (const dependency of dependencies) {
      const matches = idIndexes.get(dependency)
      if (!matches?.length) {
        missingDependencies.push(dependency)
      } else if (matches.length > 1) {
        ambiguousDependencies.push(dependency)
      } else {
        dependencyNodeIndexes.push(matches[0])
      }
    }

    return {
      key: `task-${index}`,
      anchorId: `workflow-task-${index}`,
      task,
      dependencyNodeIndexes,
      dependencyNodeKeys: dependencyNodeIndexes.map(dependencyIndex => `task-${dependencyIndex}`),
      missingDependencies,
      ambiguousDependencies,
      cyclic: false,
    }
  })

  const colors = tasks.map(() => 0)
  for (let start = 0; start < graph.length; start += 1) {
    if (colors[start] !== 0) continue
    colors[start] = 1
    const stack = [{ index: start, nextDependency: 0 }]

    while (stack.length) {
      const frame = stack[stack.length - 1]
      const dependencies = graph[frame.index].dependencyNodeIndexes
      if (frame.nextDependency >= dependencies.length) {
        colors[frame.index] = 2
        stack.pop()
        continue
      }

      const dependencyIndex = dependencies[frame.nextDependency]
      frame.nextDependency += 1
      if (colors[dependencyIndex] === 0) {
        colors[dependencyIndex] = 1
        stack.push({ index: dependencyIndex, nextDependency: 0 })
      } else if (colors[dependencyIndex] === 1) {
        const cycleStart = stack.findIndex(item => item.index === dependencyIndex)
        for (const item of stack.slice(cycleStart)) graph[item.index].cyclic = true
      }
    }
  }

  return graph.map(node => ({
    key: node.key,
    anchorId: node.anchorId,
    task: node.task,
    dependencyNodeKeys: node.dependencyNodeKeys,
    missingDependencies: node.missingDependencies,
    ambiguousDependencies: node.ambiguousDependencies,
    cyclic: node.cyclic,
  }))
}

export function normalizeTaskStatus(status: string): BoardStatus {
  const normalized = status.trim().toLowerCase().replace(/_/g, '-')
  if (normalized === 'inprogress') return 'in-progress'
  return BOARD_COLUMNS.includes(normalized as BoardStatus) ? normalized as BoardStatus : 'todo'
}

export function groupTasksByStatus(tasks: Task[]): Record<BoardStatus, Task[]> {
  const grouped: Record<BoardStatus, Task[]> = {
    todo: [],
    'in-progress': [],
    review: [],
    done: [],
    blocked: [],
  }
  for (const task of tasks) grouped[normalizeTaskStatus(task.status)].push(task)
  return grouped
}

export function countOpenTasks(tasks: Task[]): number {
  return tasks.filter(task => normalizeTaskStatus(task.status) !== 'done').length
}

export function getAgentProgress(agentId: string, tasks: Task[]): {
  completed: number
  total: number
  percentage: number
} {
  const assigned = tasks.filter(task => task.owner === agentId)
  const completed = assigned.filter(task => normalizeTaskStatus(task.status) === 'done').length
  return {
    completed,
    total: assigned.length,
    percentage: assigned.length ? Math.round((completed / assigned.length) * 100) : 0,
  }
}

export function findAgentTask(agentId: string, agent: Agent, tasks: Task[]): Task | null {
  const active = tasks.filter(task => activeStatuses.has(normalizeTaskStatus(task.status)))
  if (agent.task) {
    const reportedTask = tasks.find(task => task.id === agent.task)
    return reportedTask ?? {
      id: agent.task,
      title: agent.task,
      kind: 'task',
      status: 'in-progress',
      owner: agentId,
    }
  }
  return active.find(task => task.owner === agentId) ?? null
}

export function formatElapsed(since: string | null, now: number): string {
  if (!since) return '—'
  const startedAt = Date.parse(since)
  if (!Number.isFinite(startedAt) || startedAt > now) return '—'

  const elapsedMinutes = Math.floor((now - startedAt) / 60_000)
  const days = Math.floor(elapsedMinutes / 1440)
  const hours = Math.floor((elapsedMinutes % 1440) / 60)
  const minutes = elapsedMinutes % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function summarizeFailure(reason: unknown, maxLength = FAILURE_SUMMARY_MAX_LENGTH): string | null {
  if (typeof reason !== 'string') return null
  // One line: collapse newlines, tabs and other control characters into single spaces.
  const line = reason.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim()
  if (!line) return null
  if (line.length <= maxLength) return line
  return `${line.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function getTaskCardDetails(task: Task): TaskCardDetails {
  const attempts = typeof task.attempts === 'number' && Number.isInteger(task.attempts) && task.attempts >= 0
    ? task.attempts
    : null
  const updatedAt = typeof task.updatedAt === 'string' && Number.isFinite(Date.parse(task.updatedAt))
    ? task.updatedAt
    : null
  return { failure: summarizeFailure(task.lastFailure), attempts, updatedAt }
}

export function formatUpdatedAgo(updatedAt: string | null, now: number): string {
  const elapsed = formatElapsed(updatedAt, now)
  return elapsed === '—' ? '—' : `${elapsed} ago`
}

export const HISTORY_LIMIT = 5
export const TREND_LIMIT = 12

export type HistoryOutcome = 'merged' | 'bounced' | 'blocked'

export type HistoryEntry = {
  taskId: string
  outcome: HistoryOutcome
  datetime: string | null
  timestamp: string | null
}

export type HealthPoint = {
  taskId: string
  agent: string
  score: number
  datetime: string | null
  timestamp: string | null
}

type ParsedEvent = { agent: string; entry: HistoryEntry; score: number | null }

const MERGED_PATTERN = /^\W*([A-Za-z]+-\d+)\s+merged from\s+([\w.-]+)\s+\(health\s+(\d+(?:\.\d+)?)\s*\/\s*100\)/
const BOUNCED_PATTERN = /^([A-Za-z]+-\d+)\s+bounced\b/
const BOSS_BLOCKED_PATTERN = /^([A-Za-z]+-\d+)\s+BLOCKED after\b/
const AGENT_BLOCKED_PATTERN = /^([A-Za-z]+-\d+)\s+blocked:/

function parseHistoryMessage(raw: unknown): ParsedEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const message = raw as Record<string, unknown>
  const text = typeof message.text === 'string' ? message.text.trim() : ''
  const from = typeof message.from === 'string' ? message.from.trim() : ''
  const to = typeof message.to === 'string' ? message.to.trim() : ''
  if (!text || !from) return null

  const rawTime = message.datetime ?? message.ts
  const parsedTime = typeof rawTime === 'string' || typeof rawTime === 'number' ? new Date(rawTime) : null
  const datetime = parsedTime && Number.isFinite(parsedTime.getTime()) ? parsedTime.toISOString() : null
  const timestamp = typeof message.timestamp === 'string' && message.timestamp.trim() && datetime ? message.timestamp : datetime
  const make = (agent: string, taskId: string, outcome: HistoryOutcome, score: number | null): ParsedEvent =>
    ({ agent, entry: { taskId, outcome, datetime, timestamp }, score })

  if (from === 'boss') {
    const merged = MERGED_PATTERN.exec(text)
    if (merged) {
      const score = Number(merged[3])
      return Number.isFinite(score) ? make(merged[2], merged[1], 'merged', score) : null
    }
    if (!to || to === 'all') return null
    const bounced = BOUNCED_PATTERN.exec(text)
    if (bounced) return make(to, bounced[1], 'bounced', null)
    const blocked = BOSS_BLOCKED_PATTERN.exec(text)
    if (blocked) return make(to, blocked[1], 'blocked', null)
    return null
  }

  const selfBlocked = AGENT_BLOCKED_PATTERN.exec(text)
  return selfBlocked ? make(from, selfBlocked[1], 'blocked', null) : null
}

/** Last `limit` task outcomes per agent (newest first), read from the boss's messages.jsonl lines. */
export function buildAgentHistory(messages: unknown, limit = HISTORY_LIMIT): Record<string, HistoryEntry[]> {
  const history: Record<string, HistoryEntry[]> = {}
  if (!Array.isArray(messages) || !(limit >= 1)) return history
  for (const raw of messages) {
    const event = parseHistoryMessage(raw)
    if (event) (history[event.agent] ??= []).push(event.entry)
  }
  for (const agent of Object.keys(history)) history[agent] = history[agent].reverse().slice(0, Math.floor(limit))
  return history
}

/** Health score after each of the last `limit` merges, oldest first. */
export function buildHealthTrend(messages: unknown, limit = TREND_LIMIT): HealthPoint[] {
  if (!Array.isArray(messages) || !(limit >= 1)) return []
  const points: HealthPoint[] = []
  for (const raw of messages) {
    const event = parseHistoryMessage(raw)
    if (event && event.score !== null) {
      points.push({ taskId: event.entry.taskId, agent: event.agent, score: event.score, datetime: event.entry.datetime, timestamp: event.entry.timestamp })
    }
  }
  return points.slice(-Math.floor(limit))
}

export function describeHealthTrend(points: HealthPoint[]): string {
  if (!points.length) return 'No merges recorded yet, so there is no health trend.'
  const scores = points.map(point => point.score)
  const first = scores[0]
  const last = scores[scores.length - 1]
  if (points.length === 1) return `Health was ${last} out of 100 after the only recorded merge.`
  const direction = last > first ? 'rising' : last < first ? 'falling' : 'steady'
  return `Health over the last ${points.length} merges is ${direction}: from ${first} to ${last} out of 100, lowest ${Math.min(...scores)}, highest ${Math.max(...scores)}.`
}
