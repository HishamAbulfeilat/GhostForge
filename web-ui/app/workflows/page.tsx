'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate, templateToWorkflow } from '@/lib/workflows/templates'
import { SUGGESTED_COMMAND_REFS, type RunSummary, summarizeRun, unsupportedSteps } from './runnable'

// ── types (mirror lib/workflows/store) ───────────────────────────────────────
type StepKind = 'agent' | 'skill' | 'command' | 'manual'
type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked' | 'skipped'
type WorkflowStatus = 'draft' | 'running' | 'paused' | 'done' | 'failed'
interface WorkflowStep {
  id: string; title: string; kind: StepKind; ref: string; deps: string[]
  status: StepStatus; notes: string; startedAt?: string; finishedAt?: string
  log: Array<{ at: string; msg: string }>
}
interface Workflow {
  id: string; name: string; goal: string; status: WorkflowStatus
  steps: WorkflowStep[]; createdAt: string; updatedAt: string
  progress?: { done: number; total: number; pct: number }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const FOCUS = 'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent'

type RunResult = { id: string; summary: RunSummary | null; error?: string }

const STEP_STATUS: Record<StepStatus, { label: string; pill: string; stroke: string; fill: string; dot: string }> = {
  pending: { label: 'Pending', pill: 'bg-[#1A1F2B] text-gf-muted', stroke: '#334155', fill: '#12151C', dot: 'bg-gf-muted' },
  running: { label: 'Running', pill: 'bg-gf-accent-soft text-gf-accent-ink', stroke: '#38BDF8', fill: '#0C2A3A', dot: 'bg-gf-accent animate-pulse motion-reduce:animate-none' },
  done: { label: 'Done', pill: 'bg-gf-ok-soft text-gf-ok', stroke: '#6EE7B7', fill: '#052E1F', dot: 'bg-gf-ok' },
  failed: { label: 'Failed', pill: 'bg-red-950 text-red-300', stroke: '#FCA5A5', fill: '#450A0A', dot: 'bg-red-400' },
  blocked: { label: 'Blocked', pill: 'bg-gf-warn-soft text-gf-warn', stroke: '#FCD34D', fill: '#2B2107', dot: 'bg-gf-warn' },
  skipped: { label: 'Skipped', pill: 'bg-[#1A1F2B] text-gf-muted', stroke: '#334155', fill: '#12151C', dot: 'bg-gf-muted' },
}
const KIND: Record<StepKind, { icon: string; badge: string }> = {
  agent: { icon: '🤖', badge: 'bg-sky-900/60 text-sky-300 border border-sky-700' },
  skill: { icon: '⚡', badge: 'bg-violet-900/60 text-violet-300 border border-violet-700' },
  command: { icon: '🖥️', badge: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700' },
  manual: { icon: '✋', badge: 'bg-amber-900/60 text-amber-300 border border-amber-700' },
}

// Steps whose deps aren't all done are shown as blocked
function effectiveStatus(step: WorkflowStep, byId: Map<string, WorkflowStep>): StepStatus {
  if (step.status !== 'pending') return step.status
  const blocked = step.deps.some(d => { const p = byId.get(d); return p && p.status !== 'done' && p.status !== 'skipped' })
  return blocked ? 'blocked' : 'pending'
}

// ── layered DAG layout (dependency-free) ──────────────────────────────────────
const NODE_W = 210, NODE_H = 66, GAP_X = 80, GAP_Y = 26, PAD = 28
function layout(steps: WorkflowStep[]) {
  const byId = new Map(steps.map(s => [s.id, s]))
  const levelOf = new Map<string, number>()
  const visiting = new Set<string>()
  const level = (id: string): number => {
    if (levelOf.has(id)) return levelOf.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const s = byId.get(id)
    const lvl = !s || !s.deps.length ? 0 : 1 + Math.max(0, ...s.deps.filter(d => byId.has(d)).map(level))
    visiting.delete(id)
    levelOf.set(id, lvl)
    return lvl
  }
  steps.forEach(s => level(s.id))
  const cols = new Map<number, WorkflowStep[]>()
  steps.forEach(s => { const l = levelOf.get(s.id)!; if (!cols.has(l)) cols.set(l, []); cols.get(l)!.push(s) })
  const maxLevel = Math.max(0, ...[...cols.keys()])
  const maxRows = Math.max(1, ...[...cols.values()].map(c => c.length))
  const pos = new Map<string, { x: number; y: number }>()
  for (const [lvl, col] of cols) {
    const offset = (maxRows - col.length) * (NODE_H + GAP_Y) / 2
    col.forEach((s, row) => pos.set(s.id, { x: PAD + lvl * (NODE_W + GAP_X), y: PAD + offset + row * (NODE_H + GAP_Y) }))
  }
  return {
    pos,
    width: PAD * 2 + (maxLevel + 1) * NODE_W + maxLevel * GAP_X,
    height: PAD * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y,
  }
}

export default function WorkflowsPage() {
  const router = useRouter()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [selectedStep, setSelectedStep] = useState<string>('')
  const [tab, setTab] = useState<'map' | 'steps' | 'log'>('map')
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [lastRun, setLastRun] = useState<RunResult | null>(null)

  const selected = workflows.find(w => w.id === selectedId) || null
  const blockedSteps = useMemo(() => selected ? unsupportedSteps(selected.steps) : [], [selected])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api<{ workflows: Workflow[] }>('/api/workflows')
      setWorkflows(d.workflows)
      setSelectedId(prev => prev || d.workflows[0]?.id || '')
      setLoadError('')
    } catch (e) {
      if (e instanceof Error && /401|Unauthorized/.test(e.message)) { router.push('/login'); return }
      setLoadError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [router])

  useEffect(() => { void loadList() }, [loadList])

  const refreshSelected = useCallback(async (id: string) => {
    try {
      const d = await api<{ workflow: Workflow; progress?: Workflow['progress'] }>(`/api/workflows?id=${encodeURIComponent(id)}`)
      setWorkflows(prev => prev.map(w => w.id === id ? { ...d.workflow, progress: d.progress } : w))
    } catch { /* ignore */ }
  }, [])

  // Live poll while a workflow is running
  useEffect(() => {
    if (!selected || selected.status !== 'running') return
    const t = setInterval(() => void refreshSelected(selected.id), 3000)
    return () => clearInterval(t)
  }, [selected, refreshSelected])

  const setStepStatus = async (stepId: string, status: StepStatus) => {
    if (!selected) return
    try {
      const d = await api<{ workflow: Workflow }>('/api/workflows', json('PUT', { id: selected.id, stepId, step: { status }, log: `→ ${status}` }))
      setWorkflows(prev => prev.map(w => w.id === selected.id ? d.workflow : w))
    } catch (e) { setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) }) }
  }

  const runSelected = async () => {
    if (!selected || running) return
    setRunning(true); setLastRun(null); setNotice(null)
    try {
      const d = await api<{ workflow: Workflow; progress?: Workflow['progress'] }>('/api/workflows', json('POST', { action: 'run', id: selected.id }))
      setWorkflows(prev => prev.map(w => w.id === d.workflow.id ? { ...d.workflow, progress: d.progress } : w))
      setLastRun({ id: d.workflow.id, summary: summarizeRun(d.workflow) })
    } catch (e) {
      if (e instanceof Error && /401|Unauthorized/.test(e.message)) { router.push('/login'); return }
      setLastRun({ id: selected.id, summary: null, error: `Run failed: ${e instanceof Error ? e.message : String(e)}` })
      await refreshSelected(selected.id)
    } finally { setRunning(false) }
  }

  const createFromTemplate = async (template: WorkflowTemplate) => {
    try {
      const draft = templateToWorkflow(template)
      const d = await api<{ workflow: Workflow }>('/api/workflows', json('POST', { name: template.name, goal: template.goal, steps: draft.steps }))
      await loadList(); setSelectedId(d.workflow.id); setNotice({ tone: 'info', text: `Created "${d.workflow.name}".` })
    } catch (e) { setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) }) }
  }

  const createBlank = async () => {
    try {
      const d = await api<{ workflow: Workflow }>('/api/workflows', json('POST', { name: 'New workflow', goal: '' }))
      await loadList(); setSelectedId(d.workflow.id); setMode('edit')
    } catch (e) { setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) }) }
  }

  const removeWorkflow = async (id: string) => {
    try {
      await api('/api/workflows?id=' + id, { method: 'DELETE' })
      setSelectedId(''); await loadList()
    } catch (e) { setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) }) }
  }

  const saveEdited = async (patch: Partial<Workflow>) => {
    if (!selected) return
    try {
      const d = await api<{ workflow: Workflow }>('/api/workflows', json('PUT', { id: selected.id, ...patch }))
      setWorkflows(prev => prev.map(w => w.id === selected.id ? d.workflow : w)); setMode('view')
      setNotice({ tone: 'info', text: 'Saved.' })
    } catch (e) { setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) }) }
  }

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-gf-bg font-plex text-gf-ink">
      <div className="flex flex-col gap-1 px-4 pt-5 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">🗺️ Workflows</h1>
            <p className="font-mono text-xs text-gf-muted">Define multi-step plans (agents · skills · commands · manual) and track their progress.</p>
          </div>
          <button type="button" onClick={() => void createBlank()}
            className={`min-h-9 rounded-lg bg-gf-accent px-3 text-sm font-semibold text-gf-bg hover:brightness-110 ${FOCUS}`}>+ New workflow</button>
        </div>
      </div>

      {notice && (
        <div className="px-4 pt-3 lg:px-8">
          <div role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === 'error' ? 'border-red-900 bg-red-950/60 text-red-200' : 'border-cyan-900 bg-gf-accent-soft text-sky-100'}`}>
            {notice.text}
          </div>
        </div>
      )}

      <div className="grid gap-6 px-4 py-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:px-8">
        {/* ── list ── */}
        <aside className="flex flex-col gap-3" aria-label="Workflows" aria-busy={loading}>
          {loading ? (
            <div role="status" className="rounded-2xl border border-gf-line bg-gf-surface p-5 text-sm text-gf-muted">Loading workflows…</div>
          ) : loadError ? (
            <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-red-900 bg-red-950/60 p-5 text-sm text-red-200">
              <p>Could not load workflows: {loadError}</p>
              <button type="button" onClick={() => void loadList()}
                className={`min-h-9 self-start rounded-lg border border-red-800 px-3 text-sm ${FOCUS}`}>Retry</button>
            </div>
          ) : workflows.length === 0 ? (
            <p className="rounded-2xl border border-gf-line bg-gf-surface p-5 text-sm text-gf-muted">No workflows yet. Start from a template below.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {workflows.map(w => {
                const pct = w.progress?.pct ?? 0
                return (
                  <li key={w.id}>
                    <button type="button" aria-current={selectedId === w.id ? 'true' : undefined}
                      onClick={() => { setSelectedId(w.id); setMode('view'); setSelectedStep('') }}
                      className={`w-full rounded-xl border p-3 text-start transition ${FOCUS} ${selectedId === w.id ? 'border-gf-accent bg-gf-accent-soft/40' : 'border-gf-line bg-gf-surface hover:border-gf-line2'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm font-semibold truncate">{w.name}</span>
                        <span className="font-mono text-[11px] text-gf-muted shrink-0">{w.status} · {w.progress?.done ?? 0}/{w.progress?.total ?? 0}</span>
                      </div>
                      {w.goal && <p className="mt-0.5 line-clamp-2 text-xs text-gf-muted">{w.goal}</p>}
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gf-line" role="progressbar" aria-label={`${w.name} progress`}
                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                        <div className={`h-full ${w.status === 'running' ? 'bg-gf-accent' : w.status === 'failed' ? 'bg-red-400' : 'bg-gf-ok'} transition-[width]`} style={{ width: `${pct}%` }} />
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {!loading && !loadError && (
            <div className="flex flex-col gap-2 rounded-2xl border border-gf-line bg-gf-surface p-4">
              <h2 className="text-xs uppercase tracking-[0.06em] text-gf-muted">Templates</h2>
              {WORKFLOW_TEMPLATES.map(t => (
                <button key={t.name} type="button" onClick={() => void createFromTemplate(t)}
                  className={`rounded-xl border border-gf-line2 bg-gf-bar p-3 text-start hover:border-gf-accent ${FOCUS}`}>
                  <div className="font-display text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-gf-muted">{t.goal}</div>
                  {unsupportedSteps(templateToWorkflow(t).steps.map(s => ({ ...s, status: 'pending' }))).length === 0 && (
                    <div className="mt-1 text-[11px] text-gf-ok">Runnable now</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* ── detail ── */}
        <section className="min-w-0">
          {!selected ? (
            <div className="rounded-2xl border border-gf-line bg-gf-surface p-8 text-center text-sm text-gf-muted">Select or create a workflow.</div>
          ) : mode === 'edit' ? (
            <WorkflowEditor workflow={selected} onSave={saveEdited} onCancel={() => setMode('view')} onDelete={() => void removeWorkflow(selected.id)} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gf-line bg-gf-surface p-4">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold truncate">{selected.name}</h2>
                  {selected.goal && <p className="text-sm text-gf-muted">{selected.goal}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gf-muted">{selected.progress?.pct ?? 0}%</span>
                  <button type="button" onClick={() => void runSelected()} disabled={running || selected.status === 'running' || selected.steps.length === 0}
                    title="Runs manual steps (skipped) and allow-listed bridge commands only"
                    aria-label={`Run workflow ${selected.name}`} aria-busy={running} aria-describedby="wf-run-hint"
                    className={`min-h-9 rounded-lg bg-gf-accent px-3 text-sm font-semibold text-gf-bg hover:brightness-110 disabled:opacity-50 ${FOCUS}`}>{running ? 'Running…' : '▶ Run'}</button>
                  <button type="button" onClick={() => setMode('edit')} className={`min-h-9 rounded-lg border border-gf-line2 px-3 text-sm ${FOCUS}`}>Edit</button>
                </div>
                <p id="wf-run-hint" className="basis-full text-xs text-gf-muted">
                  Run executes up to 100 steps on the bridge: manual steps are skipped and only allow-listed <code className="font-mono">bridge:*</code> commands run.
                </p>
              </div>

              {blockedSteps.length > 0 && (
                <div role="note" className="rounded-xl border border-gf-warn bg-gf-warn-soft px-4 py-3 text-sm text-gf-warn">
                  The bridge will reject this run: {blockedSteps.length} step{blockedSteps.length === 1 ? '' : 's'} not on the run allowlist
                  ({blockedSteps.slice(0, 3).map(s => `${s.title || s.id} (${s.kind}${s.ref ? `: ${s.ref}` : ''})`).join(', ')}{blockedSteps.length > 3 ? ', …' : ''}).
                  Mark them done, change them to manual, or use a <code className="font-mono">bridge:health</code> / <code className="font-mono">bridge:release-status</code> command.
                </div>
              )}

              {lastRun?.id === selected.id && <RunResultPanel result={lastRun} onDismiss={() => setLastRun(null)} />}

              <div role="tablist" className="flex gap-1 border-b border-gf-line">
                {(['map', 'steps', 'log'] as const).map(t => (
                  <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
                    className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-medium capitalize ${FOCUS} ${tab === t ? 'border-gf-accent text-gf-ink' : 'border-transparent text-gf-muted'}`}>{t}</button>
                ))}
              </div>

              {tab === 'map' && <WorkflowMap workflow={selected} selectedStep={selectedStep} onSelectStep={setSelectedStep} />}
              {tab === 'steps' && <StepsPanel workflow={selected} onStatus={setStepStatus} />}
              {tab === 'log' && <LogPanel workflow={selected} />}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function RunResultPanel({ result, onDismiss }: { result: RunResult; onDismiss: () => void }) {
  const s = result.summary
  const ok = !!s?.ok
  return (
    <div role={ok ? 'status' : 'alert'}
      className={`flex flex-col gap-2 rounded-2xl border p-4 text-sm ${ok ? 'border-gf-ok bg-gf-ok-soft text-gf-ink' : 'border-red-900 bg-red-950/60 text-red-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display font-semibold">
          {s ? `Run ${ok ? 'finished' : s.status}: ${s.done} done · ${s.skipped} skipped · ${s.failed} failed of ${s.total}` : result.error}
        </h3>
        <button type="button" onClick={onDismiss} aria-label="Dismiss run result" className={`min-h-9 rounded-lg px-2 text-xs ${FOCUS}`}>✕</button>
      </div>
      {s && (
        <ul className="flex flex-col gap-1 font-mono text-xs">
          {s.steps.map(step => (
            <li key={step.id} className="flex flex-wrap gap-2">
              <span className="shrink-0">{STEP_STATUS[step.status as StepStatus]?.label ?? step.status}</span>
              <span className="font-semibold">{step.title}</span>
              {step.message && <span className="min-w-0 break-words text-gf-muted">{step.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function WorkflowMap({ workflow, selectedStep, onSelectStep }: { workflow: Workflow; selectedStep: string; onSelectStep: (id: string) => void }) {
  const byId = useMemo(() => new Map(workflow.steps.map(s => [s.id, s])), [workflow.steps])
  const { pos, width, height } = useMemo(() => layout(workflow.steps), [workflow.steps])
  if (!workflow.steps.length) {
    return <div className="rounded-2xl border border-gf-line bg-gf-bar p-8 text-center text-sm italic text-gf-muted">No steps yet — click Edit to add the first step.</div>
  }
  return (
    <div className="overflow-auto rounded-2xl border border-gf-line bg-gf-bar bg-grid" style={{ backgroundSize: '24px 24px' }}>
      <div className="relative" style={{ width, height, minWidth: '100%' }}>
        <svg width={width} height={height} className="absolute inset-0" aria-label="Workflow dependency map">
          <defs>
            <marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#334155" />
            </marker>
          </defs>
          {workflow.steps.flatMap(s => s.deps.filter(d => pos.has(d)).map(d => {
            const a = pos.get(d)!, b = pos.get(s.id)!
            const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2, dx = (x2 - x1) / 2
            const dep = byId.get(d)
            const stroke = dep && (dep.status === 'done' || dep.status === 'skipped') ? '#6EE7B7' : '#334155'
            return <path key={d + s.id} d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`} fill="none" stroke={stroke} strokeWidth={1.5} markerEnd="url(#wf-arrow)" opacity={0.7} />
          }))}
        </svg>
        {workflow.steps.map(s => {
          const p = pos.get(s.id)!; const eff = effectiveStatus(s, byId); const st = STEP_STATUS[eff]
          return (
            <button key={s.id} type="button" onClick={() => onSelectStep(s.id)}
              className={`absolute rounded-xl border px-3 text-start transition ${selectedStep === s.id ? 'ring-2 ring-gf-accent' : ''}`}
              style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H, borderColor: st.stroke, backgroundColor: st.fill }}>
              <div className="flex items-center gap-1.5">
                <span>{KIND[s.kind].icon}</span>
                <span className="font-display text-sm font-semibold truncate">{s.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                <span className="font-mono text-[11px] text-gf-muted truncate">{st.label}{s.ref ? ` · ${s.ref}` : ''}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StepsPanel({ workflow, onStatus }: { workflow: Workflow; onStatus: (stepId: string, status: StepStatus) => void }) {
  const byId = new Map(workflow.steps.map(s => [s.id, s]))
  return (
    <div className="flex flex-col gap-2">
      {workflow.steps.map(s => {
        const eff = effectiveStatus(s, byId); const st = STEP_STATUS[eff]
        return (
          <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gf-line bg-gf-surface p-3">
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${KIND[s.kind].badge}`}>{KIND[s.kind].icon} {s.kind}</span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-sm font-semibold truncate">{s.title}</div>
              {s.ref && <div className="font-mono text-xs text-gf-muted truncate">{s.ref}</div>}
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.pill}`}>{st.label}</span>
            <div className="flex gap-1.5">
              {eff !== 'running' && eff !== 'blocked' && <button type="button" onClick={() => onStatus(s.id, 'running')} className="min-h-9 rounded-lg border border-gf-line2 px-2.5 text-xs">Start</button>}
              {eff !== 'done' && <button type="button" onClick={() => onStatus(s.id, 'done')} className="min-h-9 rounded-lg border border-gf-line2 px-2.5 text-xs">Done</button>}
              {eff !== 'failed' && <button type="button" onClick={() => onStatus(s.id, 'failed')} className="min-h-9 rounded-lg border border-gf-line2 px-2.5 text-xs text-red-300">Fail</button>}
              {(s.status !== 'pending') && <button type="button" onClick={() => onStatus(s.id, 'pending')} className="min-h-9 rounded-lg border border-gf-line2 px-2.5 text-xs text-gf-muted">Reset</button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LogPanel({ workflow }: { workflow: Workflow }) {
  const entries = workflow.steps.flatMap(s => (s.log || []).map(l => ({ ...l, step: s.title }))).sort((a, b) => a.at.localeCompare(b.at))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight) }, [entries.length])
  return (
    <div ref={ref} className="max-h-96 overflow-auto rounded-2xl border border-gf-line bg-gf-bar p-3 font-mono text-xs">
      {entries.length === 0 ? <p className="text-gf-muted italic">No activity yet.</p> : entries.map((e, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-gf-accent-ink shrink-0">{new Date(e.at).toLocaleTimeString()}</span>
          <span className="text-gf-muted">[{e.step}]</span>
          <span className="text-gf-ink">{e.msg}</span>
        </div>
      ))}
    </div>
  )
}

function WorkflowEditor({ workflow, onSave, onCancel, onDelete }: {
  workflow: Workflow; onSave: (patch: Partial<Workflow>) => void; onCancel: () => void; onDelete: () => void
}) {
  const [name, setName] = useState(workflow.name)
  const [goal, setGoal] = useState(workflow.goal)
  const [steps, setSteps] = useState<WorkflowStep[]>(workflow.steps)

  const addStep = () => setSteps(prev => [...prev, { id: `s${Date.now().toString(36)}`, title: '', kind: 'manual', ref: '', deps: [], status: 'pending', notes: '', log: [] }])
  const updateStepField = (id: string, patch: Partial<WorkflowStep>) => setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  const removeStep = (id: string) => setSteps(prev => prev.filter(s => s.id !== id).map(s => ({ ...s, deps: s.deps.filter(d => d !== id) })))
  const toggleDep = (id: string, dep: string) => setSteps(prev => prev.map(s => s.id === id ? { ...s, deps: s.deps.includes(dep) ? s.deps.filter(d => d !== dep) : [...s.deps, dep] } : s))

  const inputCls = 'min-h-10 w-full rounded-lg border border-gf-line bg-gf-bar px-3 text-sm text-gf-ink placeholder:text-gf-muted focus:border-gf-accent outline-none'

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-gf-line bg-gf-surface p-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="wf-name" className="text-xs uppercase tracking-[0.06em] text-gf-muted">Name</label>
        <input id="wf-name" value={name} onChange={e => setName(e.target.value)} className={inputCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="wf-goal" className="text-xs uppercase tracking-[0.06em] text-gf-muted">Goal</label>
        <textarea id="wf-goal" value={goal} onChange={e => setGoal(e.target.value)} rows={2} className={inputCls} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.06em] text-gf-muted">Steps</span>
        {steps.map(s => (
          <div key={s.id} className="flex flex-col gap-2 rounded-xl border border-gf-line bg-gf-bar p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_130px]">
              <input value={s.title} placeholder="Step title" aria-label="Step title" onChange={e => updateStepField(s.id, { title: e.target.value })} className={inputCls} />
              <select value={s.kind} aria-label="Step type" onChange={e => updateStepField(s.id, { kind: e.target.value as StepKind })} className={inputCls}>
                <option value="agent">🤖 agent</option><option value="skill">⚡ skill</option><option value="command">🖥️ command</option><option value="manual">✋ manual</option>
              </select>
            </div>
            <input value={s.ref} onChange={e => updateStepField(s.id, { ref: e.target.value })} aria-label="Step reference or instruction" className={inputCls}
              list={s.kind === 'command' ? 'wf-command-refs' : undefined}
              placeholder={s.kind === 'agent' ? 'e.g. ecc:code-reviewer' : s.kind === 'skill' ? 'e.g. superpowers:brainstorming' : s.kind === 'command' ? 'e.g. bridge:health' : 'What must a human do?'} />
            {steps.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-gf-muted">Depends on:</span>
                {steps.filter(o => o.id !== s.id).map(o => (
                  <button key={o.id} type="button" onClick={() => toggleDep(s.id, o.id)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${s.deps.includes(o.id) ? 'border-gf-accent bg-gf-accent-soft text-gf-accent-ink' : 'border-gf-line text-gf-muted'}`}>
                    {o.title || o.id}
                  </button>
                ))}
                <button type="button" onClick={() => removeStep(s.id)} className="ms-auto text-xs text-red-300">Remove</button>
              </div>
            )}
          </div>
        ))}
        <datalist id="wf-command-refs">
          {SUGGESTED_COMMAND_REFS.map(ref => <option key={ref} value={ref} />)}
        </datalist>
        <p className="text-[11px] text-gf-muted">Only manual steps and allow-listed <code className="font-mono">bridge:*</code> commands can be run; agent and skill steps are tracked by hand.</p>
        <button type="button" onClick={addStep} className="rounded-xl border border-dashed border-gf-line2 py-2 text-sm text-gf-muted hover:border-gf-accent hover:text-gf-ink">+ Add step</button>
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={onDelete} className="text-sm text-red-300">Delete workflow</button>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="min-h-9 rounded-lg border border-gf-line2 px-3 text-sm">Cancel</button>
          <button type="button" onClick={() => onSave({ name, goal, steps })} className="min-h-9 rounded-lg bg-gf-accent px-4 text-sm font-semibold text-gf-bg hover:brightness-110">Save</button>
        </div>
      </div>
    </div>
  )
}
