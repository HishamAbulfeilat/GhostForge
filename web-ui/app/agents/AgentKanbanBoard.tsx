'use client'

import { useEffect, useState } from 'react'
import {
  BOARD_COLUMNS,
  buildAgentHistory,
  buildDependencyGraph,
  buildHealthTrend,
  countOpenTasks,
  describeHealthTrend,
  DETAIL_STATUSES,
  findAgentTask,
  formatElapsed,
  formatUpdatedAgo,
  getAgentProgress,
  getTaskCardDetails,
  groupTasksByStatus,
  type Agent,
  type BoardStatus,
  type HealthPoint,
  type HistoryOutcome,
  type Task,
} from './dashboard-model'

type DisplayMessage = {
  from: string
  to: string
  timestamp: string
  datetime: string | undefined
  text: string
}

const statusStyles: Record<BoardStatus, string> = {
  todo: 'border-slate-700 bg-slate-900/60',
  'in-progress': 'border-cyan-800 bg-cyan-950/40',
  review: 'border-violet-800 bg-violet-950/40',
  done: 'border-emerald-800 bg-emerald-950/40',
  blocked: 'border-amber-800 bg-amber-950/40',
}

const badgeStyles: Record<BoardStatus, string> = {
  todo: 'bg-slate-800 text-slate-200',
  'in-progress': 'bg-cyan-950 text-cyan-200',
  review: 'bg-violet-950 text-violet-200',
  done: 'bg-emerald-950 text-emerald-200',
  blocked: 'bg-amber-950 text-amber-200',
}

const agentStateStyles: Record<string, string> = {
  working: 'bg-cyan-950 text-cyan-200',
  running: 'bg-cyan-950 text-cyan-200',
  done: 'bg-emerald-950 text-emerald-200',
  blocked: 'bg-amber-950 text-amber-200',
  error: 'bg-red-950 text-red-200',
}

const outcomeStyles: Record<HistoryOutcome, string> = {
  merged: 'bg-emerald-950 text-emerald-200',
  bounced: 'bg-violet-950 text-violet-200',
  blocked: 'bg-amber-950 text-amber-200',
}

function HealthTrendChart({ points }: { points: HealthPoint[] }) {
  const description = describeHealthTrend(points)
  if (!points.length) return <p className="text-sm text-gf-muted">{description}</p>
  const width = 240
  const height = 48
  const coords = points.map((point, index) => {
    const x = points.length > 1 ? (index * width) / (points.length - 1) : width / 2
    const y = height - (Math.min(100, Math.max(0, point.score)) / 100) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <div className="flex flex-col gap-2">
      <svg role="img" aria-label={description} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-12 w-full max-w-xs text-gf-accent">
        <polyline points={coords.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="text-xs text-gf-muted">{description}</p>
    </div>
  )
}

function formatStatus(status: BoardStatus): string {
  return status === 'in-progress' ? 'In progress' : status[0].toUpperCase() + status.slice(1)
}

export default function AgentKanbanBoard({
  agents,
  tasks,
  messages,
}: {
  agents: Record<string, Agent>
  tasks: Task[]
  messages: DisplayMessage[]
}) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const groupedTasks = groupTasksByStatus(tasks)
  const dependencyGraph = buildDependencyGraph(tasks)
  const recentMessages = messages.slice(-6).reverse()
  const agentHistory = buildAgentHistory(messages)
  const healthTrend = buildHealthTrend(messages)
  const historyAgentIds = [...new Set([...Object.keys(agents), ...Object.keys(agentHistory)])]

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Agent task kanban board">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Task board</h2>
          <p className="text-xs text-gf-muted">Open tasks: {countOpenTasks(tasks)}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {BOARD_COLUMNS.map(status => (
            <section key={status} aria-labelledby={`agent-column-${status}`} className={`min-w-0 rounded-2xl border p-3 ${statusStyles[status]}`}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 id={`agent-column-${status}`} className="font-semibold">{formatStatus(status)}</h3>
                <span className={`rounded-full px-2 py-1 text-xs ${badgeStyles[status]}`}>{groupedTasks[status].length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {groupedTasks[status].length ? groupedTasks[status].map((task, index) => {
                  const details = DETAIL_STATUSES.has(status) ? getTaskCardDetails(task) : null
                  return (
                    <article key={task.id || `${task.title}-${index}`} className="rounded-xl border border-gf-line bg-gf-surface p-3">
                      <h4 className="break-words text-sm font-semibold">{task.title || 'Untitled task'}</h4>
                      <p className="mt-2 text-xs text-gf-muted">{task.id || 'No task ID'} · {task.kind}</p>
                      <p className="mt-1 truncate text-xs text-gf-muted">{task.owner || 'Unassigned'}</p>
                      {details && (
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 border-t border-gf-line pt-2 text-xs text-gf-muted">
                          {(details.failure || status === 'blocked') && (
                            <>
                              <dt>{status === 'blocked' ? 'Reason' : 'Last failure'}</dt>
                              <dd className={`min-w-0 break-words ${details.failure ? 'text-amber-200' : ''}`}>{details.failure ?? 'No reason recorded'}</dd>
                            </>
                          )}
                          <dt>Attempts</dt>
                          <dd className="text-gf-ink">{details.attempts ?? '—'}</dd>
                          <dt>Updated</dt>
                          <dd className="text-gf-ink">
                            {details.updatedAt
                              ? <time dateTime={details.updatedAt}>{now === null ? '—' : formatUpdatedAgo(details.updatedAt, now)}</time>
                              : '—'}
                          </dd>
                        </dl>
                      )}
                    </article>
                  )
                }) :<p className="rounded-xl border border-gf-line/70 bg-gf-surface/50 p-3 text-xs text-gf-muted">No tasks</p>}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section aria-labelledby="workflow-dependencies-heading">
        <div className="mb-3">
          <h2 id="workflow-dependencies-heading" className="font-display text-lg font-semibold">Workflow dependencies</h2>
          <p className="mt-1 text-xs text-gf-muted">Each task links to the tasks it depends on. Select a dependency to jump to its task.</p>
        </div>
        {dependencyGraph.length ? (
          <ol className="grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {dependencyGraph.map(node => {
              const dependencyNodes = node.dependencyNodeKeys
                .map(key => dependencyGraph.find(candidate => candidate.key === key))
                .filter((dependency): dependency is (typeof dependencyGraph)[number] => dependency !== undefined)
              const criteria = Array.isArray(node.task.acceptanceCriteria)
                ? [...new Set(node.task.acceptanceCriteria
                  .filter((criterion): criterion is string => typeof criterion === 'string')
                  .map(criterion => criterion.trim())
                  .filter(Boolean))]
                : []

              return (
                <li key={node.key} className="min-w-0">
                  <article id={node.anchorId} className="h-full scroll-mt-4 rounded-xl border border-gf-line bg-gf-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 break-words font-semibold">{node.task.title || 'Untitled task'}</h3>
                      {node.cyclic && <span className="rounded-full bg-amber-950 px-2 py-1 text-xs text-amber-200">Circular dependency</span>}
                    </div>
                    <p className="mt-1 break-words text-xs text-gf-muted">{node.task.id || 'No task ID'} · {node.task.kind}</p>

                    <div className="mt-3">
                      <h4 className="text-xs font-semibold text-gf-muted">Depends on</h4>
                      {dependencyNodes.length || node.missingDependencies.length || node.ambiguousDependencies.length ? (
                        <ul className="mt-1 flex flex-col gap-1 ps-4 text-sm">
                          {dependencyNodes.map(dependency => (
                            <li key={dependency.key} className="break-words">
                              <a className="text-gf-accent underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent" href={`#${dependency.anchorId}`}>
                                <span aria-hidden="true">→ </span>{dependency.task.id || dependency.task.title}: {dependency.task.title || 'Untitled task'}
                              </a>
                            </li>
                          ))}
                          {node.missingDependencies.map(dependency => (
                            <li key={`missing-${dependency}`} className="break-words text-amber-200">Unavailable task: {dependency}</li>
                          ))}
                          {node.ambiguousDependencies.map(dependency => (
                            <li key={`ambiguous-${dependency}`} className="break-words text-amber-200">Ambiguous task ID: {dependency}</li>
                          ))}
                        </ul>
                      ) : <p className="mt-1 text-sm text-gf-muted">No dependencies</p>}
                    </div>

                    {criteria.length > 0 && (
                      <details className="mt-3 border-t border-gf-line pt-3">
                        <summary className="w-fit cursor-pointer text-sm font-medium text-gf-ink focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent">
                          Acceptance criteria ({criteria.length})
                        </summary>
                        <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-gf-muted">
                          {criteria.map((criterion, index) => <li key={`${index}-${criterion}`} className="break-words">{criterion}</li>)}
                        </ul>
                      </details>
                    )}
                  </article>
                </li>
              )
            })}
          </ol>
        ) : <p className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">No workflow tasks to visualize.</p>}
      </section>

      <section aria-labelledby="workers-heading">
        <h2 id="workers-heading" className="mb-3 font-display text-lg font-semibold">Workers</h2>
        {Object.keys(agents).length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(agents).map(([id, agent]) => {
              const progress = getAgentProgress(id, tasks)
              const currentTask = findAgentTask(id, agent, tasks)
              const stateLabel = agent.state.replace(/[-_]/g, ' ')
              return (
                <article key={id} className="rounded-2xl border border-gf-line bg-gf-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate font-semibold">{id}</h3>
                    <span className={`rounded-full px-2 py-1 text-xs ${agentStateStyles[agent.state] || 'bg-white/10 text-white/70'}`}>{stateLabel}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-gf-muted">
                    <dt>Provider</dt><dd className="truncate text-gf-ink">{agent.provider || '—'}</dd>
                    <dt>Model</dt><dd className="truncate text-gf-ink">{agent.model || '—'}</dd>
                    <dt>Current task</dt><dd className="truncate text-gf-ink">{currentTask?.title || 'Idle'}</dd>
                    <dt>Elapsed</dt><dd className="text-gf-ink">{now === null || !['working', 'running'].includes(agent.state.toLowerCase()) ? '—' : formatElapsed(agent.since, now)}</dd>
                  </dl>
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between gap-2 text-xs">
                      <span className="text-gf-muted">Tasks complete (estimate)</span>
                      <span className="text-gf-ink">{progress.total ? `${progress.percentage}%` : 'No assigned tasks'}</span>
                    </div>
                    <progress
                      aria-label={`${id} task completion estimate`}
                      max={100}
                      value={progress.percentage}
                      className="h-2 w-full accent-gf-accent"
                    />
                    <p className="mt-1 text-xs text-gf-muted">{progress.completed} of {progress.total} assigned tasks done</p>
                  </div>
                </article>
              )
            })}
          </div>
        ) : <p className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">No workers have been reported.</p>}
      </section>

      <section aria-labelledby="agent-task-history-heading">
        <h2 id="agent-task-history-heading" className="mb-3 font-display text-lg font-semibold">Task history</h2>
        <div className="mb-3 rounded-2xl border border-gf-line bg-gf-surface p-4">
          <h3 className="mb-2 text-sm font-semibold">Boss health trend</h3>
          <HealthTrendChart points={healthTrend} />
        </div>
        {historyAgentIds.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {historyAgentIds.map(id => {
              const entries = agentHistory[id] ?? []
              return (
                <div key={id} className="min-w-0 rounded-2xl border border-gf-line bg-gf-surface p-4">
                  {entries.length ? (
                    <table className="w-full text-start text-xs">
                      <caption className="mb-2 text-start text-sm font-semibold">{id}: last {entries.length} {entries.length === 1 ? 'task' : 'tasks'}</caption>
                      <thead className="text-gf-muted">
                        <tr>
                          <th scope="col" className="pe-2 text-start font-medium">Task</th>
                          <th scope="col" className="pe-2 text-start font-medium">Outcome</th>
                          <th scope="col" className="text-start font-medium">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((entry, index) => (
                          <tr key={`${entry.taskId}-${entry.outcome}-${index}`} className="border-t border-gf-line">
                            <th scope="row" className="py-1 pe-2 text-start font-medium text-gf-ink">{entry.taskId}</th>
                            <td className="py-1 pe-2"><span className={`rounded-full px-2 py-0.5 ${outcomeStyles[entry.outcome]}`}>{entry.outcome}</span></td>
                            <td className="py-1 text-gf-muted">{entry.datetime ? <time dateTime={entry.datetime}>{entry.timestamp ?? entry.datetime}</time> : 'Unknown time'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <>
                      <h3 className="mb-1 text-sm font-semibold">{id}</h3>
                      <p className="text-xs text-gf-muted">No task outcomes recorded yet.</p>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ) : <p className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">No task history recorded.</p>}
      </section>

      <section aria-labelledby="agent-history-heading">
        <h2 id="agent-history-heading" className="mb-3 font-display text-lg font-semibold">Recent history</h2>
        {recentMessages.length ? (
          <ol className="flex flex-col gap-2">
            {recentMessages.map(teamMessage => (
              <li key={`${teamMessage.datetime || teamMessage.timestamp}-${teamMessage.from}-${teamMessage.to}-${teamMessage.text}`} className="rounded-xl border border-gf-line bg-gf-surface p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-gf-muted">
                  <span className="min-w-0 truncate"><span className="font-semibold text-gf-ink">{teamMessage.from}</span> <span aria-hidden="true">→</span> <span className="font-semibold text-gf-ink">{teamMessage.to}</span></span>
                  <time dateTime={teamMessage.datetime}>{teamMessage.timestamp}</time>
                </div>
                <p className="mt-2 break-words text-sm text-gf-ink">{teamMessage.text}</p>
              </li>
            ))}
          </ol>
        ) : <p className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">No recent team history.</p>}
      </section>
    </div>
  )
}
