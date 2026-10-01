'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccess } from '@/components/AccessGuard'
import {
  THEME_OPTIONS,
  type AgentWorldEdge,
  type AgentWorldNode,
  type AgentWorldSnapshot,
  type AgentWorldTheme,
  type AgentWorldVariant,
  deriveAgentWorldProjection,
  getThemeStorageKey,
} from '@/lib/agent-world'

type Payload = {
  snapshot?: AgentWorldSnapshot
}

type ThemeStyle = {
  page: string
  surface: string
  surfaceStrong: string
  line: string
  text: string
  muted: string
  quiet: string
  accent: string
  accentSoft: string
  progress: string
  focus: string
}

const themeStyles: Record<AgentWorldTheme, ThemeStyle> = {
  taskville: {
    page: 'bg-[#080b12] text-white',
    surface: 'border-slate-700/70 bg-[#111722]',
    surfaceStrong: 'border-slate-600/70 bg-[#171f2c]',
    line: 'border-slate-700/70',
    text: 'text-white',
    muted: 'text-sky-100/85',
    quiet: 'text-sky-100/60',
    accent: 'bg-cyan-300 text-cyan-950',
    accentSoft: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100',
    progress: 'bg-cyan-300',
    focus: 'focus-visible:ring-cyan-300',
  },
  town: {
    page: 'bg-[#071611] text-emerald-50',
    surface: 'border-emerald-800 bg-[#0d241b]',
    surfaceStrong: 'border-emerald-700 bg-[#123326]',
    line: 'border-emerald-800',
    text: 'text-emerald-50',
    muted: 'text-emerald-100/80',
    quiet: 'text-emerald-200/60',
    accent: 'bg-lime-300 text-emerald-950',
    accentSoft: 'border-lime-300/30 bg-lime-300/10 text-lime-100',
    progress: 'bg-lime-300',
    focus: 'focus-visible:ring-lime-300',
  },
  office: {
    page: 'bg-[#e8e2d5] text-stone-950',
    surface: 'border-stone-300 bg-[#f7f3ea]',
    surfaceStrong: 'border-stone-400 bg-white',
    line: 'border-stone-300',
    text: 'text-stone-950',
    muted: 'text-stone-700',
    quiet: 'text-stone-600',
    accent: 'bg-orange-700 text-white',
    accentSoft: 'border-orange-700/30 bg-orange-700/10 text-orange-950',
    progress: 'bg-orange-700',
    focus: 'focus-visible:ring-orange-700',
  },
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function ProgressBar({ value, style }: { value: number; style: ThemeStyle }) {
  const percent = Math.round(clamp(value) * 100)
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full ${style.page}`}
      role="progressbar"
      aria-label="Status-derived progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className={`h-full rounded-full ${style.progress}`} style={{ width: `${percent}%` }} />
    </div>
  )
}

function NodeCard({ node, theme, compact = false }: { node: AgentWorldNode; theme: AgentWorldTheme; compact?: boolean }) {
  const style = themeStyles[theme]
  const state = node.stale ? 'stale' : node.status
  return (
    <article className={`flex flex-col border ${compact ? 'min-h-36 rounded-xl p-3' : 'min-h-48 rounded-2xl p-4'} ${style.surfaceStrong}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${style.quiet}`}>{node.kind}</p>
          <h3 className="mt-1 truncate text-base font-bold">{node.label}</h3>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${style.accentSoft}`}>
          {state}
        </span>
      </div>

      <p className={`mt-3 line-clamp-2 text-sm ${style.muted}`}>{node.task}</p>

      <dl className={`mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs ${style.quiet}`}>
        <dt>Role</dt>
        <dd className="truncate text-end font-medium">{node.role}</dd>
        <dt>Source</dt>
        <dd className="truncate text-end font-medium">{node.source}</dd>
      </dl>

      <div className="mt-auto pt-4">
        <div className={`mb-1.5 flex items-center justify-between text-[11px] ${style.quiet}`}>
          <span>Stage progress</span>
          <span>{Math.round(node.progress * 100)}%</span>
        </div>
        <ProgressBar value={node.progress} style={style} />
      </div>

      {!compact && node.details.length > 0 && (
        <ul className={`mt-3 space-y-1 text-xs ${style.quiet}`}>
          {node.details.map(detail => <li key={detail} className="truncate">{detail}</li>)}
        </ul>
      )}
    </article>
  )
}

function TaskVilleStage({ nodes, theme }: { nodes: AgentWorldNode[]; theme: AgentWorldTheme }) {
  const lanes = [
    { label: 'In motion', nodes: nodes.filter(node => node.active && !node.stale) },
    { label: 'Queued', nodes: nodes.filter(node => !node.active && !node.stale && node.status !== 'done' && node.status !== 'completed') },
    { label: 'Needs attention', nodes: nodes.filter(node => node.stale || ['blocked', 'error', 'stalled'].includes(node.status)) },
    { label: 'Landed', nodes: nodes.filter(node => ['done', 'completed', 'success'].includes(node.status)) },
  ].filter(lane => lane.nodes.length)
  const style = themeStyles[theme]

  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
      {lanes.map(lane => (
        <section key={lane.label} aria-labelledby={`lane-${lane.label.replaceAll(' ', '-').toLowerCase()}`}>
          <div className={`mb-3 flex items-center justify-between border-b pb-2 ${style.line}`}>
            <h2 id={`lane-${lane.label.replaceAll(' ', '-').toLowerCase()}`} className="font-bold">{lane.label}</h2>
            <span className={`text-xs ${style.quiet}`}>{lane.nodes.length}</span>
          </div>
          <div className="space-y-3">
            {lane.nodes.map(node => <NodeCard key={node.id} node={node} theme={theme} compact />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function TownStage({ nodes, theme }: { nodes: AgentWorldNode[]; theme: AgentWorldTheme }) {
  const style = themeStyles[theme]
  const districts = [
    { name: 'Agent quarter', description: 'Configured workers and coordinators', nodes: nodes.filter(node => node.kind === 'agent') },
    { name: 'Delivery yard', description: 'Work moving through the project', nodes: nodes.filter(node => node.kind === 'workflow') },
  ].filter(district => district.nodes.length)

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {districts.map(district => (
        <section key={district.name} className={`rounded-[2rem] border p-4 sm:p-5 ${style.surface}`}>
          <div className="mb-4">
            <h2 className="text-xl font-black tracking-tight">{district.name}</h2>
            <p className={`mt-1 text-sm ${style.muted}`}>{district.description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {district.nodes.map(node => <NodeCard key={node.id} node={node} theme={theme} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function OfficeStage({ nodes, theme }: { nodes: AgentWorldNode[]; theme: AgentWorldTheme }) {
  const style = themeStyles[theme]
  const agents = nodes.filter(node => node.kind === 'agent')
  const workflows = nodes.filter(node => node.kind === 'workflow')

  return (
    <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
      <section className={`border p-4 sm:p-5 ${style.surface}`}>
        <div className={`mb-4 flex items-end justify-between border-b pb-3 ${style.line}`}>
          <div>
            <h2 className="text-xl font-black tracking-tight">Team floor</h2>
            <p className={`mt-1 text-sm ${style.muted}`}>Each desk reflects a configured session.</p>
          </div>
          <span className={`text-sm ${style.quiet}`}>{agents.length} desks</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map(node => <NodeCard key={node.id} node={node} theme={theme} compact />)}
        </div>
      </section>
      <section className={`border p-4 sm:p-5 ${style.surfaceStrong}`}>
        <h2 className="text-xl font-black tracking-tight">Review board</h2>
        <p className={`mt-1 text-sm ${style.muted}`}>Current work, ordered from the live snapshot.</p>
        <div className="mt-4 space-y-3">
          {workflows.map(node => <NodeCard key={node.id} node={node} theme={theme} compact />)}
          {!workflows.length && <p className={`text-sm ${style.quiet}`}>No workflow items are recorded.</p>}
        </div>
      </section>
    </div>
  )
}

function WorkflowConnections({ edges, theme }: { edges: AgentWorldEdge[]; theme: AgentWorldTheme }) {
  const style = themeStyles[theme]
  return (
    <section className={`border p-4 sm:p-5 ${style.surface}`} aria-labelledby="workflow-connections">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="workflow-connections" className="text-lg font-black tracking-tight">Workflow graph</h2>
          <p className={`mt-1 text-sm ${style.muted}`}>Only relationships present in task ownership or session messages are shown.</p>
        </div>
        <span className={`text-sm ${style.quiet}`}>{edges.length}</span>
      </div>
      {edges.length ? (
        <ol className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {edges.map(edge => (
            <li key={edge.id} className={`flex min-w-0 items-center gap-2 border px-3 py-2 text-sm ${style.surfaceStrong}`}>
              <span className="truncate font-semibold">{edge.from}</span>
              <span aria-hidden="true">→</span>
              <span className="truncate font-semibold">{edge.to}</span>
              <span className={`ms-auto shrink-0 text-xs ${style.quiet}`}>{edge.label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={`mt-4 text-sm ${style.quiet}`}>No relationships can be derived from the current snapshot.</p>
      )}
    </section>
  )
}

function AccessibleSnapshot({ nodes, theme }: { nodes: AgentWorldNode[]; theme: AgentWorldTheme }) {
  const style = themeStyles[theme]
  return (
    <details className={`border ${style.surface}`}>
      <summary className={`cursor-pointer px-4 py-3 font-semibold outline-none focus-visible:ring-2 ${style.focus}`}>
        Accessible snapshot table
      </summary>
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <caption className="sr-only">Current Agent World nodes and status</caption>
          <thead>
            <tr className={style.surfaceStrong}>
              {['Name', 'Type', 'Role', 'Status', 'Current task', 'Progress'].map(label => (
                <th key={label} scope="col" className="px-3 py-2 text-start font-bold">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nodes.map(node => (
              <tr key={node.id} className={`border-t ${style.line}`}>
                <th scope="row" className="px-3 py-2 text-start font-semibold">{node.label}</th>
                <td className="px-3 py-2">{node.kind}</td>
                <td className="px-3 py-2">{node.role}</td>
                <td className="px-3 py-2">{node.stale ? 'stale' : node.status}</td>
                <td className="max-w-md px-3 py-2">{node.task}</td>
                <td className="px-3 py-2">{Math.round(node.progress * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function AgentWorldView({ variant, title, subtitle }: { variant: AgentWorldVariant; title: string; subtitle: string }) {
  const { user } = useAccess()
  const [theme, setTheme] = useState<AgentWorldTheme>('taskville')
  const [snapshot, setSnapshot] = useState<AgentWorldSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const canMaintain = user?.role === 'admin' || user?.permissions.includes('admin_tools')

  useEffect(() => {
    try {
      const stored = localStorage.getItem(getThemeStorageKey(variant))
      if (stored === 'taskville' || stored === 'office' || stored === 'town') setTheme(stored)
    } catch {
      // Browser storage is optional; the selected theme still works for this visit.
    }
  }, [variant])

  useEffect(() => {
    try {
      localStorage.setItem(getThemeStorageKey(variant), theme)
    } catch {
      // Browser storage is optional.
    }
  }, [theme, variant])

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)

    try {
      const endpoint = variant === 'product' ? '/api/agents?view=public' : '/api/agents'
      const response = await fetch(endpoint, { cache: 'no-store' })
      if (!response.ok) {
        if (response.status === 401) throw new Error('Sign in to load the live Agent World snapshot.')
        if (response.status === 403) throw new Error('The private maintainer world requires the admin_tools permission.')
        throw new Error(`The agent snapshot request failed (${response.status}).`)
      }
      const payload = (await response.json()) as Payload
      setSnapshot(payload.snapshot ?? null)
      setLastUpdated(new Date())
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The agent snapshot could not be loaded.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [variant])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load(true) }, 20_000)
    return () => window.clearInterval(timer)
  }, [load])

  const projection = useMemo(() => deriveAgentWorldProjection(snapshot, variant), [snapshot, variant])
  const style = themeStyles[theme]

  return (
    <main className={`min-h-[calc(100dvh-49px)] font-plex ${style.page}`}>
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <header className={`border p-5 sm:p-7 ${style.surfaceStrong}`}>
          <div className="grid gap-6 xl:grid-cols-[1fr_auto] xl:items-end">
            <div>
              <h1 className="max-w-3xl font-display text-3xl font-black tracking-[-0.03em] sm:text-5xl">{title}</h1>
              <p className={`mt-3 max-w-3xl text-sm sm:text-base ${style.muted}`}>{subtitle}</p>
              <div className={`mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs ${style.quiet}`} aria-live="polite">
                <span>Phase {projection.summary.phase}</span>
                <span>{snapshot?.running ? 'Live team process' : 'Stored snapshot'}</span>
                <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Waiting for snapshot'}</span>
              </div>
            </div>

            <div className="space-y-4">
              <nav aria-label="Agent World views" className="flex flex-wrap gap-2 xl:justify-end">
                <Link href="/agent-world" className={`border px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 ${style.surface} ${style.focus}`}>
                  Agent World
                </Link>
                {canMaintain && (
                  <>
                    <Link href="/maintainer-world" className={`border px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 ${style.surface} ${style.focus}`}>
                      Maintainer World
                    </Link>
                    <Link href="/agents" className={`border px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 ${style.surface} ${style.focus}`}>
                      Team controls
                    </Link>
                  </>
                )}
              </nav>

              <fieldset>
                <legend className={`mb-2 text-xs font-bold uppercase tracking-[0.14em] ${style.quiet}`}>World theme</legend>
                <div className="flex flex-wrap gap-2 xl:justify-end">
                  {THEME_OPTIONS.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      className={`border px-3 py-2 text-start text-sm outline-none motion-safe:transition-colors focus-visible:ring-2 ${style.focus} ${theme === option.id ? style.accent : style.surface}`}
                      onClick={() => setTheme(option.id)}
                      aria-pressed={theme === option.id}
                      title={option.description}
                    >
                      {option.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`border px-3 py-2 text-sm font-semibold outline-none motion-safe:transition-colors focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60 ${style.surface} ${style.focus}`}
                    onClick={() => void load(true)}
                    disabled={refreshing}
                  >
                    {refreshing ? 'Refreshing…' : 'Refresh snapshot'}
                  </button>
                </div>
              </fieldset>
            </div>
          </div>
        </header>

        <dl className={`grid border-x border-b sm:grid-cols-3 lg:grid-cols-6 ${style.line}`} aria-label="Agent World summary">
          {[
            ['Online', String(projection.summary.online)],
            ['Tasks', String(projection.summary.tasks)],
            ['Active', String(projection.summary.active)],
            ['Blocked', String(projection.summary.blocked)],
            ['Health', projection.summary.health === null ? '—' : `${projection.summary.health}%`],
            ['Theme', THEME_OPTIONS.find(option => option.id === theme)?.label ?? theme],
          ].map(([label, value]) => (
            <div key={label} className={`border-b p-3 last:border-b-0 sm:border-b-0 sm:border-e ${style.line}`}>
              <dt className={`text-[11px] font-bold uppercase tracking-[0.12em] ${style.quiet}`}>{label}</dt>
              <dd className="mt-1 text-lg font-black">{value}</dd>
            </div>
          ))}
        </dl>

        {error && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-red-400/50 bg-red-950 px-4 py-3 text-sm text-red-50" role="alert">
            <span>{error}</span>
            {error.startsWith('Sign in') && <Link href={`/login?next=/${variant === 'product' ? 'agent-world' : 'maintainer-world'}`} className="font-bold underline">Sign in</Link>}
          </div>
        )}

        {loading && !snapshot && (
          <div className={`mt-5 border p-6 text-sm ${style.surface}`} role="status">
            Loading the current Agent World snapshot…
          </div>
        )}

        {!loading && projection.notices.length > 0 && (
          <div className="mt-5 space-y-2" aria-label="Snapshot notices">
            {projection.notices.map(notice => (
              <p key={notice} className={`border px-4 py-3 text-sm ${style.surface}`}>{notice}</p>
            ))}
          </div>
        )}

        {!loading && projection.ready && (
          <div className="mt-7 space-y-6">
            <section aria-label={`${THEME_OPTIONS.find(option => option.id === theme)?.label} operational map`}>
              {theme === 'taskville' && <TaskVilleStage nodes={projection.nodes} theme={theme} />}
              {theme === 'town' && <TownStage nodes={projection.nodes} theme={theme} />}
              {theme === 'office' && <OfficeStage nodes={projection.nodes} theme={theme} />}
            </section>

            <WorkflowConnections edges={projection.edges} theme={theme} />
            <AccessibleSnapshot nodes={projection.nodes} theme={theme} />
          </div>
        )}

        {!loading && !projection.ready && (
          <div className={`mt-7 border border-dashed p-8 text-center ${style.surface}`}>
            <h2 className="text-lg font-bold">No Agent World data yet</h2>
            <p className={`mt-2 text-sm ${style.muted}`}>Start or configure the agent team, then refresh this view. No placeholder agents are generated.</p>
          </div>
        )}
      </div>
    </main>
  )
}

export default AgentWorldView
