'use client'

import { useMemo, useState } from 'react'
import { activity, ago, compact, isClaude, modelShort, project, providerLabel, usd } from './format'
import type { Provider, Session, World } from './types'
import { Bars, Columns, Spark } from './charts'

type Filter = 'live' | 'today' | 'all'

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-gf-line bg-gf-surface px-4 py-3.5">
      <div className={`font-mono text-2xl font-semibold tracking-tight ${tone ?? ''}`}>{value}</div>
      <div className="mt-1 text-xs text-gf-muted">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-gf-muted">{sub}</div>}
    </div>
  )
}

function Panel({ title, aside, children, className = '' }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gf-line bg-gf-surface p-4 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gf-muted">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function SessionRow({ s, now, onOpen }: { s: Session; now: number; onOpen: (id: string) => void }) {
  const claude = isClaude(s.provider)
  return (
    <button
      type="button"
      onClick={() => onOpen(s.id)}
      className="grid w-full grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-gf-line px-4 py-2.5 text-start text-sm first:border-t-0 hover:bg-gf-raised md:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1fr)_5.5rem_4.5rem_4.5rem_4rem_5rem]"
    >
      <span className={`size-2 rounded-full ${s.health !== 'ok' ? 'bg-gf-danger' : s.status === 'working' ? 'animate-pulse bg-gf-ok' : s.status === 'active' ? 'bg-gf-warn' : 'bg-gf-muted/50'}`} />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${claude ? 'bg-orange-950 text-orange-300' : 'bg-gf-violet-soft text-gf-violet'}`}>{providerLabel(s.provider)}</span>
          <span className="truncate font-mono text-xs">{modelShort(s.model)}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-gf-muted">{activity(s)}</span>
      </span>
      <span className="min-w-0 truncate font-mono text-xs text-gf-muted" title={s.gitBranch}>{s.gitBranch ? `⎇ ${s.gitBranch}` : ''}</span>
      <Spark values={s.timeline} className="hidden h-4 w-full md:block" tone={claude ? '#FDBA74' : '#C4B5FD'} />
      <span className="hidden text-end font-mono text-xs md:block" title="tokens">{compact(s.tokens.total)}</span>
      <span className="hidden text-end font-mono text-xs md:block" title={claude ? 'cost' : 'premium units'}>{claude ? usd(s.costUSD) : s.aiu !== undefined ? `${s.aiu.toFixed(1)}u` : '—'}</span>
      <span className="hidden text-end font-mono text-xs md:block" title="tool calls">{s.toolCalls || '—'}</span>
      <span className="text-end font-mono text-xs text-gf-muted">{ago(s.updatedAt, now)}</span>
    </button>
  )
}

export default function CliDashboard({ world, now, onOpen }: { world: World; now: number; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('live')
  const [providers, setProviders] = useState<Set<Provider>>(new Set(['claude-code', 'copilot-cli']))
  const [q, setQ] = useState('')
  const { counts, totals } = world

  const groups = useMemo(() => {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    const needle = q.trim().toLowerCase()
    const list = world.sessions.filter(s =>
      providers.has(s.provider) &&
      (filter === 'all' || (filter === 'live' ? s.status !== 'idle' : Date.parse(s.updatedAt ?? '') >= midnight.getTime())) &&
      (!needle || [s.cwd, s.projectSlug, s.model, s.gitBranch, s.repository, s.id, s.topTool?.name].some(v => v?.toLowerCase().includes(needle))))
    const map = new Map<string, { name: string; path: string; items: Session[]; cost: number; tokens: number }>()
    for (const s of list) {
      const p = project(s)
      const g = map.get(p.path) ?? { ...p, items: [], cost: 0, tokens: 0 }
      g.items.push(s); g.cost += s.costUSD ?? 0; g.tokens += s.tokens.total
      map.set(p.path, g)
    }
    return [...map.values()]
  }, [world.sessions, filter, providers, q])

  const toggle = (p: Provider) => setProviders(prev => {
    const next = new Set(prev)
    if (next.has(p)) next.delete(p); else next.add(p)
    return next
  })

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="working now" value={counts.working} tone="text-gf-ok" sub={`${counts.active - counts.working} waiting for you`} />
        <Stat label="spent today" value={usd(totals.today.costUSD)} sub={totals.today.aiu ? `+ ${totals.today.aiu.toFixed(1)} Copilot units` : 'Claude Code sessions'} />
        <Stat label="tokens today" value={compact(totals.today.tokens)} sub="incl. cache reads" />
        <Stat label="tool calls today" value={compact(totals.today.toolCalls)} />
        <Stat label="errors today" value={totals.today.errors} sub={counts.unhealthy ? <span className="text-gf-danger">{counts.unhealthy} live session{counts.unhealthy === 1 ? '' : 's'} unhealthy</span> : 'tool + API'} tone={counts.unhealthy ? 'text-gf-danger' : undefined} />
        <Stat label="sessions this week" value={counts.sessions} sub={`${counts.claudeShown} Claude · ${counts.copilotShown} Copilot`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Activity · last 2 hours" aside={<span className="font-mono text-[11px] text-gf-muted">model replies + your turns</span>}>
          <Columns values={totals.timeline} bucketMinutes={totals.timelineBucketMinutes} />
        </Panel>
        <Panel title="Top tools this week">
          <Bars items={totals.topTools} format={compact} />
        </Panel>
      </div>

      <Panel title={`Active agents · ${world.agents.length}`}>
        {world.agents.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {world.agents.map(a => {
              const claude = isClaude(a.provider)
              return (
                <div key={a.id} className="relative overflow-hidden rounded-lg border border-gf-line bg-gf-bar p-3">
                  <span className={`absolute inset-y-0 start-0 w-1 ${claude ? 'bg-orange-400' : 'bg-gf-violet'}`} />
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${a.working ? 'animate-pulse bg-gf-ok' : 'bg-gf-warn'}`} />
                    <span className="truncate font-mono text-sm font-semibold">{a.model ? modelShort(a.model) : claude ? 'model not reported' : 'Copilot CLI'}</span>
                    <span className={`ms-auto rounded-full px-2 font-mono text-xs font-semibold ${claude ? 'bg-orange-950 text-orange-300' : 'bg-gf-violet-soft text-gf-violet'}`}>{a.sessions}</span>
                  </div>
                  <div className="mt-1.5 truncate text-xs text-gf-muted">{providerLabel(a.provider)} · {a.working} working · {a.projects.slice(0, 3).join(', ')}{a.projects.length > 3 ? ` +${a.projects.length - 3}` : ''}</div>
                  <div className="mt-2 flex gap-3 font-mono text-[11px] text-gf-muted">
                    <span>{compact(a.tokens)} tok</span>{claude && <span>{usd(a.costUSD)}</span>}<span>{a.toolCalls} tools</span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : <p className="rounded-lg border border-dashed border-gf-line p-4 text-center text-sm text-gf-muted">No agent has written anything in the last 15 minutes.</p>}
      </Panel>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="me-auto text-xs font-semibold uppercase tracking-wider text-gf-muted">Sessions</h2>
          {(['live', 'today', 'all'] as const).map(f => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}
              className="rounded-lg border border-gf-line bg-gf-surface px-3 py-1 text-sm hover:border-gf-accent aria-pressed:border-gf-accent aria-pressed:bg-gf-accent-soft aria-pressed:text-gf-accent-ink">
              {f === 'live' ? 'Live' : f === 'today' ? 'Today' : 'This week'}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-gf-line" />
          {(['claude-code', 'copilot-cli'] as const).map(p => (
            <button key={p} aria-pressed={providers.has(p)} onClick={() => toggle(p)}
              className="rounded-lg border border-gf-line bg-gf-surface px-3 py-1 text-sm hover:border-gf-accent aria-pressed:border-gf-accent aria-pressed:bg-gf-accent-soft aria-pressed:text-gf-accent-ink">
              {providerLabel(p)}
            </button>
          ))}
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by folder, model, branch, tool"
            className="w-full rounded-lg border border-gf-line bg-gf-surface px-3 py-1 text-sm sm:w-64" />
        </div>

        {groups.length ? groups.map(g => (
          <div key={g.path} className="mb-3 overflow-hidden rounded-xl border border-gf-line bg-gf-surface">
            <div className="flex items-baseline gap-3 border-b border-gf-line px-4 py-2.5">
              <span className="font-semibold">{g.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-gf-muted" title={g.path}>{g.path}</span>
              <span className="shrink-0 font-mono text-xs text-gf-muted">{g.items.length} · {compact(g.tokens)} tok{g.cost ? ` · ${usd(g.cost)}` : ''}</span>
            </div>
            <div className="hidden grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1fr)_5.5rem_4.5rem_4.5rem_4rem_5rem] gap-x-3 px-4 pt-2 text-[10px] uppercase tracking-wider text-gf-muted md:grid">
              <span className="size-2" /><span>session</span><span>branch</span><span>2h</span><span className="text-end">tokens</span><span className="text-end">cost</span><span className="text-end">tools</span><span className="text-end">last</span>
            </div>
            {g.items.map(s => <SessionRow key={s.id} s={s} now={now} onOpen={onOpen} />)}
          </div>
        )) : (
          <p className="rounded-xl border border-dashed border-gf-line bg-gf-surface p-6 text-center text-sm text-gf-muted">
            {filter === 'live' ? 'No live sessions match. Try “Today” or “This week”.' : 'No sessions match.'}
          </p>
        )}
      </section>
    </div>
  )
}
