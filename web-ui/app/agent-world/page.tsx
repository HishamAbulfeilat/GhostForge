'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import AgentOfficeMap from '../../components/agent-world/AgentOfficeMap'
import WorkflowDependencyGraph from '../../components/agent-world/WorkflowDependencyGraph'
import {
  collectAgentWorldData,
  loadAgentWorld,
  recordText,
  type AgentWorldData,
  type AgentWorldRecord,
} from './agent-world-model'
import AgentWorldSwitcher, { type AgentWorldView } from './AgentWorldSwitcher'
import ForgeWorldScene from './ForgeWorldScene'

const TownWorld = dynamic(() => import('./town/TownWorld'), {
  ssr: false,
  loading: () => <p role="status" className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">Loading Agent Town…</p>,
})

type PageState =
  | { status: 'loading' }
  | { status: 'loaded'; data: AgentWorldData; officeSessions: AgentWorldRecord[]; mode: string }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string }
  | { status: 'redirecting' }

function timestamp(record: AgentWorldRecord): string {
  const value = record.heartbeat ?? record.ts ?? record.timestamp
  if (typeof value !== 'string' && typeof value !== 'number') return 'Time unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function recordList(value: unknown): AgentWorldRecord[] {
  return Array.isArray(value)
    ? value.filter((record): record is AgentWorldRecord => (
      record !== null && typeof record === 'object' && !Array.isArray(record)
    ))
    : []
}

function officeSessions(snapshot: AgentWorldRecord, connectorSummary?: AgentWorldRecord): AgentWorldRecord[] {
  const runtimeSessions = recordList(snapshot.sessions).map(session => ({
    ...session,
    source: typeof session.source === 'string' && session.source.trim()
      ? session.source
      : 'GhostForge runtime',
  }))
  const connectors = recordList(connectorSummary?.connectors)
  const federatedSessions = connectors.flatMap(connector => recordList(connector.sessions).map(session => ({
    ...session,
    source: typeof session.source === 'string' && session.source.trim()
      ? session.source
      : typeof connector.id === 'string' && connector.id.trim()
        ? connector.id
        : 'Unknown source',
    stale: session.stale === true || connector.stale === true || connector.status === 'stale',
  })))
  return [...runtimeSessions, ...federatedSessions]
}

function DataList({
  title,
  records,
  empty,
  fields,
}: {
  title: string
  records: AgentWorldRecord[]
  empty: string
  fields: string[]
}) {
  return (
    <section aria-labelledby={`agent-world-${title.toLowerCase().replaceAll(' ', '-')}`} className="min-w-0 rounded-2xl border border-gf-line bg-gf-surface p-4">
      <h2 id={`agent-world-${title.toLowerCase().replaceAll(' ', '-')}`} className="font-display text-lg font-semibold">
        {title} <span className="text-sm font-normal text-gf-muted">({records.length})</span>
      </h2>
      {records.length ? (
        <ul className="mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {records.map((record, index) => {
            const name = record.id ?? record.name ?? record.title ?? record.type ?? `${title.slice(0, -1)} ${index + 1}`
            return (
              <li key={`${String(name)}-${index}`} className="min-w-0 rounded-xl border border-gf-line/80 bg-gf-bar/60 p-3">
                <h3 className="break-words text-sm font-semibold">{String(name)}</h3>
                <p className="mt-1 break-words text-xs text-gf-muted">{recordText(record, fields).join(' · ') || 'No additional details reported.'}</p>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-gf-line2 p-4 text-sm text-gf-muted">{empty}</p>
      )}
    </section>
  )
}

function SourceList({ connectors }: { connectors: AgentWorldRecord[] }) {
  return (
    <section aria-labelledby="agent-world-sources" className="rounded-2xl border border-gf-line bg-gf-surface p-4">
      <h2 id="agent-world-sources" className="font-display text-lg font-semibold">
        Connector sources <span className="text-sm font-normal text-gf-muted">({connectors.length})</span>
      </h2>
      {connectors.length ? (
        <ul className="mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {connectors.map((connector, index) => {
            const status = typeof connector.status === 'string' ? connector.status : 'unknown'
            const isUnavailable = status === 'offline' || status === 'stale' || connector.stale === true
            const statusStyle = isUnavailable
              ? 'bg-amber-950 text-amber-200'
              : status === 'online'
                ? 'bg-emerald-950 text-emerald-200'
                : 'bg-slate-800 text-slate-200'
            return (
              <li key={`${String(connector.id ?? index)}`} className="min-w-0 rounded-xl border border-gf-line/80 bg-gf-bar/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="break-words text-sm font-semibold">{String(connector.id ?? 'Unnamed source')}</h3>
                  <span className={`rounded-full px-2 py-1 text-xs ${statusStyle}`}>
                    {status}
                  </span>
                </div>
                <p className="mt-2 break-words text-xs text-gf-muted">
                  {recordText(connector, ['source', 'project', 'device', 'provider']).join(' · ') || 'No source details reported.'}
                </p>
                <p className="mt-1 text-xs text-gf-muted">Heartbeat: {timestamp(connector)}</p>
                {typeof connector.error === 'string' && connector.error && (
                  <p role="status" className="mt-2 break-words rounded-lg border border-amber-900 bg-amber-950/60 p-2 text-xs text-amber-100">
                    {connector.error}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-gf-line2 p-4 text-sm text-gf-muted">
          No connector sources were reported by the agents API.
        </p>
      )}
    </section>
  )
}

export default function AgentWorldPage() {
  const router = useRouter()
  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [world, setWorld] = useState<AgentWorldView>('forge')

  const changeWorld = useCallback((view: AgentWorldView) => setWorld(view), [])
  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const result = await loadAgentWorld(fetch, () => router.replace('/login?next=/agent-world'))
      if (result.status === 'loaded') {
        setState({
          status: 'loaded',
          data: collectAgentWorldData(result.snapshot, result.connectorSummary),
          officeSessions: officeSessions(result.snapshot, result.connectorSummary),
          mode: typeof result.connectorSummary?.mode === 'string' ? result.connectorSummary.mode : 'summary unavailable',
        })
      } else if (result.status === 'denied') {
        setState(result)
      } else {
        setState({ status: 'redirecting' })
      }
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to load Agent World.',
      })
    }
  }, [router])

  useEffect(() => { void load() }, [load])

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-gf-bg px-4 py-6 font-plex text-gf-ink lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">🌐 Agent World</h1>
            <p className="mt-1 text-sm text-gf-muted">Live operations from the available agent and connector snapshots.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={state.status === 'loading'} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">
            Refresh
          </button>
        </header>
        <AgentWorldSwitcher onChange={changeWorld} />

        {state.status === 'loading' && <p role="status" className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">Loading Agent World snapshot…</p>}
        {state.status === 'redirecting' && <p role="status" className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">Redirecting to sign in…</p>}
        {state.status === 'denied' && <p role="alert" className="rounded-xl border border-amber-900 bg-amber-950/60 p-4 text-sm text-amber-100">{state.message}</p>}
        {state.status === 'error' && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900 bg-red-950/60 p-4 text-sm text-red-100">
            <p>{state.message}</p>
            <button type="button" onClick={() => void load()} className="min-h-9 rounded-lg border border-red-700 px-3 font-semibold hover:bg-red-900/50">Retry</button>
          </div>
        )}
        {state.status === 'loaded' && (
          <>
            <p role="status" className="text-xs text-gf-muted">Federated summary: {state.mode}</p>
            {world === 'forge' && (
              <>
                <ForgeWorldScene agents={state.data.agents} tasks={state.data.tasks} boss={state.data.boss} />
                <SourceList connectors={state.data.connectors} />
              </>
            )}
            {world === 'town' && <TownWorld data={state.data} boss={state.data.boss} />}
            {world === 'office' && (
              <AgentOfficeMap sessions={state.officeSessions} emptyMessage="No sessions were reported by the available snapshots." />
            )}
            {world === 'maintainer' && (
              <>
                <SourceList connectors={state.data.connectors} />
                <DataList title="Events" records={state.data.events} empty="No events were reported by the available snapshots." fields={['source', 'from', 'to', 'status', 'error', 'text']} />
              </>
            )}
            {world === 'team' && (
              <>
                {state.data.boss && (
                  <DataList title="Boss" records={[{ ...state.data.boss, id: state.data.boss.id ?? 'boss' }]} empty="No boss details were reported." fields={['source', 'provider', 'state', 'role', 'model', 'task']} />
                )}
                <DataList title="Agents" records={state.data.agents} empty="No agents were reported by the available snapshots." fields={['source', 'provider', 'state', 'role', 'model', 'task']} />
                <WorkflowDependencyGraph tasks={state.data.tasks} />
                <DataList title="Tasks" records={state.data.tasks} empty="No tasks were reported by the available snapshots." fields={['source', 'status', 'kind', 'owner', 'assignee', 'description']} />
                <DataList title="Events" records={state.data.events} empty="No events were reported by the available snapshots." fields={['source', 'from', 'to', 'status', 'error', 'text']} />
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}
