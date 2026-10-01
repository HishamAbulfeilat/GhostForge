'use client'

import { useEffect, useState } from 'react'
import {
  BOARD_COLUMNS,
  countOpenTasks,
  findAgentTask,
  formatElapsed,
  getAgentProgress,
  groupTasksByStatus,
  type Agent,
  type BoardStatus,
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
  const recentMessages = messages.slice(-6).reverse()

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
                {groupedTasks[status].length ? groupedTasks[status].map((task, index) => (
                  <article key={task.id || `${task.title}-${index}`} className="rounded-xl border border-gf-line bg-gf-surface p-3">
                    <h4 className="break-words text-sm font-semibold">{task.title || 'Untitled task'}</h4>
                    <p className="mt-2 text-xs text-gf-muted">{task.id || 'No task ID'} · {task.kind}</p>
                    <p className="mt-1 truncate text-xs text-gf-muted">{task.owner || 'Unassigned'}</p>
                  </article>
                )) : <p className="rounded-xl border border-gf-line/70 bg-gf-surface/50 p-3 text-xs text-gf-muted">No tasks</p>}
              </div>
            </section>
          ))}
        </div>
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
