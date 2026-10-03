'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import AgentOfficeMap from '../../components/agent-world/AgentOfficeMap'
import WorkflowDependencyGraph from '../../components/agent-world/WorkflowDependencyGraph'
import AgentOfficeControls from './AgentOfficeControls'
import AiTownControls from './AiTownControls'
import {
  collectAgentWorldData,
  loadAgentWorld,
  recordText,
  type AgentWorldData,
  type AgentWorldRecord,
} from './agent-world-model'
import AgentWorldSwitcher, { type AgentWorldView } from './AgentWorldSwitcher'
import ForgeWorldScene from './ForgeWorldScene'
import CliDashboard from './cli/CliDashboard'
import CliLanes from './cli/CliLanes'
import SessionDrawer from './cli/SessionDrawer'
import { useCliWorld, useNow } from './cli/api'
import { worldAgents, type WorldScope } from './cli/world-model'

const TownWorld = dynamic(() => import('./town/TownWorld'), {
  ssr: false,
  loading: () => <p role="status" className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">Loading Agent Town…</p>,
})

const OfficeWorld = dynamic(() => import('./office/OfficeWorld'), {
  ssr: false,
  loading: () => <p role="status" className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">Loading Agent Office…</p>,
})

type PageState =
  | { status: 'loading' }
  | { status: 'loaded'; data: AgentWorldData; officeSessions: AgentWorldRecord[]; mode: string; refreshing?: boolean; refreshError?: string }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string }
  | { status: 'redirecting' }

const POLL_INTERVAL_MS = 15_000

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
  // CLI sessions: a second, read-only picture of this machine's Claude Code and
  // Copilot sessions. They join every world as extra characters, marked `cli`.
  const cli = useCliWorld()
  const now = useNow()
  const [cliScope, setCliScope] = useState<WorldScope>('live')
  const [cliSelected, setCliSelected] = useState<string>()
  const cliCharacters = useMemo<AgentWorldRecord[]>(
    () => (cli.status === 'loaded' ? worldAgents(cli.world, cliScope) : []),
    [cli, cliScope],
  )
  // Worlds render this: the runtime view plus the CLI characters.
  // Worlds render this instead of state.data: the runtime view plus the CLI
  // characters. Built from state.data so it stays narrowed where it is rendered.
  const mergedData = state.status === 'loaded'
    ? { ...state.data, agents: [...state.data.agents, ...cliCharacters] }
    : { agents: [], tasks: [], connectors: [], sessions: [], events: [] }
  const controllerRef = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const { signal } = controller
    // Keep the last loaded snapshot visible while refreshing; only the first load shows the loading state.
    setState(prev => (prev.status === 'loaded' ? { ...prev, refreshing: true } : { status: 'loading' }))
    try {
      const result = await loadAgentWorld(
        (input, init) => fetch(input, { ...init, signal }),
        () => router.replace('/login?next=/agent-world'),
      )
      if (signal.aborted) return
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
      if (signal.aborted) return
      const message = error instanceof Error ? error.message : 'Unable to load Agent World.'
      setState(prev => (
        prev.status === 'loaded'
          ? { ...prev, refreshing: false, refreshError: message }
          : { status: 'error', message }
      ))
    }
  }, [router])

  useEffect(() => {
    void load()
    const tick = () => { if (document.visibilityState !== 'hidden') void load() }
    const timer = setInterval(tick, POLL_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      controllerRef.current?.abort()
    }
  }, [load])

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-gf-bg px-4 py-6 font-plex text-gf-ink lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">🌐 Agent World</h1>
            <p className="mt-1 text-sm text-gf-muted">Live operations from the available agent and connector snapshots.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={state.status === 'loading' || (state.status === 'loaded' && state.refreshing === true)} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">
            Refresh
          </button>
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <AgentWorldSwitcher onChange={changeWorld} />
          {cli.status === 'loaded' && world !== 'cli' && (
            <span className="flex items-center gap-1 text-xs text-gf-muted">
              CLI characters
              {(['live', 'today'] as const).map(scope => (
                <button key={scope} type="button" onClick={() => setCliScope(scope)} aria-pressed={cliScope === scope}
                  className="min-h-9 rounded-lg border border-gf-line2 px-2.5 text-xs font-semibold hover:border-gf-accent aria-pressed:border-gf-accent aria-pressed:bg-gf-accent-soft aria-pressed:text-gf-accent-ink">
                  {scope === 'live' ? 'Live' : 'Today'}
                </button>
              ))}
            </span>
          )}
        </div>

        {state.status === 'loading' && <p role="status" className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">Loading Agent World snapshot…</p>}
        {state.status === 'redirecting' && <p role="status" className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">Redirecting to sign in…</p>}
        {state.status === 'denied' && <p role="alert" className="rounded-xl border border-amber-900 bg-amber-950/60 p-4 text-sm text-amber-100">{state.message}</p>}
        {state.status === 'error' && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900 bg-red-950/60 p-4 text-sm text-red-100">
            <p>{state.message}</p>
            <button type="button" onClick={() => void load()} className="min-h-9 rounded-lg border border-red-700 px-3 font-semibold hover:bg-red-900/50">Retry</button>
          </div>
        )}
        {cli.status === 'error' && (
          <p role="alert" className="rounded-xl border border-red-900 bg-red-950/60 p-4 text-sm text-red-100">
            CLI sessions unavailable — {cli.message}
          </p>
        )}
        {state.status === 'loaded' && (
          <>
            <p role="status" className="text-xs text-gf-muted">Federated summary: {state.mode}{state.refreshing ? ' · Refreshing…' : ''}</p>
            {state.refreshError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900 bg-red-950/60 p-3 text-sm text-red-100">
                <p>Refresh failed — showing the last snapshot. {state.refreshError}</p>
                <button type="button" onClick={() => void load()} className="min-h-9 rounded-lg border border-red-700 px-3 font-semibold hover:bg-red-900/50">Retry</button>
              </div>
            )}
            {world === 'forge' && (
              <>
                <ForgeWorldScene agents={mergedData.agents} tasks={state.data.tasks} boss={state.data.boss} />
                <CliLanes world={cli.status === 'loaded' ? cli.world : undefined} now={now} onOpen={setCliSelected} />
                <SourceList connectors={state.data.connectors} />
              </>
            )}
            {world === 'town' && (
              <>
                <AiTownControls />
                <TownWorld data={mergedData} boss={state.data.boss} />
              </>
            )}
            {world === 'office' && (
              <>
                <AgentOfficeControls />
                <OfficeWorld data={mergedData} boss={state.data.boss} />
                <AgentOfficeMap sessions={state.officeSessions} emptyMessage="No sessions were reported by the available snapshots." />
              </>
            )}
            {world === 'cli' && cli.status === 'loaded' && (
              <CliDashboard world={cli.world} now={now} onOpen={setCliSelected} />
            )}
            {world === 'cli' && cli.status === 'loading' && (
              <p role="status" className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">
                Reading CLI sessions (the first load parses this week&apos;s transcripts)…
              </p>
            )}
            {world === 'cli' && cli.status === 'disabled' && (
              <p role="status" className="rounded-xl border border-gf-line bg-gf-surface p-4 text-sm text-gf-muted">
                CLI sessions are turned off for this server (GF_CLI_SESSIONS=0).
              </p>
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
      <SessionDrawer
        id={cliSelected}
        heartbeat={cli.status === 'loaded' ? cli.world.heartbeat : undefined}
        onClose={() => setCliSelected(undefined)}
      />
    </main>
  )
}
