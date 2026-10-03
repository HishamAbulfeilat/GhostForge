'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Scanner = { id: string; label: string; description: string; installed: boolean; installHint: string }

type ScanResult =
  | { id: string; status: 'not_installed'; installHint: string }
  | { id: string; status: 'ok' | 'findings' | 'error' | 'timeout'; exitCode: number | null; durationMs: number; output: string; truncated: boolean }

const STATUS_TEXT: Record<ScanResult['status'], string> = {
  ok: 'Completed with no issues reported',
  findings: 'Completed — review the findings below',
  error: 'Scan failed',
  timeout: 'Scan timed out',
  not_installed: 'Not installed',
}

export default function SecurityScanPage() {
  const router = useRouter()
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'failed'>('loading')
  const [scanners, setScanners] = useState<Scanner[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/security-scan')
      if (response.status === 401) {
        router.replace('/login?from=/security')
        return
      }
      if (response.status === 403) {
        setState('forbidden')
        return
      }
      if (!response.ok) throw new Error(`Unable to load scanners (${response.status}).`)
      const data = await response.json() as { scanners?: Scanner[] }
      setScanners(data.scanners ?? [])
      setState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load scanners.')
      setState('failed')
    }
  }, [router])

  useEffect(() => { void load() }, [load])

  const run = async (scanner: Scanner) => {
    if (running) return
    setRunning(scanner.id)
    setResult(null)
    setError('')
    try {
      const response = await fetch('/api/security-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanner: scanner.id }),
      })
      const data = await response.json() as ScanResult & { error?: string }
      if (!response.ok) setError(data.error || `Scan request failed (${response.status}).`)
      else setResult(data)
    } catch {
      setError('Could not reach the scan service.')
    } finally {
      setRunning(null)
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#030712] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-white/40">Admin · defensive only</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Security scan</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/60">
            Run defensive scanners on this GhostForge repository: dependency advisories, committed secrets and static analysis.
            Scans run on the server with fixed arguments; output is truncated and secrets are redacted. Use on code you own only.
          </p>
        </header>

        {state === 'loading' && <p role="status" className="rounded-xl border border-white/10 bg-[#0b1220] p-4 text-sm text-white/60">Loading scanners…</p>}
        {state === 'forbidden' && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">Security scans are available to administrators only.</p>}
        {state === 'failed' && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}

        {state === 'ready' && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {scanners.map(scanner => (
                <section key={scanner.id} aria-labelledby={`scanner-${scanner.id}`} className="flex flex-col rounded-2xl border border-white/10 bg-[#0b1220] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 id={`scanner-${scanner.id}`} className="text-lg font-semibold">{scanner.label}</h2>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${scanner.installed ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/10 text-white/50'}`}>
                      {scanner.installed ? 'Installed' : 'Not installed'}
                    </span>
                  </div>
                  <p className="mt-2 flex-1 text-sm text-white/60">{scanner.description}</p>
                  {!scanner.installed && <p className="mt-2 text-xs text-white/40">{scanner.installHint}</p>}
                  <button
                    type="button"
                    onClick={() => run(scanner)}
                    disabled={!scanner.installed || Boolean(running)}
                    className="mt-4 self-start rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {running === scanner.id ? 'Scanning…' : 'Run scan'}
                  </button>
                </section>
              ))}
            </div>

            {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}

            {result && (
              <section role="status" aria-live="polite" className="rounded-2xl border border-white/10 bg-[#0b1220] p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold">{scanners.find(s => s.id === result.id)?.label ?? result.id}</h2>
                  <p className="text-sm text-white/60">
                    {STATUS_TEXT[result.status]}
                    {result.status !== 'not_installed' && ` · ${(result.durationMs / 1000).toFixed(1)}s`}
                  </p>
                </div>
                {result.status === 'not_installed' ? (
                  <p className="mt-3 text-sm text-white/60">{result.installHint}</p>
                ) : (
                  <pre dir="ltr" className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 text-start font-mono text-xs leading-5 text-white/80">{result.output}</pre>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
