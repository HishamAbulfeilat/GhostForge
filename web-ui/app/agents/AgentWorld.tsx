'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  Boxes,
  ChevronRight,
  CircleDot,
  Cloud,
  Cpu,
  ExternalLink,
  Filter,
  GitBranch,
  HardDrive,
  ListTree,
  Map,
  MonitorSmartphone,
  Radio,
  TableProperties,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  agentWorldCounts,
  filterAgentWorld,
  type AgentWorld as AgentWorldModel,
  type AgentWorldFilters,
  type AgentWorldSession,
  type AgentWorldSourceKind,
  type AgentWorldTask,
} from './agent-world-model'
import { BOARD_COLUMNS, type BoardStatus } from './dashboard-model'

type ViewMode = 'world' | 'board' | 'table'

const sourceIcons: Record<AgentWorldSourceKind, LucideIcon> = {
  local: HardDrive,
  app: MonitorSmartphone,
  cloud: Cloud,
  remote: Radio,
  unknown: Boxes,
}

const statusTone: Record<BoardStatus, string> = {
  todo: 'border-slate-500/30 bg-slate-500/10 text-slate-200',
  'in-progress': 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100',
  review: 'border-violet-400/30 bg-violet-400/10 text-violet-100',
  done: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  blocked: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
}

const sessionStateTone: Record<string, string> = {
  working: 'bg-cyan-300 text-slate-950',
  running: 'bg-cyan-300 text-slate-950',
  busy: 'bg-cyan-300 text-slate-950',
  reviewing: 'bg-violet-300 text-slate-950',
  idle: 'bg-slate-500 text-white',
  waiting: 'bg-slate-500 text-white',
  blocked: 'bg-amber-300 text-slate-950',
  cooldown: 'bg-amber-300 text-slate-950',
  error: 'bg-rose-400 text-slate-950',
  offline: 'bg-slate-700 text-slate-200',
  stale: 'bg-orange-300 text-slate-950',
}

function present(value: string | null | undefined, fallback = 'Not reported') {
  return value?.trim() || fallback
}

function humanize(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Time not reported'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Time not reported' : parsed.toLocaleString()
}

function SourceBadge({ kind }: { kind: AgentWorldSourceKind }) {
  const Icon = sourceIcons[kind]
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/25 px-1.5 py-1 text-[11px] font-medium text-slate-300">
      <Icon aria-hidden="true" className="size-3" />
      {humanize(kind)}
    </span>
  )
}

function StateBadge({ state }: { state: string }) {
  const normalized = state.toLowerCase()
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold ${sessionStateTone[normalized] ?? 'bg-slate-700 text-slate-200'}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
      {humanize(state)}
    </span>
  )
}

function ForgeWorker({ session }: { session: AgentWorldSession }) {
  return (
    <article
      tabIndex={0}
      className="group relative min-h-36 rounded-xl border border-white/10 bg-[#101821] p-3 shadow-[0_10px_30px_rgba(0,0,0,0.3)] outline-none transition-[border-color,transform,box-shadow] focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30 motion-safe:hover:-translate-y-0.5"
      aria-label={`${session.name}, ${session.role}, ${session.state}`}
    >
      <div className="absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-200/20 bg-cyan-300/10 text-cyan-100">
            {session.leader ? <GitBranch aria-hidden="true" className="size-4" /> : <Cpu aria-hidden="true" className="size-4" />}
          </div>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-white">{session.name}</h4>
            <p className="truncate text-xs text-slate-400">{humanize(session.role)}</p>
          </div>
        </div>
        <StateBadge state={session.state} />
      </div>
      <p className="mt-3 line-clamp-2 min-h-8 text-xs leading-4 text-slate-300">
        {session.taskTitle ?? (['idle', 'waiting'].includes(session.state.toLowerCase()) ? 'Awaiting assignment' : 'Current task not reported')}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="truncate">{present(session.provider)}</span>
        <span>{session.progress === null ? 'Progress —' : `${session.progress}%`}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
        {session.progress !== null && <div className="h-full rounded-full bg-cyan-300" style={{ width: `${session.progress}%` }} />}
      </div>
    </article>
  )
}

function ForgeMap({ world }: { world: AgentWorldModel }) {
  return (
    <section aria-labelledby="forge-map-heading" className="agent-world-map relative overflow-hidden rounded-2xl border border-white/10 bg-[#091018] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.38)] sm:p-5">
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="forge-map-heading" className="text-lg font-semibold text-white">Live forge floor</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">Every workstation below is reported by a connected source. Missing connectors stay visible as missing data—not synthetic workers.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Activity aria-hidden="true" className="size-4 text-cyan-300" />
          {world.sessions.length} reported {world.sessions.length === 1 ? 'session' : 'sessions'}
        </div>
      </div>

      {world.sources.length ? (
        <div className="relative z-10 mt-5 grid gap-4 xl:grid-cols-2">
          {world.sources.map(source => {
            const sourceSessions = world.sessions.filter(session => session.sourceId === source.id)
            const SourceIcon = sourceIcons[source.kind]
            return (
              <section key={source.id} aria-labelledby={`source-${source.id}`} className="agent-world-zone rounded-2xl border border-white/10 bg-black/20 p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-amber-200/20 bg-amber-200/10 text-amber-100">
                      <SourceIcon aria-hidden="true" className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 id={`source-${source.id}`} className="truncate text-sm font-semibold text-white">{source.label}</h3>
                      <p className="truncate text-xs text-slate-500">{present(source.project)} · {present(source.workspace, 'Workspace not reported')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SourceBadge kind={source.kind} />
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <span aria-hidden="true" className={`size-2 rounded-full ${source.status === 'online' ? 'bg-emerald-300' : source.status === 'offline' ? 'bg-slate-600' : 'bg-amber-300'}`} />
                      {humanize(source.status)}
                    </span>
                  </div>
                </div>
                {sourceSessions.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {sourceSessions.map(session => <ForgeWorker key={session.id} session={session} />)}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                    No sessions reported by this source.
                  </div>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="relative z-10 mt-5 grid min-h-72 place-items-center rounded-2xl border border-dashed border-white/10 bg-black/20 p-8 text-center">
          <div>
            <Radio aria-hidden="true" className="mx-auto size-8 text-slate-600" />
            <h3 className="mt-3 font-semibold text-slate-200">No federation sources reported</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">The visualization is ready. Start the local agent team or connect a project adapter to populate the forge.</p>
          </div>
        </div>
      )}
    </section>
  )
}

function WorkflowGraph({ world }: { world: AgentWorldModel }) {
  const visibleTasks = world.tasks.filter(task => task.status !== 'done').slice(0, 8)
  return (
    <section aria-labelledby="workflow-graph-heading" className="rounded-2xl border border-white/10 bg-[#0c131c] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="workflow-graph-heading" className="text-base font-semibold text-white">Workflow topology</h2>
          <p className="mt-1 text-xs text-slate-500">{humanize(world.workflowMode ?? 'Mode not reported')} · {world.edges.length} derived connections</p>
        </div>
        <ListTree aria-hidden="true" className="size-5 text-violet-300" />
      </div>
      {visibleTasks.length ? (
        <ol className="mt-4 space-y-2">
          {visibleTasks.map(task => {
            const dependencies = world.edges.filter(edge => edge.kind === 'dependency' && edge.to === task.id)
            const assignment = world.edges.find(edge => edge.kind === 'assignment' && edge.to === task.id)
            return (
              <li key={task.id} className="relative rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-1 grid size-6 shrink-0 place-items-center rounded-md border border-violet-300/20 bg-violet-300/10 text-violet-200">
                    <CircleDot aria-hidden="true" className="size-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium text-slate-100">{task.title}</p>
                      <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${statusTone[task.status]}`}>{humanize(task.status)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      {dependencies.map(edge => (
                        <span key={edge.id} className="inline-flex items-center gap-1">
                          {edge.from}<ChevronRight aria-hidden="true" className="size-3 rtl:rotate-180" />
                        </span>
                      ))}
                      <span>{task.id}</span>
                      {assignment && <><ChevronRight aria-hidden="true" className="size-3 rtl:rotate-180" /><span>{assignment.from}</span></>}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      ) : <p className="mt-4 rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-500">No open task topology reported.</p>}
    </section>
  )
}

function EventStream({ world }: { world: AgentWorldModel }) {
  return (
    <section aria-labelledby="world-events-heading" className="rounded-2xl border border-white/10 bg-[#0c131c] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="world-events-heading" className="text-base font-semibold text-white">Signal log</h2>
          <p className="mt-1 text-xs text-slate-500">Latest team messages and connector events</p>
        </div>
        <Radio aria-hidden="true" className="size-5 text-cyan-300" />
      </div>
      {world.events.length ? (
        <ol className="mt-4 max-h-[28rem] space-y-3 overflow-y-auto pe-1">
          {world.events.slice(-10).reverse().map(event => (
            <li key={event.id} className="border-b border-white/5 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <strong className="truncate text-slate-300">{event.from}</strong>
                  <ChevronRight aria-hidden="true" className="size-3 shrink-0 rtl:rotate-180" />
                  <span className="truncate">{event.to}</span>
                </span>
                <time dateTime={event.timestamp ?? undefined} title={formatTimestamp(event.timestamp)}>{event.timestamp ? new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</time>
              </div>
              <p className="mt-1 break-words text-xs leading-5 text-slate-300">{event.text}</p>
            </li>
          ))}
        </ol>
      ) : <p className="mt-4 rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-500">No events reported.</p>}
    </section>
  )
}

function TaskCard({ task }: { task: AgentWorldTask }) {
  return (
    <article className="rounded-xl border border-white/10 bg-[#0d151f] p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-5 text-slate-100">{task.title}</h4>
        <span className="shrink-0 text-[10px] text-slate-500">{task.id}</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">{present(task.assignee ?? task.owner, 'Unassigned')} · {humanize(task.kind)}</p>
      {task.dependencies.length > 0 && <p className="mt-2 text-[11px] text-violet-200">After {task.dependencies.join(', ')}</p>}
    </article>
  )
}

function BoardView({ world }: { world: AgentWorldModel }) {
  return (
    <section aria-label="Agent World task board" className="grid gap-3 md:grid-cols-2 2xl:grid-cols-5">
      {BOARD_COLUMNS.map(status => {
        const tasks = world.tasks.filter(task => task.status === status)
        return (
          <section key={status} aria-labelledby={`world-board-${status}`} className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id={`world-board-${status}`} className="text-sm font-semibold text-slate-100">{humanize(status)}</h2>
              <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${statusTone[status]}`}>{tasks.length}</span>
            </div>
            <div className="space-y-2">
              {tasks.length ? tasks.map(task => <TaskCard key={task.id} task={task} />) : <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-slate-600">Empty</p>}
            </div>
          </section>
        )
      })}
    </section>
  )
}

function TableView({ world }: { world: AgentWorldModel }) {
  return (
    <section aria-labelledby="session-table-heading" className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c131c]">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 id="session-table-heading" className="font-semibold text-white">Session register</h2>
        <p className="mt-1 text-xs text-slate-500">A dense, non-spatial view of every reported session.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-start text-sm">
          <thead className="bg-black/20 text-xs text-slate-500">
            <tr>
              {['Session', 'Role', 'State', 'Source', 'Project / workspace', 'Provider / model', 'Current task', 'Progress'].map(label => <th key={label} scope="col" className="px-4 py-3 text-start font-medium">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {world.sessions.map(session => (
              <tr key={session.id} className="transition-colors hover:bg-white/[0.025]">
                <th scope="row" className="px-4 py-3 text-start font-medium text-white">{session.name}</th>
                <td className="px-4 py-3 text-slate-400">{humanize(session.role)}</td>
                <td className="px-4 py-3"><StateBadge state={session.state} /></td>
                <td className="px-4 py-3"><SourceBadge kind={session.sourceKind} /></td>
                <td className="px-4 py-3 text-slate-400">{present(session.project)}<br /><span className="text-xs text-slate-600">{present(session.workspace)}</span></td>
                <td className="px-4 py-3 text-slate-400">{present(session.provider)}<br /><span className="text-xs text-slate-600">{present(session.model)}</span></td>
                <td className="max-w-64 px-4 py-3 text-slate-300">{present(session.taskTitle, 'Idle / unreported')}</td>
                <td className="px-4 py-3 text-slate-300">{session.progress === null ? '—' : `${session.progress}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!world.sessions.length && <p className="p-8 text-center text-sm text-slate-500">No sessions reported.</p>}
      </div>
    </section>
  )
}

function Filters({
  world,
  filters,
  onChange,
}: {
  world: AgentWorldModel
  filters: AgentWorldFilters
  onChange: (next: AgentWorldFilters) => void
}) {
  const update = (key: keyof AgentWorldFilters, value: string) => onChange({ ...filters, [key]: value })
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Agent World filters">
      <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Filter aria-hidden="true" className="size-3.5" /> Filter</span>
      <select aria-label="Filter by project" value={filters.project} onChange={event => update('project', event.target.value)} className="min-h-9 rounded-lg border border-white/10 bg-[#0d151f] px-2 text-xs text-slate-200 outline-none focus:border-cyan-300">
        <option value="">All projects</option>
        {world.projects.map(project => <option key={project} value={project}>{project}</option>)}
      </select>
      <select aria-label="Filter by workspace" value={filters.workspace} onChange={event => update('workspace', event.target.value)} className="min-h-9 rounded-lg border border-white/10 bg-[#0d151f] px-2 text-xs text-slate-200 outline-none focus:border-cyan-300">
        <option value="">All workspaces</option>
        {world.workspaces.map(workspace => <option key={workspace} value={workspace}>{workspace}</option>)}
      </select>
      <select aria-label="Filter by source" value={filters.source} onChange={event => update('source', event.target.value)} className="min-h-9 rounded-lg border border-white/10 bg-[#0d151f] px-2 text-xs text-slate-200 outline-none focus:border-cyan-300">
        <option value="">All sources</option>
        {world.sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
      </select>
    </div>
  )
}

export default function AgentWorld({
  world,
  lastUpdatedAt,
}: {
  world: AgentWorldModel
  lastUpdatedAt: Date | null
}) {
  const [view, setView] = useState<ViewMode>('world')
  const [filters, setFilters] = useState<AgentWorldFilters>({ project: '', workspace: '', source: '' })
  const filtered = useMemo(() => filterAgentWorld(world, filters), [world, filters])
  const counts = agentWorldCounts(filtered)

  return (
    <div className="space-y-5">
      <div
        aria-hidden="true"
        className="hidden"
        dangerouslySetInnerHTML={{ __html: '<!-- THESIS: A living virtual forge reveals real orchestration without turning operations into a game. OWN-WORLD: Carbon steel fields, ember brass, cyan signal light, etched gridwork, and instrument-like controls. STORY: Operators locate sources, understand work and dependencies, then act through the preserved team controls. FIRST VIEWPORT: Live forge floor dominates; topology and signal log form a compact rail. FORM: Hybrid operations floor, selected as the primary direction from the user-confirmed command-center brief. -->' }}
      />

      <section aria-label="Agent World status" className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'Active', value: String(counts.active), detail: `${counts.sessions} sessions`, icon: Activity },
          { label: 'Open work', value: String(counts.openTasks), detail: `${counts.blocked} blocked`, icon: ListTree },
          { label: 'Sources', value: String(counts.sources), detail: 'federated adapters', icon: Radio },
          { label: 'Health', value: world.health === null ? '—' : `${world.health}%`, detail: world.running ? 'team running' : 'team stopped', icon: Cpu },
          { label: 'Phase', value: world.phase === null ? '—' : String(world.phase), detail: lastUpdatedAt ? `updated ${lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'not yet updated', icon: GitBranch },
        ].map(metric => (
          <div key={metric.label} className="flex items-center gap-3 bg-[#0c131c] px-4 py-3">
            <metric.icon aria-hidden="true" className="size-4 text-cyan-300" />
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
              <p className="mt-0.5 text-lg font-semibold text-white">{metric.value} <span className="text-xs font-normal text-slate-500">{metric.detail}</span></p>
            </div>
          </div>
        ))}
      </section>

      <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center">
        <Filters world={world} filters={filters} onChange={setFilters} />
        <div className="inline-flex w-fit rounded-lg border border-white/10 bg-black/20 p-1" role="group" aria-label="Agent World view">
          {([
            ['world', Map, 'World'],
            ['board', ListTree, 'Board'],
            ['table', TableProperties, 'Table'],
          ] as const).map(([value, Icon, label]) => (
            <button key={value} type="button" onClick={() => setView(value)} aria-pressed={view === value} className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${view === value ? 'bg-cyan-300 text-slate-950' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
              <Icon aria-hidden="true" className="size-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      {view === 'world' && (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <ForgeMap world={filtered} />
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1">
            <WorkflowGraph world={filtered} />
            <EventStream world={filtered} />
          </div>
        </div>
      )}
      {view === 'board' && <BoardView world={filtered} />}
      {view === 'table' && <TableView world={filtered} />}

      <details className="group rounded-xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-slate-400">
        <summary className="cursor-pointer list-none font-medium text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
          <span className="inline-flex items-center gap-2"><Users aria-hidden="true" className="size-4" /> About Agent World <ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90 rtl:rotate-180" /></span>
        </summary>
        <div className="mt-3 max-w-3xl space-y-3 border-t border-white/10 pt-3 text-xs leading-5">
          <p>Agent World is GhostForge’s original virtual-forge operations view. It renders only reported snapshot data and keeps a board/table path for serious operational use.</p>
          <p className="flex flex-wrap gap-x-4 gap-y-2">
            <span>Inspiration and attribution:</span>
            <a className="inline-flex items-center gap-1 text-cyan-300 underline-offset-4 hover:underline" href="https://taskville.co/#" target="_blank" rel="noreferrer">TaskVille <ExternalLink aria-hidden="true" className="size-3" /></a>
            <a className="inline-flex items-center gap-1 text-cyan-300 underline-offset-4 hover:underline" href="https://github.com/a16z-infra/ai-town" target="_blank" rel="noreferrer">a16z AI Town <ExternalLink aria-hidden="true" className="size-3" /></a>
            <a className="inline-flex items-center gap-1 text-cyan-300 underline-offset-4 hover:underline" href="https://github.com/harishkotra/agent-office" target="_blank" rel="noreferrer">Agent Office <ExternalLink aria-hidden="true" className="size-3" /></a>
          </p>
        </div>
      </details>
    </div>
  )
}
