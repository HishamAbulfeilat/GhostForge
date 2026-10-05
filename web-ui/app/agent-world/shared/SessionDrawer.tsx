'use client'

import { useEffect } from 'react'
import { useCliSessionDetail } from './api'
import ContextMeter from './ContextMeter'
import { activity, ago, compact, duration, healthLabel, isClaude, modelShort, project, providerLabel, usd } from './format'
import type { SessionDetail, SessionEvent } from './types'
import { Bars, Spark } from './charts'
import RawJson from './RawJson'

const EVENT_TONE: Record<SessionEvent['type'], string> = {
  tool: 'text-gf-muted', subagent: 'text-gf-violet', prompt: 'text-gf-ink', error: 'text-gf-danger', request: 'text-gf-muted', compaction: 'text-gf-warn',
}

function Field({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-gf-muted">{label}</dt>
      <dd className={`m-0 mt-0.5 break-words text-sm ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-gf-line py-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gf-muted">{title}</h3>
      {children}
    </section>
  )
}

function Usage({ d }: { d: SessionDetail }) {
  const t = d.tokens
  const parts = [
    { name: 'input', count: t.input }, { name: 'output', count: t.output },
    { name: 'cache read', count: t.cacheRead }, { name: 'cache write', count: t.cacheWrite },
  ]
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={isClaude(d.provider) ? 'Cost' : 'Premium units'} value={isClaude(d.provider) ? usd(d.costUSD) : d.aiu !== undefined ? `${d.aiu.toFixed(2)} AIU` : '—'} />
        <Field label="Tokens" value={compact(t.total)} />
        <Field label={isClaude(d.provider) ? 'Your turns' : 'Turns'} value={d.prompts} />
        <Field label="Model replies" value={d.messages} />
        {isClaude(d.provider) && <Field label="Lines changed" value={d.linesAdded !== undefined ? <><span className="text-gf-ok">+{d.linesAdded}</span> <span className="text-gf-danger">−{d.linesRemoved}</span></> : '—'} />}
        <Field label="API time" value={duration(d.apiMs)} />
        {d.toolMs !== undefined && <Field label="Tool time" value={duration(d.toolMs)} />}
        {!!d.reasoningTokens && <Field label="Reasoning" value={compact(d.reasoningTokens)} />}
      </dl>
      <div className="mt-4"><Bars items={parts} tone="#38BDF8" format={compact} /></div>
      {Object.keys(d.modelUsage).length > 0 && (
        <table className="mt-4 w-full text-xs">
          <thead className="text-gf-muted"><tr><th className="pb-1 text-start font-normal">Model</th><th className="pb-1 text-end font-normal">Out</th><th className="pb-1 text-end font-normal">Cache read</th><th className="pb-1 text-end font-normal">Cost</th></tr></thead>
          <tbody className="font-mono">
            {Object.entries(d.modelUsage).sort((a, b) => b[1].costUSD - a[1].costUSD).map(([m, u]) => (
              <tr key={m} className="border-t border-gf-line"><td className="py-1">{modelShort(m)}</td><td className="text-end">{compact(u.output)}</td><td className="text-end">{compact(u.cacheRead)}</td><td className="text-end">{usd(u.costUSD)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {Object.keys(d.modelUsage).length === 0 && Object.keys(d.models).length > 0 && (
        <p className="mt-3 text-xs text-gf-muted">Models: {Object.entries(d.models).map(([m, n]) => `${modelShort(m)} ×${n}`).join(', ')}</p>
      )}
    </>
  )
}

/**
 * Details for one CLI session. `detailUrl` builds the app's detail endpoint;
 * the raw JSON panel shows that response exactly as returned.
 */
export default function SessionDrawer({
  id, heartbeat, onClose, detailUrl, compacting = false,
}: {
  id?: string
  heartbeat?: string
  onClose: () => void
  detailUrl: (id: string) => string
  compacting?: boolean
}) {
  const url = id ? detailUrl(id) : undefined
  const { detail: d, error } = useCliSessionDetail(url, id, heartbeat)

  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, onClose])

  if (!id) return null
  const p = d ? project(d) : undefined
  const errorEntries = d ? Object.entries(d.apiErrors) : []

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label="Session details"
        className="fixed inset-y-0 end-0 z-50 flex w-full max-w-xl flex-col border-s border-gf-line bg-gf-bar shadow-2xl">
        <header className="flex items-start gap-3 border-b border-gf-line p-5">
          <div className="min-w-0 flex-1">
            {d ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${isClaude(d.provider) ? 'bg-orange-500/15 text-orange-500' : 'bg-gf-violet-soft text-gf-violet'}`}>{providerLabel(d.provider)}</span>
                  <span className="font-mono text-xs">{modelShort(d.model)}</span>
                  <StatusPill status={d.status} health={d.health} />
                </div>
                <h2 className="mt-2 truncate text-xl font-semibold">{p?.name}</h2>
                <p className="mt-0.5 text-sm text-gf-muted">{activity(d)}</p>
              </>
            ) : <p className="text-sm text-gf-muted">{error ?? 'Loading session…'}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg border border-gf-line px-2.5 py-1 text-sm hover:border-gf-accent" aria-label="Close details">Esc</button>
        </header>

        {d && (
          <div className="flex-1 overflow-y-auto px-5 pb-8">
            <Section title="Where">
              <dl className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Field label="Folder" value={p?.path} mono /></div>
                <Field label="Branch" value={d.gitBranch} mono />
                {d.repository ? <Field label="Repository" value={d.repository} mono /> : <Field label="Client" value={[d.entrypoint, d.version && `v${d.version}`].filter(Boolean).join(' · ') || undefined} />}
                <Field label="Started" value={d.createdAt ? `${new Date(d.createdAt).toLocaleString()} (${ago(d.createdAt)})` : undefined} />
                <Field label="Last activity" value={ago(d.updatedAt)} />
                <Field label="Running for" value={duration(Date.parse(d.updatedAt ?? '') - Date.parse(d.createdAt ?? ''))} />
                <div className="col-span-2"><Field label="Session id" value={d.id} mono /></div>
              </dl>
            </Section>

            <Section title="Activity · last 2 hours">
              <Spark values={d.timeline} className="h-12 w-full" label="session activity, 5-minute buckets" />
            </Section>

            <Section title="Context window">
              <ContextMeter context={d.context} compacting={compacting} size="md" />
            </Section>

            <Section title="Usage"><Usage d={d} /></Section>

            <Section title={`Tools · ${d.toolCalls} calls`}>
              <Bars items={d.tools.slice(0, 12)} />
              {d.lastTool && <p className="mt-3 text-xs text-gf-muted">Last: <span className="font-mono text-gf-ink">{d.lastTool.name}</span> {ago(d.lastTool.ts)}</p>}
            </Section>

            <Section title={`Subagents · ${d.subagents}`}>
              {d.subagentList.length ? (
                <ul className="grid list-none gap-1 p-0 text-xs">
                  {d.subagentList.map(s => (
                    <li key={s.id} className="flex items-center gap-2 rounded border border-gf-line px-2 py-1.5">
                      <span className="font-mono font-semibold">{s.type}</span>
                      {s.background && <span className="rounded bg-gf-raised px-1 text-[10px] text-gf-muted">background</span>}
                      {s.depth > 1 && <span className="text-[10px] text-gf-muted">depth {s.depth}</span>}
                      <span className="ms-auto font-mono text-gf-muted">{ago(s.updatedAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-gf-muted">{d.subagents ? `${d.subagents} subagent calls (no per-agent records kept).` : 'No subagents spawned.'}</p>}
            </Section>

            <Section title="Errors & health">
              <dl className="grid grid-cols-3 gap-3">
                <Field label="Health" value={healthLabel[d.health]} />
                <Field label="Tool errors" value={d.toolErrors} />
                <Field label="API errors" value={errorEntries.reduce((a, [, n]) => a + n, 0)} />
              </dl>
              {errorEntries.length > 0 && (
                <p className="mt-3 font-mono text-xs text-gf-muted">{errorEntries.map(([s, n]) => `${s === '429' ? '429 rate limit' : s} ×${n}`).join(' · ')}</p>
              )}
              {d.lastError && <p className="mt-2 text-xs text-gf-muted">Last error: {d.lastError.kind === 'tool' ? 'a tool call failed' : `API ${d.lastError.status}`} {ago(d.lastError.ts)}</p>}
              {!!d.contentFiltered && <p className="mt-2 text-xs text-gf-muted">Content filter triggered {d.contentFiltered}×</p>}
            </Section>

            <Section title="Recent events">
              {d.events.length ? (
                <ol className="grid list-none gap-1 p-0">
                  {d.events.map((e, i) => (
                    <li key={i} className="grid grid-cols-[5rem_5rem_minmax(0,1fr)] gap-2 text-xs">
                      <span className="font-mono text-gf-muted">{ago(e.ts)}</span>
                      <span className={`font-mono ${EVENT_TONE[e.type]}`}>{e.type}</span>
                      <span className="truncate font-mono">{e.name}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-xs text-gf-muted">No events recorded.</p>}
              <p className="mt-3 text-[11px] text-gf-muted">Metadata only: tool names and counts, never prompts, arguments or output.</p>
            </Section>

            <RawJson value={d} source={url ?? ''} />
          </div>
        )}
      </aside>
    </>
  )
}

export function StatusPill({ status, health }: { status: string; health: string }) {
  if (health !== 'ok') return <span className="rounded-full bg-gf-danger/15 px-2 py-0.5 text-[11px] font-semibold text-gf-danger">{healthLabel[health as keyof typeof healthLabel]}</span>
  const tone = status === 'working' ? 'bg-gf-ok/15 text-gf-ok' : status === 'active' ? 'bg-gf-warn/15 text-gf-warn' : 'bg-gf-raised text-gf-muted'
  const label = status === 'working' ? 'working' : status === 'active' ? 'waiting' : 'idle'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>
}
