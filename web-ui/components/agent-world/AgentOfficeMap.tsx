'use client'

import { useEffect, useState } from 'react'
import type { AgentWorldRecord } from '../../app/agent-world/agent-world-model'

type AgentOfficeMapProps = {
  sessions: AgentWorldRecord[]
  emptyMessage: string
}

type SessionZone = {
  source: string
  role: string
  sessions: AgentWorldRecord[]
}

function reportedText(record: AgentWorldRecord, fields: string[]): string | null {
  for (const field of fields) {
    const value = record[field]
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value).trim()
    }
  }
  return null
}

function sessionStatus(session: AgentWorldRecord): string {
  const reportedStatus = reportedText(session, ['status', 'state'])
  if (session.stale === true || reportedStatus?.toLowerCase() === 'stale') return 'Stale'
  return reportedStatus ?? 'Status unknown'
}

function sessionName(session: AgentWorldRecord): string {
  return reportedText(session, ['name', 'id', 'sessionId']) ?? 'Session identity not reported'
}

function groupSessions(sessions: AgentWorldRecord[]): SessionZone[] {
  const zones = new Map<string, SessionZone>()
  for (const session of sessions) {
    const source = reportedText(session, ['source']) ?? 'Unknown source'
    const role = reportedText(session, ['role']) ?? 'Role not reported'
    const key = `${source}\u0000${role}`
    const zone = zones.get(key) ?? { source, role, sessions: [] }
    zone.sessions.push(session)
    zones.set(key, zone)
  }
  return [...zones.values()]
}

function SessionList({ sessions, emptyMessage }: AgentOfficeMapProps) {
  return sessions.length ? (
    <ul className="mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
      {sessions.map((session, index) => (
        <li key={`${reportedText(session, ['id', 'sessionId']) ?? 'session'}-${index}`} className="min-w-0 rounded-xl border border-gf-line/80 bg-gf-bar/60 p-3">
          <h3 className="break-words text-sm font-semibold">{sessionName(session)}</h3>
          <p className="mt-1 break-words text-xs text-gf-muted">
            {[
              `Source: ${reportedText(session, ['source']) ?? 'Unknown source'}`,
              `Role: ${reportedText(session, ['role']) ?? 'Role not reported'}`,
              `Status: ${sessionStatus(session)}`,
              `Task: ${reportedText(session, ['task', 'taskTitle']) ?? 'Task not reported'}`,
              reportedText(session, ['project']) && `Project: ${reportedText(session, ['project'])}`,
              reportedText(session, ['device']) && `Device: ${reportedText(session, ['device'])}`,
              reportedText(session, ['provider']) && `Provider: ${reportedText(session, ['provider'])}`,
            ].filter(Boolean).join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  ) : (
    <p className="mt-3 rounded-xl border border-dashed border-gf-line2 p-4 text-sm text-gf-muted">
      {emptyMessage}
    </p>
  )
}

function OfficeView({ sessions, emptyMessage }: AgentOfficeMapProps) {
  const zones = groupSessions(sessions)
  if (!zones.length) {
    return (
      <p className="mt-3 rounded-xl border border-dashed border-gf-line2 p-4 text-sm text-gf-muted">
        {emptyMessage}
      </p>
    )
  }

  return (
    <div role="group" aria-label="Agent office source and role zones" className="mt-3 grid gap-4 lg:grid-cols-2">
      {zones.map(zone => (
        <section
          key={`${zone.source}\u0000${zone.role}`}
          aria-label={`${zone.source} — ${zone.role}`}
          className="min-w-0 rounded-2xl border border-gf-line bg-gf-bar/60 p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-sm font-semibold">{zone.source}</h3>
            <span className="rounded-full border border-gf-line2 px-2 py-1 text-xs text-gf-muted">{zone.role}</span>
          </div>
          <div role="list" aria-label={`${zone.source} ${zone.role} sessions`} className="mt-3 grid gap-3 sm:grid-cols-2">
            {zone.sessions.map((session, index) => {
              const name = sessionName(session)
              const status = sessionStatus(session)
              const task = reportedText(session, ['task', 'taskTitle']) ?? 'Task not reported'
              return (
                <figure
                  key={`${reportedText(session, ['id', 'sessionId']) ?? 'session'}-${index}`}
                  role="listitem"
                  aria-label={`${name}; ${zone.source}; ${zone.role}; ${status}; ${task}`}
                  className="min-w-0 rounded-xl border border-gf-line/80 bg-gf-surface p-3"
                >
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full border border-gf-line2 bg-gf-bar text-sm font-bold text-gf-accent">
                      {name.slice(0, 1).toUpperCase()}
                    </span>
                    <figcaption className="min-w-0 break-words text-sm font-semibold">{name}</figcaption>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <dt className="text-gf-muted">Status</dt>
                      <dd className="m-0 rounded-full border border-gf-line2 px-2 py-1">{status}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-gf-muted">Task</dt>
                      <dd className="m-0 mt-1 break-words">{task}</dd>
                    </div>
                  </dl>
                </figure>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export default function AgentOfficeMap({ sessions, emptyMessage }: AgentOfficeMapProps) {
  const [view, setView] = useState<'office' | 'list'>('office')
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setPrefersReducedMotion(query.matches)
    updatePreference()
    query.addEventListener('change', updatePreference)
    return () => query.removeEventListener('change', updatePreference)
  }, [])

  const visibleView = prefersReducedMotion ? 'list' : view

  return (
    <section aria-labelledby="agent-world-office-heading" className="min-w-0 rounded-2xl border border-gf-line bg-gf-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="agent-world-office-heading" className="font-display text-lg font-semibold">Agent office</h2>
          <p className="mt-1 text-xs text-gf-muted">A snapshot-only view of reported sessions; status and task are not inferred from agent activity.</p>
        </div>
        <div role="group" aria-label="Session view" className="inline-flex rounded-lg border border-gf-line2 p-1">
          <button
            type="button"
            aria-pressed={visibleView === 'office'}
            disabled={prefersReducedMotion}
            onClick={() => setView('office')}
            className="min-h-9 rounded-md px-3 text-sm font-semibold hover:bg-gf-bar disabled:cursor-not-allowed disabled:opacity-50"
          >
            Office
          </button>
          <button
            type="button"
            aria-pressed={visibleView === 'list'}
            onClick={() => setView('list')}
            className="min-h-9 rounded-md px-3 text-sm font-semibold hover:bg-gf-bar"
          >
            List
          </button>
        </div>
      </div>
      {prefersReducedMotion && (
        <p role="status" className="mt-3 text-xs text-gf-muted">
          Reduced motion is enabled; showing the accessible session list.
        </p>
      )}
      {visibleView === 'office'
        ? <OfficeView sessions={sessions} emptyMessage={emptyMessage} />
        : <SessionList sessions={sessions} emptyMessage={emptyMessage} />}
      <p className="mt-4 border-t border-gf-line pt-3 text-xs text-gf-muted">
        Workspace inspiration:{' '}
        <a className="text-gf-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-gf-accent" href="https://www.gather.town/" target="_blank" rel="noreferrer">
          Gather
        </a>
        {' · '}
        <a className="text-gf-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-gf-accent" href="https://workadventu.re/" target="_blank" rel="noreferrer">
          WorkAdventure
        </a>
      </p>
    </section>
  )
}
