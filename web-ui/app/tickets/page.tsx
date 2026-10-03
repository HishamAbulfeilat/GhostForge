'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Command = { id: string; label: string; description: string; input: 'ticket-id' | 'description' | null; available: boolean }

type RunResult =
  | { id: string; status: 'unavailable' }
  | { id: string; status: 'pass' | 'fail' | 'error' | 'timeout'; exitCode: number | null; durationMs: number; output: string; truncated: boolean }

const STATUS_TEXT: Record<RunResult['status'], string> = {
  pass: 'Passed',
  fail: 'Failed',
  error: 'Run error',
  timeout: 'Timed out',
  unavailable: 'Not available',
}

const STATUS_STYLE: Record<RunResult['status'], string> = {
  pass: 'bg-emerald-500/15 text-emerald-200',
  fail: 'bg-red-500/15 text-red-200',
  error: 'bg-red-500/15 text-red-200',
  timeout: 'bg-amber-500/15 text-amber-100',
  unavailable: 'bg-white/10 text-white/50',
}

const INPUT_LABEL = { 'ticket-id': 'Ticket id (e.g. PROJ-123)', description: 'Task description' } as const

export default function TicketsPage() {
  const router = useRouter()
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'failed'>('loading')
  const [commands, setCommands] = useState<Command[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, RunResult>>({})
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/tickets')
      if (response.status === 401) {
        router.replace('/login?from=/tickets')
        return
      }
      if (response.status === 403) {
        setState('forbidden')
        return
      }
      if (!response.ok) throw new Error(`Unable to load ticket commands (${response.status}).`)
      const data = await response.json() as { commands?: Command[] }
      setCommands(data.commands ?? [])
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load ticket commands.')
      setState('failed')
    }
  }, [router])

  useEffect(() => { void load() }, [load])

  const run = async (command: Command) => {
    if (running) return
    setRunning(command.id)
    setError('')
    try {
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.input ? { command: command.id, input: inputs[command.id] ?? '' } : { command: command.id }),
      })
      const data = await response.json() as RunResult & { error?: string }
      if (!response.ok) setError(data.error || `Ticket command request failed (${response.status}).`)
      else {
        setResults(prev => ({ ...prev, [command.id]: data }))
        setSelected(command.id)
      }
    } catch {
      setError('Could not reach the tickets service.')
    } finally {
      setRunning(null)
    }
  }

  const shown = selected ? results[selected] : null

  return (
    <main className="min-h-[100dvh] bg-[#030712] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-white/40">Admin · fixed scripts only</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Tickets &amp; estimates</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/60">
            Scaffold a ticket, view Azure DevOps work items and pipeline runs (read only), and estimate story points. Scripts are fixed,
            run with a timeout, and their output is capped and secret-redacted.
          </p>
        </header>

        {state === 'loading' && <p role="status" className="rounded-xl border border-white/10 bg-[#0b1220] p-4 text-sm text-white/60">Loading ticket commands…</p>}
        {state === 'forbidden' && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">Ticket commands are available to administrators only.</p>}
        {state === 'failed' && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}

        {state === 'ready' && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {commands.map(command => {
                const last = results[command.id]
                const value = inputs[command.id] ?? ''
                return (
                  <section key={command.id} aria-labelledby={`command-${command.id}`} className="flex flex-col rounded-2xl border border-white/10 bg-[#0b1220] p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 id={`command-${command.id}`} className="text-lg font-semibold">{command.label}</h2>
                      {last && (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[last.status]}`}>
                          {STATUS_TEXT[last.status]}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 flex-1 text-sm text-white/60">{command.description}</p>
                    {command.input && (
                      <label className="mt-3 block text-xs text-white/60">
                        {INPUT_LABEL[command.input]}
                        <input
                          type="text"
                          dir="ltr"
                          value={value}
                          maxLength={command.input === 'ticket-id' ? 25 : 500}
                          onChange={event => setInputs(prev => ({ ...prev, [command.id]: event.target.value }))}
                          className="mt-1 block w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-400"
                        />
                      </label>
                    )}
                    {!command.available && <p className="mt-2 text-xs text-white/40">Not available: the repository script was not found on this server.</p>}
                    <button
                      type="button"
                      onClick={() => run(command)}
                      disabled={!command.available || Boolean(running) || (Boolean(command.input) && !value.trim())}
                      aria-label={`Run ${command.label}`}
                      className="mt-4 self-start rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {running === command.id ? 'Running…' : 'Run'}
                    </button>
                  </section>
                )
              })}
            </div>

            {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}

            {shown && (
              <section role="status" aria-live="polite" aria-label="Ticket command result" className="rounded-2xl border border-white/10 bg-[#0b1220] p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold">{commands.find(c => c.id === shown.id)?.label ?? shown.id}</h2>
                  <p className="text-sm text-white/60">
                    {STATUS_TEXT[shown.status]}
                    {shown.status !== 'unavailable' && ` · exit ${shown.exitCode ?? 'n/a'} · ${(shown.durationMs / 1000).toFixed(1)}s`}
                  </p>
                </div>
                {shown.status !== 'unavailable' && (
                  <pre dir="ltr" tabIndex={0} aria-label="Script output" className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 text-start font-mono text-xs leading-5 text-white/80">{shown.output}</pre>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
