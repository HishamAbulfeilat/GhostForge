'use client'

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AgentKanbanBoard from './AgentKanbanBoard'
import { getEnabledAgentIds, type Agent, type Task } from './dashboard-model'
type Snapshot = {
  health: number | null
  running: boolean
  agents: Record<string, Agent & { leader?: boolean; assignee?: string | null; role?: string | null; strengths?: string[] }>
  boss?: Agent & { leader?: boolean; assignee?: string | null; role?: string | null; strengths?: string[]; enabled?: boolean }
  tasks: Task[] & Array<Task & { assignee?: string | null; leader?: string | null; dependencies?: string[]; acceptanceCriteria?: string[] }>
  messages: Array<Record<string, unknown>>
  phase: number
  workflow?: {
    leader?: string | null
    mode?: string
    specialists?: string[]
  }
}

type DisplayMessage = {
  from: string
  to: string
  timestamp: string
  datetime: string | undefined
  text: string
}

type WorkflowTemplate = {
  id: string
  name: string
  title: string
  kind: string
  leader: string
  assignee: string
  workflow: string
  dependencies: string[]
  acceptanceCriteria: string[]
  createdAt: string
}

type WorkflowTemplateForm = Omit<WorkflowTemplate, 'id' | 'name' | 'createdAt'>
type Notice = { error: boolean; text: string }

function updateWhileActive(signal: AbortSignal, update: () => void): void {
  if (!signal.aborted) update()
}

function availableRecipients(
  agents: Snapshot['agents'] | undefined,
  boss: Snapshot['boss'],
): string[] {
  const ids = getEnabledAgentIds(agents ?? {})
  return boss ? [...ids, 'boss'] : ids
}

function keepAvailableSelection(current: string, fallback: string, available: string[]): string {
  return current === fallback || available.includes(current) ? current : fallback
}

function confirmTeamStop(onConfirm: () => void): void {
  if (window.confirm('Stop the agent team after in-flight tasks finish?')) onConfirm()
}

function subscribeToDashboardUpdates(load: () => Promise<void>, running: boolean | undefined): (() => void) | undefined {
  if (!running) return

  const refreshWhenVisible = () => {
    if (document.visibilityState === 'visible') void load()
  }
  const interval = window.setInterval(refreshWhenVisible, 15_000)
  document.addEventListener('visibilitychange', refreshWhenVisible)

  return () => {
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', refreshWhenVisible)
  }
}

function AgentNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return <div role={notice.error ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${notice.error ? 'border-red-900 bg-red-950/60 text-red-200' : 'border-emerald-900 bg-emerald-950/50 text-emerald-200'}`}>{notice.text}</div>
}

function normalizeMessages(value: unknown): DisplayMessage[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    if (typeof record.text !== 'string' || !record.text.trim()) return []

    const rawTimestamp = record.ts
    let datetime: string | undefined
    if (typeof rawTimestamp === 'string' || typeof rawTimestamp === 'number') {
      const date = new Date(rawTimestamp)
      if (!Number.isNaN(date.getTime())) {
        datetime = date.toISOString()
      }
    }

    return [{
      from: typeof record.from === 'string' && record.from.trim() ? record.from : 'Unknown sender',
      to: typeof record.to === 'string' && record.to.trim() ? record.to : 'Unknown recipient',
      timestamp: 'Unknown time',
      datetime,
      text: record.text.trim(),
    }]
  })
}

function formatDisplayMessages(value: unknown): DisplayMessage[] {
  return normalizeMessages(value).map(message => {
    if (!message.datetime) return message
    const date = new Date(message.datetime)
    if (Number.isNaN(date.getTime())) return message
    return { ...message, timestamp: date.toLocaleString() }
  })
}

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/agents', init)
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

async function requestTemplates<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/agents/templates', init)
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(typeof data?.error === 'string' ? data.error : `Template request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

type DashboardResult = { status: 'denied' } | { status: 'loaded'; snapshot: Snapshot } | { status: 'redirecting' }
type DashboardView = { snapshot: Snapshot | null; notice: Notice | null }

async function loadDashboard(onUnauthenticated: () => void, signal: AbortSignal): Promise<DashboardResult> {
  const authResponse = await fetch('/api/auth/me', { signal })
  if (authResponse.status === 401) {
    onUnauthenticated()
    return { status: 'redirecting' }
  }
  if (!authResponse.ok) throw new Error(`Unable to verify access (${authResponse.status})`)

  const authData = await authResponse.json() as {
    user?: { role?: string; permissions?: string[] }
    isAdmin?: boolean
  }
  const user = authData.user
  if (!user) throw new Error('Unable to verify your account.')
  if (!(authData.isAdmin || user.role === 'admin' || user.permissions?.includes('admin_tools'))) {
    return { status: 'denied' }
  }

  const data = await request<{ snapshot: Snapshot }>({ signal })
  return { status: 'loaded', snapshot: data.snapshot }
}

function dashboardView(result: DashboardResult): DashboardView {
  if (result.status === 'loaded') return { snapshot: result.snapshot, notice: null }
  if (result.status === 'denied') {
    return {
      snapshot: null,
      notice: {
        error: true,
        text: 'Your account is signed in, but it needs the admin_tools permission to access Agent Teams.',
      },
    }
  }
  return { snapshot: null, notice: null }
}

const action = (payload: Record<string, unknown>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

type ActionRunner = (name: string, payload: Record<string, unknown>) => Promise<void>

async function runAgentAction(
  name: string,
  payload: Record<string, unknown>,
  load: () => Promise<void>,
  setBusy: Dispatch<SetStateAction<string | null>>,
  setNotice: Dispatch<SetStateAction<Notice | null>>,
): Promise<void> {
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

async function submitTeamMessage(
  message: string,
  recipient: string,
  run: ActionRunner,
  setNotice: Dispatch<SetStateAction<Notice | null>>,
  clearMessage: () => void,
): Promise<void> {
  if (!message.trim()) {
    setNotice({ error: true, text: 'Enter a message before sending.' })
    return
  }
  await run('say', { action: 'say', to: recipient, message: message.trim() })
  clearMessage()
}

async function submitTeamTask(
  form: WorkflowTemplateForm,
  run: ActionRunner,
  setNotice: Dispatch<SetStateAction<Notice | null>>,
  reset: () => void,
): Promise<void> {
  if (!form.title.trim()) {
    setNotice({ error: true, text: 'Enter a task title before adding it.' })
    return
  }
  await run('add', {
    action: 'add',
    title: form.title.trim(),
    kind: form.kind,
    agent: form.assignee || 'any',
    assignee: form.assignee || 'any',
    leader: form.leader || 'boss',
    workflow: form.workflow,
    dependencies: form.dependencies,
    acceptanceCriteria: form.acceptanceCriteria,
  })
  reset()
}

function WorkflowTemplatesPanel({
  busy,
  setBusy,
  setNotice,
  templateForm,
  onDispatched,
}: {
  busy: string | null
  setBusy: Dispatch<SetStateAction<string | null>>
  setNotice: Dispatch<SetStateAction<Notice | null>>
  templateForm: WorkflowTemplateForm
  onDispatched: () => Promise<void>
}) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templateName, setTemplateName] = useState('')

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true)
    try {
      const data = await requestTemplates<{ templates: WorkflowTemplate[] }>()
      setTemplates(data.templates)
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : 'Unable to load workflow templates.' })
    } finally {
      setTemplatesLoading(false)
    }
  }, [setNotice])

  useEffect(() => { void loadTemplates() }, [loadTemplates])

  const save = async () => {
    if (!templateName.trim()) {
      setNotice({ error: true, text: 'Enter a name before saving the workflow template.' })
      return
    }
    setBusy('template-save')
    setNotice(null)
    try {
      const data = await requestTemplates<{ template: WorkflowTemplate }>(action({
        action: 'save',
        template: { ...templateForm, name: templateName.trim() },
      }))
      setTemplates(current => [data.template, ...current])
      setTemplateName('')
      setNotice({ error: false, text: `Saved workflow template “${data.template.name}”.` })
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : 'Unable to save workflow template.' })
    } finally {
      setBusy(null)
    }
  }

  const apply = async (template: WorkflowTemplate) => {
    if (!window.confirm(`Dispatch “${template.title}” using the “${template.name}” template?`)) return
    setBusy(`template-apply-${template.id}`)
    setNotice(null)
    try {
      const data = await requestTemplates<{ ok: boolean; output: string }>(action({ action: 'apply', id: template.id }))
      await onDispatched()
      setNotice({ error: false, text: data.output || `Dispatched “${template.title}”.` })
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : 'Unable to apply workflow template.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-gf-line bg-gf-surface p-4" aria-labelledby="workflow-templates-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="workflow-templates-heading" className="font-display text-lg font-semibold">Workflow templates</h2>
          <p className="mt-1 text-sm text-gf-muted">Save a validated task setup and dispatch it again when needed.</p>
        </div>
        <div className="flex min-w-0 flex-1 gap-2 sm:max-w-xl">
          <label className="sr-only" htmlFor="workflow-template-name">Template name</label>
          <input id="workflow-template-name" value={templateName} onChange={event => setTemplateName(event.target.value)}
            maxLength={80} placeholder="Template name" className="min-h-10 min-w-0 flex-1 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm outline-none focus:border-gf-accent" />
          <button type="button" disabled={busy !== null || !templateName.trim()} onClick={() => void save()}
            className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">
            {busy === 'template-save' ? 'Saving…' : 'Save current'}
          </button>
        </div>
      </div>
      {templatesLoading ? <p role="status" className="mt-4 text-sm text-gf-muted">Loading workflow templates…</p> : (
        templates.length ? (
          <ul className="mt-4 divide-y divide-gf-line">
            {templates.map(template => (
              <li key={template.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <h3 className="font-semibold">{template.name}</h3>
                  <p className="mt-1 break-words text-sm text-gf-muted">{template.title} · {template.kind} · {template.workflow}</p>
                </div>
                <button type="button" disabled={busy !== null} onClick={() => void apply(template)}
                  className="min-h-9 rounded-lg bg-gf-accent px-3 text-sm font-semibold text-gf-bg disabled:opacity-50">
                  {busy === `template-apply-${template.id}` ? 'Dispatching…' : 'Apply & dispatch'}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-4 text-sm text-gf-muted">No saved templates yet.</p>
      )}
    </section>
  )
}

export default function AgentsPage() {
  const router = useRouter()
  const loadPromise = useRef<Promise<void> | null>(null)
  const loadController = useRef<AbortController | null>(null)
  const refreshQueued = useRef(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([])
  const [message, setMessage] = useState('')
  const [recipient, setRecipient] = useState('all')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('feature')
  const [leader, setLeader] = useState('boss')
  const [assignee, setAssignee] = useState('any')
  const [workflowMode, setWorkflowMode] = useState('parallel')
  const [dependencies, setDependencies] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')

  const load = useCallback(async () => {
    if (loadPromise.current) {
      refreshQueued.current = true
      return loadPromise.current
    }

    const controller = new AbortController()
    loadController.current = controller
    const refresh = async () => {
      do {
        refreshQueued.current = false
        try {
          const result = await loadDashboard(() => router.replace('/login?next=/agents'), controller.signal)
          const view = dashboardView(result)
          updateWhileActive(controller.signal, () => {
            setSnapshot(view.snapshot)
            setNotice(view.notice)
          })
        } catch (error) {
          updateWhileActive(controller.signal, () => {
            setNotice({ error: true, text: error instanceof Error ? error.message : 'Unable to load agent team.' })
          })
        } finally {
          updateWhileActive(controller.signal, () => setLoading(false))
        }
      } while (refreshQueued.current)
    }

    const pending = refresh().finally(() => {
      if (loadController.current === controller) {
        loadController.current = null
        loadPromise.current = null
      }
    })
    loadPromise.current = pending
    return pending
  }, [router])

  useEffect(() => { void load() }, [load])
  useEffect(() => () => {
    refreshQueued.current = false
    const controller = loadController.current
    loadController.current = null
    loadPromise.current = null
    controller?.abort()
  }, [])

  useEffect(() => subscribeToDashboardUpdates(load, snapshot?.running), [load, snapshot?.running])

  useEffect(() => {
    setDisplayMessages(formatDisplayMessages(snapshot?.messages))
  }, [snapshot?.messages])

  const snapshotAgents = snapshot?.agents
  const snapshotBoss = snapshot?.boss
  useEffect(() => {
    const enabledAgentIds = getEnabledAgentIds(snapshotAgents ?? {})
    const recipientIds = availableRecipients(snapshotAgents, snapshotBoss)
    setLeader(current => keepAvailableSelection(current, 'boss', enabledAgentIds))
    setAssignee(current => keepAvailableSelection(current, 'any', enabledAgentIds))
    setRecipient(current => keepAvailableSelection(current, 'all', recipientIds))
  }, [snapshotAgents, snapshotBoss])

  const run: ActionRunner = (name, payload) => runAgentAction(name, payload, load, setBusy, setNotice)
  const sendMessage = () => submitTeamMessage(message, recipient, run, setNotice, () => setMessage(''))
  const addTask = () => submitTeamTask({
    title: title.trim(),
    kind,
    leader,
    assignee,
    workflow: workflowMode,
    dependencies: dependencies.split(',').map(item => item.trim()).filter(Boolean),
    acceptanceCriteria: acceptanceCriteria.split('\n').map(item => item.trim()).filter(Boolean),
  }, run, setNotice, () => {
    setTitle('')
    setDependencies('')
    setAcceptanceCriteria('')
  })

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-gf-bg px-4 py-6 font-plex text-gf-ink lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">🤝 Agent Teams</h1>
            <p className="mt-1 text-sm text-gf-muted">Monitor providers, workers, tasks and team health.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/agents/builder" className="inline-flex min-h-9 items-center rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent">
              Team + workflow builder
            </Link>
            <button type="button" disabled={busy !== null} onClick={() => void run('start', { action: 'start' })}
              className="min-h-9 rounded-lg bg-gf-ok px-3 text-sm font-semibold text-gf-bg disabled:opacity-50">Start team</button>
            <button type="button" disabled={busy !== null} onClick={() => confirmTeamStop(() => void run('stop', { action: 'stop' }))}
              className="min-h-9 rounded-lg border border-red-800 px-3 text-sm font-semibold text-red-200 hover:bg-red-950 disabled:opacity-50">Stop team</button>
            <button type="button" disabled={busy !== null} onClick={() => void load()}
              className="min-h-9 rounded-lg border border-gf-line2 px-3 text-sm text-gf-muted hover:text-white disabled:opacity-50">Refresh</button>
          </div>
        </header>

        <AgentNotice notice={notice} />

        {loading ? <div role="status" className="rounded-2xl border border-gf-line bg-gf-surface p-6 text-sm text-gf-muted">Loading agent team…</div> : snapshot && (
          <>
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Team summary">
              {[
                ['Health', snapshot.health === null ? '—' : `${snapshot.health}%`],
                ['Team', snapshot.running ? 'Running' : 'Stopped'],
                ['Phase', String(snapshot.phase)],
              ].map(([label, value]) => <div key={label} className="rounded-2xl border border-gf-line bg-gf-surface p-4"><div className="text-xs uppercase tracking-wide text-gf-muted">{label}</div><div className="mt-1 font-display text-xl font-semibold">{value}</div></div>)}
            </section>

            <section className="rounded-2xl border border-gf-line bg-gf-surface p-4" aria-label="Workflow summary">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold">Workflow</h2>
                <span className="rounded-full border border-gf-line2 bg-gf-bar px-2 py-1 text-xs uppercase tracking-wide text-gf-muted">{snapshot.workflow?.mode ?? 'parallel'}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-sm text-gf-muted">
                <span className="rounded-full bg-gf-bar px-2 py-1">Leader: <strong className="text-gf-ink">{snapshot.workflow?.leader ?? 'boss'}</strong></span>
                <span className="rounded-full bg-gf-bar px-2 py-1">Specialists: <strong className="text-gf-ink">{(snapshot.workflow?.specialists ?? []).length ? snapshot.workflow!.specialists!.join(', ') : '—'}</strong></span>
              </div>
            </section>

            <AgentKanbanBoard agents={snapshot.boss ? { ...snapshot.agents, boss: snapshot.boss } : snapshot.agents} tasks={snapshot.tasks} messages={displayMessages} />

            <WorkflowTemplatesPanel
              busy={busy}
              setBusy={setBusy}
              setNotice={setNotice}
              templateForm={{
                title: title.trim(),
                kind,
                leader,
                assignee,
                workflow: workflowMode,
                dependencies: dependencies.split(',').map(item => item.trim()).filter(Boolean),
                acceptanceCriteria: acceptanceCriteria.split('\n').map(item => item.trim()).filter(Boolean),
              }}
              onDispatched={load}
            />

            <section>
              <div>
                <h2 className="mb-3 font-display text-lg font-semibold">Team controls</h2>
                <div className="flex flex-col gap-3 rounded-2xl border border-gf-line bg-gf-surface p-4">
                  <div className="flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="agent-message">Message</label><input id="agent-message" value={message} onChange={event => setMessage(event.target.value)} placeholder="Say something to the team…" className="min-h-10 min-w-0 flex-1 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm outline-none focus:border-gf-accent" /><select aria-label="Message recipient" value={recipient} onChange={event => setRecipient(event.target.value)} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm"><option value="all">All</option>{availableRecipients(snapshot.agents, snapshot.boss).map(id => <option key={id} value={id}>{id}</option>)}</select><button type="button" disabled={busy !== null} onClick={() => void sendMessage()} className="min-h-10 rounded-lg bg-gf-accent px-3 text-sm font-semibold text-gf-bg disabled:opacity-50">Say</button></div>
                  <div className="flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="agent-task">Task title</label><input id="agent-task" value={title} onChange={event => setTitle(event.target.value)} placeholder="Add a task…" className="min-h-10 min-w-0 flex-1 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm outline-none focus:border-gf-accent" /><select aria-label="Task kind" value={kind} onChange={event => setKind(event.target.value)} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm">{['feature', 'bugfix', 'security', 'performance', 'refactor', 'test', 'docs', 'chore'].map(value => <option key={value} value={value}>{value}</option>)}</select><button type="button" disabled={busy !== null} onClick={() => void addTask()} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">Add</button></div>
                  <div className="grid gap-2 md:grid-cols-3">
                    <label className="flex flex-col gap-1 text-xs text-gf-muted"><span>Team leader</span><select aria-label="Workflow leader" value={leader} onChange={event => setLeader(event.target.value)} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm"><option value="boss">boss</option>{getEnabledAgentIds(snapshot.agents).filter(id => id !== 'boss').map(id => <option key={id} value={id}>{id}</option>)}</select></label>
                    <label className="flex flex-col gap-1 text-xs text-gf-muted"><span>Assignee</span><select aria-label="Workflow assignee" value={assignee} onChange={event => setAssignee(event.target.value)} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm"><option value="any">any</option>{getEnabledAgentIds(snapshot.agents).filter(id => id !== 'boss').map(id => <option key={id} value={id}>{id}</option>)}</select></label>
                    <label className="flex flex-col gap-1 text-xs text-gf-muted"><span>Mode</span><select aria-label="Workflow mode" value={workflowMode} onChange={event => setWorkflowMode(event.target.value)} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm"><option value="ordered">ordered</option><option value="parallel">parallel</option></select></label>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-gf-muted"><span>Dependencies</span><input value={dependencies} onChange={event => setDependencies(event.target.value)} placeholder="T-101, T-102" className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm outline-none focus:border-gf-accent" /></label>
                    <label className="flex flex-col gap-1 text-xs text-gf-muted"><span>Acceptance criteria</span><textarea value={acceptanceCriteria} onChange={event => setAcceptanceCriteria(event.target.value)} placeholder="One per line" rows={3} className="rounded-lg border border-gf-line2 bg-gf-bar px-3 py-2 text-sm outline-none focus:border-gf-accent" /></label>
                  </div>
                </div>
              </div>
            </section>

          </>
        )}
      </div>
    </main>
  )
}
