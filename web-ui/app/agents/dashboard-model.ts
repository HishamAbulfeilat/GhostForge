export type Agent = {
  provider: string | null
  state: string
  task: string | null
  model: string | null
  since: string | null
  cooldownUntil: string | null
}

export type Task = {
  id: string | null
  title: string
  kind: string
  status: string
  owner: string | null
}

export const BOARD_COLUMNS = ['todo', 'in-progress', 'review', 'done', 'blocked'] as const
export type BoardStatus = (typeof BOARD_COLUMNS)[number]

const activeStatuses = new Set<BoardStatus>(['in-progress', 'review'])

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
