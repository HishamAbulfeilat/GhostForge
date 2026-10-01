'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ExternalLink, Pause, Play, RefreshCw, Send, SquarePlus } from 'lucide-react'
import AgentWorld from './AgentWorld'
import { buildAgentWorld, type AgentTeamSnapshot } from './agent-world-model'

type Notice = { error: boolean; text: string }

async function readError(response: Response) {
  const data = await response.json().catch(() => ({})) as { error?: unknown }
  return typeof data.error === 'string' ? data.error : `Request failed (${response.status})`
}

async function request<T>(init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/agents', { ...init, signal })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<T>
}

const action = (payload: Record<string, unknown>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

export default function AgentWorldShell({ standalone = false }: { standalone?: boolean }) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<AgentTeamSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [message, setMessage] = useState('')
  const [recipient, setRecipient] = useState('all')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('feature')
  const [leader, setLeader] = useState('boss')
  const [assignee, setAssignee] = useState('any')
  const [workflowMode, setWorkflowMode] = useState('parallel')
  const [dependencies, setDependencies] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const inFlight = useRef(false)
  const authVerified = useRef(false)

  const load = useCallback(async ({ background = false, signal }: { background?: boolean; signal?: AbortSignal } = {}) => {
    if (inFlight.current) return
    inFlight.current = true
    if (background) setRefreshing(true)
    try {
      if (!authVerified.current) {
        const authResponse = await fetch('/api/auth/me', { signal })
        if (authResponse.status === 401) {
          router.replace(`/login?next=${standalone ? '/agent-world' : '/agents'}`)
          return
        }
        if (!authResponse.ok) throw new Error(`Unable to verify access (${authResponse.status})`)
        const authData = await authResponse.json() as { user?: { role?: string; permissions?: string[] }; isAdmin?: boolean }
        if (!authData.user) throw new Error('Unable to verify your account.')
        if (!(authData.isAdmin || authData.user.role === 'admin' || authData.user.permissions?.includes('admin_tools'))) {
          setSnapshot(null)
          setNotice({ error: true, text: 'Your account needs the admin_tools permission to access Agent World.' })
          return
        }
        authVerified.current = true
      }
      const data = await request<{ snapshot: AgentTeamSnapshot }>(undefined, signal)
      setSnapshot(data.snapshot)
      setLastUpdatedAt(new Date())
      if (background) setNotice(null)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setNotice({ error: true, text: error instanceof Error ? error.message : 'Unable to load the Agent World snapshot.' })
    } finally {
      inFlight.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [router, standalone])

  useEffect(() => {
    const controller = new AbortController()
    void load({ signal: controller.signal })
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === 'visible') void load({ background: true })
    }
    const timer = window.setInterval(poll, 8_000)
    document.addEventListener('visibilitychange', poll)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [load])

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
    await run('add', {
      action: 'add',
      title: title.trim(),
      kind,
      agent: assignee || 'any',
      assignee: assignee || 'any',
      leader: leader || 'boss',
      workflow: workflowMode,
      dependencies: dependencies.split(',').map(item => item.trim()).filter(Boolean),
      acceptanceCriteria: acceptanceCriteria.split('\n').map(item => item.trim()).filter(Boolean),
    })
    setTitle('')
    setDependencies('')
    setAcceptanceCriteria('')
  }

  const world = buildAgentWorld(snapshot ?? {})
  const agentIds = Object.keys(snapshot?.agents ?? {})

  return (
    <main className="agent-world min-h-[calc(100dvh-64px)] bg-[#070b10] px-3 py-5 font-plex text-slate-100 sm:px-5 lg:px-8">
      <div className="mx-auto max-w-[1680px]">
        <header className="flex flex-col justify-between gap-4 border-b border-white/10 pb-5 xl:flex-row xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="grid size-10 place-items-center rounded-xl border border-amber-200/20 bg-amber-200/10 text-amber-100 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
                <span aria-hidden="true" className="text-lg">⚒</span>
              </div>
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">GhostForge Agent World</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">A live operations floor for local, app, cloud, and remote agent sessions.</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {standalone ? (
              <Link href="/agents" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                Integrated controls <ExternalLink aria-hidden="true" className="size-3.5" />
              </Link>
            ) : (
              <Link href="/agent-world" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                Open operations center <ExternalLink aria-hidden="true" className="size-3.5" />
              </Link>
            )}
            <button type="button" disabled={busy !== null} onClick={() => void run('start', { action: 'start' })} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-300 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50">
              <Play aria-hidden="true" className="size-3.5" /> Start team
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void run('stop', { action: 'stop' })} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-400/30 px-3 text-xs font-semibold text-rose-200 hover:bg-rose-400/10 disabled:opacity-50">
              <Pause aria-hidden="true" className="size-3.5" /> Stop team
            </button>
            <button type="button" disabled={refreshing} onClick={() => void load({ background: true })} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 hover:bg-white/5 disabled:opacity-50">
              <RefreshCw aria-hidden="true" className={`size-3.5 ${refreshing ? 'motion-safe:animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </header>

        {notice && <div role={notice.error ? 'alert' : 'status'} className={`mt-4 rounded-xl border px-4 py-3 text-sm ${notice.error ? 'border-rose-400/30 bg-rose-400/10 text-rose-100' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'}`}>{notice.text}</div>}

        {loading ? (
          <div role="status" className="mt-5 grid min-h-96 place-items-center rounded-2xl border border-white/10 bg-[#0c131c]">
            <div className="text-center">
              <RefreshCw aria-hidden="true" className="mx-auto size-6 text-cyan-300 motion-safe:animate-spin" />
              <p className="mt-3 text-sm text-slate-400">Loading the live forge…</p>
            </div>
          </div>
        ) : snapshot ? (
          <>
            <div className="mt-5"><AgentWorld world={world} lastUpdatedAt={lastUpdatedAt} /></div>

            <section aria-labelledby="agent-controls-heading" className="mt-5 rounded-2xl border border-white/10 bg-[#0c131c] p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id="agent-controls-heading" className="text-lg font-semibold text-white">Team controls</h2>
                  <p className="mt-1 text-sm text-slate-500">Commands use the existing authenticated Agent Teams API.</p>
                </div>
                <span className="text-xs text-slate-600">T-106 workflow metadata preserved</span>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                  <label className="text-xs font-medium text-slate-400" htmlFor="agent-message">Message the team</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input id="agent-message" value={message} onChange={event => setMessage(event.target.value)} placeholder="Give the team new context…" className="min-h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080e15] px-3 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-300" />
                    <select aria-label="Message recipient" value={recipient} onChange={event => setRecipient(event.target.value)} className="min-h-10 rounded-lg border border-white/10 bg-[#080e15] px-2 text-sm">
                      <option value="all">All</option>
                      {agentIds.map(id => <option key={id} value={id}>{id}</option>)}
                    </select>
                    <button type="button" disabled={busy !== null} onClick={() => void sendMessage()} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-cyan-300 px-3 text-sm font-semibold text-slate-950 disabled:opacity-50"><Send aria-hidden="true" className="size-4" /> Say</button>
                  </div>
                </div>
                <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="sr-only" htmlFor="agent-task">Task title</label>
                    <input id="agent-task" value={title} onChange={event => setTitle(event.target.value)} placeholder="Add a board task…" className="min-h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080e15] px-3 text-sm outline-none placeholder:text-slate-600 focus:border-cyan-300" />
                    <select aria-label="Task kind" value={kind} onChange={event => setKind(event.target.value)} className="min-h-10 rounded-lg border border-white/10 bg-[#080e15] px-2 text-sm">
                      {['feature', 'bugfix', 'security', 'performance', 'refactor', 'test', 'docs', 'chore'].map(value => <option key={value} value={value}>{value}</option>)}
                    </select>
                    <button type="button" disabled={busy !== null} onClick={() => void addTask()} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-cyan-300/30 px-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50"><SquarePlus aria-hidden="true" className="size-4" /> Add</button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-xs text-slate-500"><span>Workflow leader</span><select aria-label="Workflow leader" value={leader} onChange={event => setLeader(event.target.value)} className="min-h-9 rounded-lg border border-white/10 bg-[#080e15] px-2 text-sm text-slate-200"><option value="boss">boss</option>{agentIds.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
                    <label className="flex flex-col gap-1 text-xs text-slate-500"><span>Assignee</span><select aria-label="Workflow assignee" value={assignee} onChange={event => setAssignee(event.target.value)} className="min-h-9 rounded-lg border border-white/10 bg-[#080e15] px-2 text-sm text-slate-200"><option value="any">any</option>{agentIds.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
                    <label className="flex flex-col gap-1 text-xs text-slate-500"><span>Mode</span><select aria-label="Workflow mode" value={workflowMode} onChange={event => setWorkflowMode(event.target.value)} className="min-h-9 rounded-lg border border-white/10 bg-[#080e15] px-2 text-sm text-slate-200"><option value="ordered">ordered</option><option value="parallel">parallel</option></select></label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-slate-500"><span>Dependencies</span><input value={dependencies} onChange={event => setDependencies(event.target.value)} placeholder="T-101, T-102" className="min-h-9 rounded-lg border border-white/10 bg-[#080e15] px-3 text-sm text-slate-200 outline-none focus:border-cyan-300" /></label>
                    <label className="flex flex-col gap-1 text-xs text-slate-500"><span>Acceptance criteria</span><textarea value={acceptanceCriteria} onChange={event => setAcceptanceCriteria(event.target.value)} placeholder="One per line" rows={2} className="rounded-lg border border-white/10 bg-[#080e15] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-300" /></label>
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : !notice?.error ? (
          <p className="mt-5 rounded-xl border border-white/10 bg-[#0c131c] p-5 text-sm text-slate-400">No agent snapshot is available.</p>
        ) : null}
      </div>
    </main>
  )
}
