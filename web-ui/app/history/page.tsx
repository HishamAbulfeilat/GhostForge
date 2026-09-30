'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

interface HistoryMessage {
  role: 'user' | 'ai'
  content: string
  ts: number
}

interface HistorySession {
  id: string
  startedAt: string
  endedAt: string
  messages: HistoryMessage[]
}

// Hoisted module-scope formatters: Intl.DateTimeFormat is expensive to
// construct, so build each once and reuse it across calls/renders.
const dateTimeFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const timeFormatter = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
})

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value))
}

function formatTime(value: number) {
  return timeFormatter.format(new Date(value))
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<HistorySession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    const loadHistory = async () => {
      try {
        setLoading(true)
        setError('')
        const response = await fetch('/api/jarvis/history', { cache: 'no-store' })
        if (!response.ok) throw new Error('Failed to load history')
        const data = await response.json() as { sessions?: HistorySession[] }
        setSessions(Array.isArray(data.sessions) ? data.sessions : [])
      } catch {
        setError('Unable to load saved JARVIS sessions right now.')
      } finally {
        setLoading(false)
      }
    }

    void loadHistory()
  }, [])

  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      const loweredQuery = query.trim().toLowerCase()
      const matchesQuery = loweredQuery.length === 0 || session.messages.some(message => message.content.toLowerCase().includes(loweredQuery))
      const sessionDate = session.startedAt.slice(0, 10)
      const matchesFrom = !fromDate || sessionDate >= fromDate
      const matchesTo = !toDate || sessionDate <= toDate
      return matchesQuery && matchesFrom && matchesTo
    })
  }, [fromDate, query, sessions, toDate])

  const handleDelete = async (id: string) => {
    try {
      setDeletingId(id)
      const response = await fetch(`/api/jarvis/history?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to delete session')
      setSessions(current => current.filter(session => session.id !== id))
      setExpandedId(current => current === id ? null : current)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-slate-950 px-4 py-10 text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <div className="flex flex-col gap-4 border border-cyan-500/10 bg-zinc-900/70 p-6 shadow-[0_0_40px_rgba(34,211,238,0.08)] backdrop-blur xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-400/70">Archive Node</p>
            <div>
              <h1 className="text-3xl font-semibold text-white sm:text-4xl">JARVIS Memory Timeline</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                Replay saved conversations, inspect message trails, and jump back into JARVIS with one command loaded.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 self-start xl:self-auto">
            <Link href="/jarvis" className="rounded-full border border-cyan-400/30 px-4 py-2 text-xs font-medium uppercase tracking-[0.25em] text-cyan-300 transition hover:border-cyan-300 hover:text-white">
              Return to JARVIS
            </Link>
          </div>
        </div>

        <section className="grid gap-4 rounded-3xl border border-white/5 bg-zinc-900/60 p-5 shadow-2xl backdrop-blur lg:grid-cols-[minmax(0,2fr)_180px_180px]">
          <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
            Search memory
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Find phrases, tasks, or replies"
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm tracking-normal text-white outline-none transition focus:border-cyan-400/60"
            />
          </label>
          <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
            From
            <input
              type="date"
              value={fromDate}
              onChange={event => setFromDate(event.target.value)}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm tracking-normal text-white outline-none transition focus:border-cyan-400/60"
            />
          </label>
          <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
            To
            <input
              type="date"
              value={toDate}
              onChange={event => setToDate(event.target.value)}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm tracking-normal text-white outline-none transition focus:border-cyan-400/60"
            />
          </label>
        </section>

        <section className="relative ps-6">
          <div className="pointer-events-none absolute inset-y-0 start-1.5 w-px bg-gradient-to-b from-cyan-400/50 via-cyan-400/10 to-transparent" />
          <div className="space-y-5">
            {loading && <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 text-sm text-zinc-400">Loading timeline…</div>}
            {!loading && error && <div className="rounded-3xl border border-red-500/20 bg-red-950/20 p-6 text-sm text-red-200">{error}</div>}
            {!loading && !error && filteredSessions.length === 0 && (
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 text-sm text-zinc-400">
                No sessions match the current filters.
              </div>
            )}

            {filteredSessions.map(session => {
              const expanded = expandedId === session.id
              const latestUserMessage = [...session.messages].reverse().find(message => message.role === 'user')?.content ?? session.messages.at(-1)?.content ?? 'Continue our last conversation'

              return (
                <article key={session.id} className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/75 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur">
                  <div className="absolute inset-y-0 start-0 w-1 bg-gradient-to-b from-cyan-400 via-blue-500 to-fuchsia-500" />
                  <div className="absolute start-[-1.7rem] top-7 h-3 w-3 rounded-full border border-cyan-300/70 bg-zinc-950 shadow-[0_0_20px_rgba(34,211,238,0.6)]" />
                  <div className="flex flex-col gap-4 p-5 sm:p-6">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-[0.25em] text-cyan-400/70">{formatDateTime(session.startedAt)}</p>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
                          <span>{session.messages.length} messages</span>
                          <span className="text-zinc-700">•</span>
                          <span>Closed {formatDateTime(session.endedAt)}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/jarvis?prefill=${encodeURIComponent(latestUserMessage)}`}
                          className="rounded-full border border-cyan-400/30 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-cyan-300 transition hover:border-cyan-300 hover:text-white"
                        >
                          Open in JARVIS
                        </Link>
                        <button
                          type="button"
                          onClick={() => setExpandedId(current => current === session.id ? null : session.id)}
                          className="rounded-full border border-zinc-700 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                        >
                          {expanded ? 'Hide messages' : 'Show messages'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(session.id)}
                          disabled={deletingId === session.id}
                          className="rounded-full border border-red-500/30 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-red-200 transition hover:border-red-400 hover:text-white disabled:cursor-wait disabled:opacity-60"
                        >
                          {deletingId === session.id ? 'Deleting…' : 'Delete session'}
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="grid gap-3 border-t border-zinc-800 pt-4">
                        {session.messages.map((message, index) => (
                          <div
                            key={`${session.id}-${message.ts}-${index}`}
                            className={`rounded-2xl border px-4 py-3 ${message.role === 'user' ? 'ms-6 border-cyan-400/20 bg-cyan-500/5' : 'me-6 border-zinc-800 bg-zinc-950/80'}`}
                          >
                            <div className="mb-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                              <span>{message.role === 'user' ? 'Operator' : 'JARVIS'}</span>
                              <span>{formatTime(message.ts)}</span>
                            </div>
                            <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-200">{message.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
