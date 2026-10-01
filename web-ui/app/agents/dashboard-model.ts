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
  dependencies?: string[]
  acceptanceCriteria?: string[]
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

const activeStatuses = new Set<BoardStatus>(['in-progress', 'review'])

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
