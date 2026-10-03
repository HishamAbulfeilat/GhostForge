'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Command = { id: string; label: string; description: string; available: boolean }

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

export default function CodeHealthPage() {
  const router = useRouter()
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'failed'>('loading')
  const [commands, setCommands] = useState<Command[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, RunResult>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/code-health')
      if (response.status === 401) {
        router.replace('/login?from=/code-health')
        return
      }
      if (response.status === 403) {
        setState('forbidden')
        return
      }
      if (!response.ok) throw new Error(`Unable to load code-health scripts (${response.status}).`)
      const data = await response.json() as { commands?: Command[] }
      setCommands(data.commands ?? [])
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load code-health scripts.')
      setState('failed')
    }
  }, [router])

  useEffect(() => { void load() }, [load])

  const run = async (command: Command) => {
    if (running) return
    setRunning(command.id)
    setError('')
    try {
      const response = await fetch('/api/code-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: command.id }),
      })
      const data = await response.json() as RunResult & { error?: string }
      if (!response.ok) setError(data.error || `Code-health run request failed (${response.status}).`)
      else {
        setResults(prev => ({ ...prev, [command.id]: data }))
        setSelected(command.id)
      }
    } catch {
      setError('Could not reach the code-health service.')
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
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Code health</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/60">
            Run the performance, bundle-size, unused-code and dependency-health scripts on the server. Scripts are fixed, run with a timeout,
            and their output is capped and secret-redacted.
          </p>
        </header>

        {state === 'loading' && <p role="status" className="rounded-xl border border-white/10 bg-[#0b1220] p-4 text-sm text-white/60">Loading code-health scripts…</p>}
        {state === 'forbidden' && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">Code-health runs are available to administrators only.</p>}
        {state === 'failed' && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}

        {state === 'ready' && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {commands.map(command => {
                const last = results[command.id]
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
                    {!command.available && <p className="mt-2 text-xs text-white/40">Not available: the repository script was not found on this server.</p>}
                    <button
                      type="button"
                      onClick={() => run(command)}
                      disabled={!command.available || Boolean(running)}
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
              <section role="status" aria-live="polite" aria-label="Code-health run result" className="rounded-2xl border border-white/10 bg-[#0b1220] p-5">
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
