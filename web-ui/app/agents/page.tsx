'use client'

import { useCallback, useEffect, useState } from 'react'

type Agent = {
  provider: string | null
  state: string
  task: string | null
  model: string | null
  cooldownUntil: string | null
}
type Task = { id: string | null; title: string; kind: string; status: string; owner: string | null }
type Snapshot = {
  health: number | null
  running: boolean
  agents: Record<string, Agent>
  tasks: Task[]
  messages: Array<{ ts?: string; from?: string; to?: string; text?: string }>
  phase: number
}

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/agents', init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`)
  return data as T
}

const action = (payload: Record<string, unknown>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

const stateStyle: Record<string, string> = {
  working: 'bg-cyan-950 text-cyan-200',
  running: 'bg-cyan-950 text-cyan-200',
  done: 'bg-emerald-950 text-emerald-200',
  blocked: 'bg-amber-950 text-amber-200',
  error: 'bg-red-950 text-red-200',
}

export default function AgentsPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const [message, setMessage] = useState('')
  const [recipient, setRecipient] = useState('all')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('feature')

  const load = useCallback(async () => {
    try {
      const data = await request<{ snapshot: Snapshot }>()
      setSnapshot(data.snapshot)
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : 'Unable to load agent team.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const run = async (name: string, payload: Record<string, unknown>) => {
    setBusy(name)
    setNotice(null)
    try {
      await request(action(payload))
      await load()
      setNotice({ error: false, text: 'Agent-team command completed.' })
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : 'Agent-team command failed.' })
    } finally {
      setBusy(null)
    }
  }

  const sendMessage = async () => {
    if (!message.trim()) {
      setNotice({ error: true, text: 'Enter a message before sending.' })
      return
    }
    await run('say', { action: 'say', to: recipient, message: message.trim() })
    setMessage('')
  }

  const addTask = async () => {
    if (!title.trim()) {
      setNotice({ error: true, text: 'Enter a task title before adding it.' })
      return
    }
    await run('add', { action: 'add', title: title.trim(), kind, agent: 'any' })
    setTitle('')
  }

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-gf-bg px-4 py-6 font-plex text-gf-ink lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">🤝 Agent Teams</h1>
            <p className="mt-1 text-sm text-gf-muted">Monitor providers, workers, tasks and team health.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} onClick={() => void run('start', { action: 'start' })}
              className="min-h-9 rounded-lg bg-gf-ok px-3 text-sm font-semibold text-gf-bg disabled:opacity-50">Start team</button>
            <button type="button" disabled={busy !== null} onClick={() => void run('stop', { action: 'stop' })}
              className="min-h-9 rounded-lg border border-red-800 px-3 text-sm font-semibold text-red-200 hover:bg-red-950 disabled:opacity-50">Stop team</button>
            <button type="button" disabled={busy !== null} onClick={() => void load()}
              className="min-h-9 rounded-lg border border-gf-line2 px-3 text-sm text-gf-muted hover:text-white disabled:opacity-50">Refresh</button>
          </div>
        </header>

        {notice && <div role={notice.error ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${notice.error ? 'border-red-900 bg-red-950/60 text-red-200' : 'border-emerald-900 bg-emerald-950/50 text-emerald-200'}`}>{notice.text}</div>}

        {loading ? <div role="status" className="rounded-2xl border border-gf-line bg-gf-surface p-6 text-sm text-gf-muted">Loading agent team…</div> : snapshot && (
          <>
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Team summary">
              {[
                ['Health', snapshot.health === null ? '—' : `${snapshot.health}%`],
                ['Team', snapshot.running ? 'Running' : 'Stopped'],
                ['Phase', String(snapshot.phase)],
              ].map(([label, value]) => <div key={label} className="rounded-2xl border border-gf-line bg-gf-surface p-4"><div className="text-xs uppercase tracking-wide text-gf-muted">{label}</div><div className="mt-1 font-display text-xl font-semibold">{value}</div></div>)}
            </section>

            <section aria-labelledby="workers-heading">
              <h2 id="workers-heading" className="mb-3 font-display text-lg font-semibold">Workers</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Object.entries(snapshot.agents).map(([id, agent]) => <article key={id} className="rounded-2xl border border-gf-line bg-gf-surface p-4">
                  <div className="flex items-center justify-between gap-2"><h3 className="truncate font-semibold">{id}</h3><span className={`rounded-full px-2 py-1 text-xs ${stateStyle[agent.state] || 'bg-white/10 text-white/70'}`}>{agent.state}</span></div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-gf-muted"><dt>Provider</dt><dd className="truncate text-gf-ink">{agent.provider || '—'}</dd><dt>Model</dt><dd className="truncate text-gf-ink">{agent.model || '—'}</dd><dt>Task</dt><dd className="truncate text-gf-ink">{agent.task || 'Idle'}</dd></dl>
                </article>)}
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <div>
                <h2 className="mb-3 font-display text-lg font-semibold">Tasks</h2>
                <div className="flex flex-col gap-2">{snapshot.tasks.length ? snapshot.tasks.map(task => <div key={task.id || task.title} className="rounded-xl border border-gf-line bg-gf-surface p-3"><div className="flex flex-wrap justify-between gap-2 text-sm font-semibold"><span>{task.title || 'Untitled task'}</span><span className="text-xs text-gf-muted">{task.status}</span></div><div className="mt-1 text-xs text-gf-muted">{task.kind} · {task.owner || 'unassigned'}</div></div>) : <p className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">No tasks on the board.</p>}</div>
              </div>
              <div>
                <h2 className="mb-3 font-display text-lg font-semibold">Team controls</h2>
                <div className="flex flex-col gap-3 rounded-2xl border border-gf-line bg-gf-surface p-4">
                  <div className="flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="agent-message">Message</label><input id="agent-message" value={message} onChange={event => setMessage(event.target.value)} placeholder="Say something to the team…" className="min-h-10 min-w-0 flex-1 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm outline-none focus:border-gf-accent" /><select aria-label="Message recipient" value={recipient} onChange={event => setRecipient(event.target.value)} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm"><option value="all">All</option>{Object.keys(snapshot.agents).map(id => <option key={id} value={id}>{id}</option>)}</select><button type="button" disabled={busy !== null} onClick={() => void sendMessage()} className="min-h-10 rounded-lg bg-gf-accent px-3 text-sm font-semibold text-gf-bg disabled:opacity-50">Say</button></div>
                  <div className="flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="agent-task">Task title</label><input id="agent-task" value={title} onChange={event => setTitle(event.target.value)} placeholder="Add a task…" className="min-h-10 min-w-0 flex-1 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm outline-none focus:border-gf-accent" /><select aria-label="Task kind" value={kind} onChange={event => setKind(event.target.value)} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm">{['feature', 'bugfix', 'security', 'performance', 'refactor', 'test', 'docs', 'chore'].map(value => <option key={value} value={value}>{value}</option>)}</select><button type="button" disabled={busy !== null} onClick={() => void addTask()} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">Add</button></div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
