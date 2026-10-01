'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import WorkflowDependencyGraph from '@/components/agent-world/WorkflowDependencyGraph'
import type { AgentWorldRecord } from '../../agent-world/agent-world-model'

type AgentRecord = { provider: string | null; model: string | null; enabled: boolean; role?: string | null; strengths?: string[] }
type Agent = AgentRecord & { id: string }
type TaskKind = 'feature' | 'bugfix' | 'security' | 'performance' | 'refactor' | 'test' | 'docs' | 'chore'
type WorkflowTask = {
  id: string
  title: string
  kind: TaskKind
  assignee: string
  area: string[]
  dependsOn: string[]
  acceptanceCriteria: string[]
}
type WorkflowMember = { id: string; provider: string; model: string }
type Workflow = {
  name: string
  description: string
  leader: string
  workers: WorkflowMember[]
  mode: 'ordered' | 'dependent'
  tasks: WorkflowTask[]
}
type WorkflowTemplate = Workflow & { id: string; version: number }
type TeamTemplate = { id: string; name: string; description: string; agents: string[] }
type Notice = { error: boolean; message: string } | null

const kinds: TaskKind[] = ['feature', 'bugfix', 'security', 'performance', 'refactor', 'test', 'docs', 'chore']

function newTask(assignee: string, id = `step-${crypto.randomUUID()}`): WorkflowTask {
  return {
    id,
    title: '',
    kind: 'feature',
    assignee,
    area: [],
    dependsOn: [],
    acceptanceCriteria: [],
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = typeof data?.error === 'string' ? data.error : `Request failed (${response.status}).`
    const partial = Array.isArray(data?.launched)
      ? ` Partial launch state: ${data.launched.map((task: { taskId?: unknown }) => String(task.taskId ?? 'pending')).join(', ')}.`
      : ''
    throw new Error(error + partial)
  }
  return data as T
}

function taskRecord(entry: WorkflowTask): WorkflowTask {
  return {
    ...entry,
    area: entry.area ?? [],
    dependsOn: entry.dependsOn ?? [],
    acceptanceCriteria: entry.acceptanceCriteria ?? [],
  }
}

function resolveTeamTemplateAgents(ids: string[], agents: Agent[]): string[] {
  const selected = new Set<string>()
  for (const id of ids) {
    if (agents.some(agent => agent.id === id)) selected.add(id)
  }
  for (const id of ids) {
    if (agents.some(agent => agent.id === id)) continue
    const [, ...roleParts] = id.split('-')
    const roleHint = roleParts.join('-')
    const candidate = agents.find(agent => {
      if (agent.id === 'boss' || selected.has(agent.id)) return false
      const provider = agent.provider?.toLowerCase() ?? ''
      const identity = `${agent.id} ${agent.role ?? ''} ${(agent.strengths ?? []).join(' ')}`.toLowerCase()
      if (roleHint && !new RegExp(roleHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(identity)) {
        const roleAliases: Record<string, RegExp> = {
          qa: /qa|quality|test/,
          perf: /perf|performance/,
        }
        if (!roleAliases[roleHint]?.test(identity)) return false
      }
      return provider === id.split('-')[0]
    })
    if (candidate) selected.add(candidate.id)
  }
  return [...selected]
}

export default function AgentWorkflowBuilderPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [liveTasks, setLiveTasks] = useState<AgentWorldRecord[]>([])
  const [teamTemplates, setTeamTemplates] = useState<TeamTemplate[]>([])
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplate[]>([])
  const [workflow, setWorkflow] = useState<Workflow>({
    name: '',
    description: '',
    leader: 'boss',
    workers: [],
    mode: 'dependent',
    tasks: [newTask('boss', 'step-1')],
  })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [templateName, setTemplateName] = useState('')

  const agentById = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents])
  const workerIds = workflow.workers.map(worker => worker.id)
  const load = useCallback(async (signal?: AbortSignal) => {
    const [snapshotData, templatesData] = await Promise.all([
      fetch('/api/agents', { signal }).then(readJson<{ snapshot: { agents: Record<string, AgentRecord>; boss?: AgentRecord; tasks?: AgentWorldRecord[] } }>),
      fetch('/agents/builder/templates', { signal }).then(readJson<{ teamTemplates: TeamTemplate[]; workflowTemplates: WorkflowTemplate[] }>),
    ])
    const found: Agent[] = Object.entries(snapshotData.snapshot.agents ?? {})
      .filter(([, agent]) => agent.enabled !== false)
      .map(([id, agent]) => ({ ...agent, id }))
    if (snapshotData.snapshot.boss?.enabled !== false && snapshotData.snapshot.boss) {
      found.push({ ...snapshotData.snapshot.boss, id: 'boss' })
    }
    setAgents(found)
    setLiveTasks(snapshotData.snapshot.tasks ?? [])
    setTeamTemplates(templatesData.teamTemplates)
    setWorkflowTemplates(templatesData.workflowTemplates)
    setWorkflow(current => {
      const leader = found.some(agent => agent.id === current.leader) ? current.leader : 'boss'
      const workers = current.workers
        .filter(worker => found.some(agent => agent.id === worker.id) && worker.id !== leader)
        .map(worker => {
          const agent = found.find(candidate => candidate.id === worker.id)!
          return { id: agent.id, provider: agent.provider ?? 'unknown', model: agent.model ?? 'auto' }
        })
      return { ...current, leader, workers }
    })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal).catch(error => {
      if (!controller.signal.aborted) setNotice({ error: true, message: error instanceof Error ? error.message : 'Unable to load workflow builder.' })
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
      if (controller.signal.aborted || document.visibilityState !== 'visible') return
      try {
        const data = await fetch('/api/agents', { signal: controller.signal })
          .then(readJson<{ snapshot: { tasks?: AgentWorldRecord[] } }>)
        if (!controller.signal.aborted) setLiveTasks(data.snapshot.tasks ?? [])
      } catch (error) {
        if (!controller.signal.aborted) {
          setNotice({ error: true, message: error instanceof Error ? error.message : 'Unable to refresh the live task graph.' })
        }
      }
    }
    const interval = window.setInterval(() => void refresh(), 10_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const changeWorkers = (id: string, checked: boolean) => {
    setWorkflow(current => {
      const workers = checked
        ? [...current.workers, {
          id,
          provider: agentById.get(id)?.provider ?? 'unknown',
          model: agentById.get(id)?.model ?? 'auto',
        }]
        : current.workers.filter(worker => worker.id !== id)
      const selected = new Set(workers.map(worker => worker.id))
      return {
        ...current,
        workers,
        tasks: current.tasks.map(task => ({
          ...task,
          assignee: selected.has(task.assignee) || task.assignee === current.leader
            ? task.assignee
            : workers[0]?.id ?? current.leader,
        })),
      }
    })
  }

  const applyTemplate = (id: string) => {
    const workflowTemplate = workflowTemplates.find(template => template.id === id)
    if (workflowTemplate) {
      setWorkflow({
        name: workflowTemplate.name,
        description: workflowTemplate.description,
        leader: workflowTemplate.leader,
        workers: workflowTemplate.workers.map(worker => ({
          id: worker.id,
          provider: agentById.get(worker.id)?.provider ?? worker.provider,
          model: agentById.get(worker.id)?.model ?? worker.model,
        })),
        mode: workflowTemplate.mode,
        tasks: workflowTemplate.tasks.map(task => {
          const normalized = taskRecord(task)
          const available = [workflowTemplate.leader, ...workflowTemplate.workers.map(worker => worker.id)]
          return available.includes(normalized.assignee)
            ? normalized
            : { ...normalized, assignee: workflowTemplate.workers[0]?.id ?? workflowTemplate.leader }
        }),
      })
      return
    }
    const teamTemplate = teamTemplates.find(template => template.id === id)
    if (!teamTemplate) return
    const selected = resolveTeamTemplateAgents(teamTemplate.agents, agents).filter(agentId => agentId !== 'boss')
    setWorkflow(current => ({
      ...current,
      leader: agentById.has('boss') ? 'boss' : current.leader,
      workers: selected.map(agentId => ({
        id: agentId,
        provider: agentById.get(agentId)?.provider ?? 'unknown',
        model: agentById.get(agentId)?.model ?? 'auto',
      })),
      tasks: current.tasks.map(task => selected.some(agentId => agentId === task.assignee)
        ? task
        : { ...task, assignee: selected[0] ?? current.leader }),
    }))
  }

  const updateTask = (taskId: string, update: Partial<WorkflowTask>) => {
    setWorkflow(current => ({
      ...current,
      tasks: current.tasks.map(task => task.id === taskId ? { ...task, ...update } : task),
    }))
  }

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      setNotice({ error: true, message: 'Enter a name for the reusable workflow template.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const data = await fetch('/agents/builder/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', workflow: { ...workflow, name: templateName.trim() } }),
      }).then(readJson<{ template: WorkflowTemplate }>)
      setWorkflowTemplates(current => [data.template, ...current])
      setTemplateName('')
      setNotice({ error: false, message: `Saved "${data.template.name}" as a reusable template.` })
    } catch (error) {
      setNotice({ error: true, message: error instanceof Error ? error.message : 'Unable to save workflow template.' })
    } finally {
      setBusy(false)
    }
  }

  const launch = async () => {
    if (!window.confirm(`Queue ${workflow.tasks.length} workflow tasks for the boss? Dependencies will be mapped to their actual task IDs.`)) return
    setBusy(true)
    setNotice(null)
    try {
      const data = await fetch('/agents/builder/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow }),
      }).then(readJson<{ queued: Array<{ taskId: string; title: string; dependencies: string[] }> }>)
      await load()
      setNotice({
        error: false,
        message: `Queued ${data.queued.length} workflow tasks: ${data.queued.map(task => task.taskId).join(', ')}.`,
      })
    } catch (error) {
      setNotice({ error: true, message: error instanceof Error ? error.message : 'Unable to launch workflow.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-gf-bg px-4 py-6 font-plex text-gf-ink lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/agents" className="text-sm text-gf-accent hover:underline">← Agent Teams</Link>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Team and workflow builder</h1>
            <p className="mt-1 text-sm text-gf-muted">Compose a team, set acceptance criteria, and wire prerequisites into the live task board.</p>
          </div>
          <select aria-label="Load team or workflow template" defaultValue="" onChange={event => applyTemplate(event.target.value)}
            className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm">
            <option value="">Start from a template…</option>
            {teamTemplates.map(template => <option key={`team-${template.id}`} value={template.id}>{template.name} team</option>)}
            {workflowTemplates.map(template => <option key={`workflow-${template.id}`} value={template.id}>{template.name} workflow</option>)}
          </select>
        </header>

        {notice && <p role={notice.error ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${notice.error ? 'border-red-900 bg-red-950/60 text-red-200' : 'border-emerald-900 bg-emerald-950/50 text-emerald-200'}`}>{notice.message}</p>}
        {loading ? <p role="status" className="rounded-2xl border border-gf-line bg-gf-surface p-6 text-sm text-gf-muted">Loading team and workflow templates…</p> : (
          <>
            <section className="rounded-2xl border border-gf-line bg-gf-surface p-4" aria-labelledby="workflow-team-heading">
              <h2 id="workflow-team-heading" className="font-display text-lg font-semibold">Team composition</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-gf-muted">
                  <span>Leader / boss</span>
                  <select aria-label="Workflow leader" value={workflow.leader}
                    onChange={event => setWorkflow(current => {
                      const leader = event.target.value
                      const workers = current.workers.filter(worker => worker.id !== leader)
                      const available = new Set([leader, ...workers.map(worker => worker.id)])
                      return {
                        ...current,
                        leader,
                        workers,
                        tasks: current.tasks.map(task => available.has(task.assignee)
                          ? task
                          : { ...task, assignee: workers[0]?.id ?? leader }),
                      }
                    })}
                    className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm text-gf-ink">
                    {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.id} · {agent.provider ?? 'unknown'} / {agent.model ?? 'auto'}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gf-muted">
                  <span>Task relationship</span>
                  <select aria-label="Workflow mode" value={workflow.mode} onChange={event => setWorkflow(current => ({ ...current, mode: event.target.value as Workflow['mode'] }))}
                    className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm text-gf-ink">
                    <option value="dependent">Explicit dependencies</option>
                    <option value="ordered">Strict order (each step waits for the previous)</option>
                  </select>
                </label>
              </div>
              <fieldset className="mt-4">
                <legend className="text-sm font-semibold">Choose workers (provider and model are the enabled agent configuration)</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {agents.filter(agent => agent.id !== workflow.leader).map(agent => (
                    <label key={agent.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-gf-line p-3 text-sm">
                      <input type="checkbox" checked={workerIds.includes(agent.id)} onChange={event => changeWorkers(agent.id, event.target.checked)} />
                      <span className="min-w-0"><strong>{agent.id}</strong><span className="ms-2 text-xs text-gf-muted">{agent.provider ?? 'unknown'} · {agent.model ?? 'auto'}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>

            <section className="rounded-2xl border border-gf-line bg-gf-surface p-4" aria-labelledby="workflow-details-heading">
              <h2 id="workflow-details-heading" className="font-display text-lg font-semibold">Workflow details</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-gf-muted"><span>Name</span><input maxLength={80} value={workflow.name} onChange={event => setWorkflow(current => ({ ...current, name: event.target.value }))} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm text-gf-ink" /></label>
                <label className="flex flex-col gap-1 text-xs text-gf-muted"><span>Description</span><input maxLength={240} value={workflow.description} onChange={event => setWorkflow(current => ({ ...current, description: event.target.value }))} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm text-gf-ink" /></label>
              </div>
            </section>

            <section className="rounded-2xl border border-gf-line bg-gf-surface p-4" aria-labelledby="workflow-tasks-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 id="workflow-tasks-heading" className="font-display text-lg font-semibold">Workflow tasks</h2><p className="mt-1 text-sm text-gf-muted">Dependencies refer to earlier tasks here or existing T-IDs on the board.</p></div>
                <button type="button" disabled={workflow.tasks.length >= 20} onClick={() => setWorkflow(current => ({ ...current, tasks: [...current.tasks, newTask(current.workers[0]?.id ?? current.leader)] }))}
                  className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">Add task</button>
              </div>
              <ol className="mt-4 flex flex-col gap-3">
                {workflow.tasks.map((task, index) => (
                  <li key={task.id} className="rounded-xl border border-gf-line p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Step {index + 1}</h3>
                      <button type="button" disabled={workflow.tasks.length <= 1} aria-label={`Remove step ${index + 1}`}
                        onClick={() => setWorkflow(current => ({
                          ...current,
                          tasks: current.tasks.filter(item => item.id !== task.id).map(item => ({ ...item, dependsOn: item.dependsOn.filter(id => id !== task.id) })),
                        }))}
                        className="min-h-9 rounded-lg border border-gf-line2 px-3 text-xs text-gf-muted disabled:opacity-50">Remove</button>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <label className="flex flex-col gap-1 text-xs text-gf-muted sm:col-span-2"><span>Task title</span><input maxLength={180} value={task.title} onChange={event => updateTask(task.id, { title: event.target.value })} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm text-gf-ink" /></label>
                      <label className="flex flex-col gap-1 text-xs text-gf-muted"><span>Kind</span><select value={task.kind} onChange={event => updateTask(task.id, { kind: event.target.value as TaskKind })} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm text-gf-ink">{kinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label>
                      <label className="flex flex-col gap-1 text-xs text-gf-muted"><span>Assignee</span><select value={task.assignee} onChange={event => updateTask(task.id, { assignee: event.target.value })} className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-2 text-sm text-gf-ink">{[workflow.leader, ...workflow.workers.map(worker => worker.id)].map(id => <option key={id} value={id}>{id} · {agentById.get(id)?.provider ?? 'unknown'} / {agentById.get(id)?.model ?? 'auto'}</option>)}</select></label>
                      <label className="flex flex-col gap-1 text-xs text-gf-muted sm:col-span-2"><span>Repository paths (comma-separated, optional)</span><input value={task.area.join(', ')} onChange={event => updateTask(task.id, { area: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} placeholder="web-ui/app, web-ui/test" className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm text-gf-ink" /></label>
                      {workflow.mode === 'dependent' && (
                        <fieldset className="sm:col-span-3">
                          <legend className="text-xs text-gf-muted">Depends on workflow steps</legend>
                          <div className="mt-2 flex flex-wrap gap-3">
                            {workflow.tasks.filter(candidate => candidate.id !== task.id).map(candidate => (
                              <label key={candidate.id} className="flex items-center gap-2 text-xs">
                                <input type="checkbox" checked={task.dependsOn.includes(candidate.id)} onChange={event => updateTask(task.id, {
                                  dependsOn: event.target.checked ? [...task.dependsOn, candidate.id] : task.dependsOn.filter(id => id !== candidate.id),
                                })} />
                                {candidate.title.trim() || `Step ${workflow.tasks.findIndex(item => item.id === candidate.id) + 1}`}
                              </label>
                            ))}
                          </div>
                          <label className="mt-2 flex flex-col gap-1 text-xs text-gf-muted"><span>Existing task IDs (comma-separated)</span><input value={task.dependsOn.filter(id => id.startsWith('T-')).join(', ')} onChange={event => {
                            const internal = task.dependsOn.filter(id => !id.startsWith('T-'))
                            updateTask(task.id, { dependsOn: [...internal, ...event.target.value.split(',').map(value => value.trim()).filter(Boolean)] })
                          }} placeholder="T-120, T-121" className="min-h-9 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm text-gf-ink" /></label>
                        </fieldset>
                      )}
                      <label className="flex flex-col gap-1 text-xs text-gf-muted sm:col-span-3"><span>Acceptance criteria (one per line)</span><textarea rows={3} maxLength={240 * 20} value={task.acceptanceCriteria.join('\n')} onChange={event => updateTask(task.id, { acceptanceCriteria: event.target.value.split('\n').map(value => value.trim()).filter(Boolean) })} className="rounded-lg border border-gf-line2 bg-gf-bar px-3 py-2 text-sm text-gf-ink" /></label>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-2xl border border-gf-line bg-gf-surface p-4" aria-labelledby="workflow-live-graph-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="workflow-live-graph-heading" className="font-display text-lg font-semibold">Live task dependency graph</h2>
                  <p className="mt-1 text-sm text-gf-muted">Board task IDs, dependency edges, and statuses refresh every 10 seconds while this page is visible.</p>
                </div>
                <span role="status" className="text-xs text-gf-muted">{liveTasks.length} reported tasks</span>
              </div>
              <WorkflowDependencyGraph tasks={liveTasks} />
            </section>

            <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-gf-line bg-gf-surface p-4" aria-label="Save and launch workflow">
              <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-gf-muted"><span>Save as reusable template</span><input maxLength={80} value={templateName} onChange={event => setTemplateName(event.target.value)} placeholder="Template name" className="min-h-10 rounded-lg border border-gf-line2 bg-gf-bar px-3 text-sm text-gf-ink" /></label>
              <button type="button" disabled={busy || !templateName.trim()} onClick={() => void saveTemplate()} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">{busy ? 'Saving…' : 'Save template'}</button>
              <button type="button" disabled={busy} onClick={() => void launch()} className="min-h-10 rounded-lg bg-gf-accent px-4 text-sm font-semibold text-gf-bg disabled:opacity-50">{busy ? 'Working…' : 'Launch workflow'}</button>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
