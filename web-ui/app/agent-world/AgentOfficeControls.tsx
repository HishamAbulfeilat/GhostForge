'use client'

import { useCallback, useEffect, useState } from 'react'

type ServiceStatus = {
  service: string
  port: number
  state: 'running' | 'starting' | 'port-in-use' | 'stopped'
  httpStatus?: number | null
}

type AgentOfficeStatus = {
  world: 'agent-office'
  installed: boolean
  status: 'running' | 'starting' | 'stopped'
  url: string | null
  services: ServiceStatus[]
}

type Action = 'start' | 'stop'

const ACTION_TIMEOUT_MS = 120_000

async function readResponse(response: Response) {
  const result = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    throw new Error(typeof result?.error === 'string' ? result.error : `Request failed (${response.status}).`)
  }
  return result
}

// Start/Stop/Open for the upstream harishkotra/agent-office app run by
// `ghostforge worlds` on 127.0.0.1 (see docs/AGENT-OFFICE.md).
export default function AgentOfficeControls() {
  const [status, setStatus] = useState<AgentOfficeStatus | null>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (): Promise<AgentOfficeStatus | null> => {
    try {
      const result = await readResponse(await fetch('/api/worlds/agent-office', { cache: 'no-store' }))
      if (result?.world !== 'agent-office' || typeof result.status !== 'string' || !Array.isArray(result.services)) {
        throw new Error('Agent Office status response was invalid.')
      }
      const nextStatus = result as AgentOfficeStatus
      setStatus(nextStatus)
      setError(nextStatus.installed ? '' : 'Agent Office is not set up. Run: ghostforge worlds setup agent-office')
      return nextStatus
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read Agent Office status.')
      return null
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!pending) return
    let active = true
    const startedAt = Date.now()
    const interval = setInterval(async () => {
      const nextStatus = await refresh()
      if (!active) return
      if (nextStatus?.status === (pending === 'start' ? 'running' : 'stopped')) {
        setPending(null)
        return
      }
      if (Date.now() - startedAt >= ACTION_TIMEOUT_MS) {
        setError(`Agent Office did not ${pending} within two minutes. Run: ghostforge worlds status agent-office`)
        setPending(null)
      }
    }, 2_000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [pending, refresh])

  const act = useCallback(async (action: Action) => {
    setPending(action)
    setError('')
    try {
      await readResponse(await fetch('/api/worlds/agent-office', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }))
      if (action === 'stop') setOpen(false)
    } catch (cause) {
      setPending(null)
      setError(cause instanceof Error ? cause.message : `Could not ${action} Agent Office.`)
    }
  }, [])

  const isRunning = status?.status === 'running'
  const hasProcesses = status?.status === 'running' || status?.status === 'starting'
  const portSummary = status?.services
    .map(service => `${service.service} :${service.port} ${service.httpStatus ? `HTTP ${service.httpStatus}` : service.state}`)
    .join(' · ')
  return (
    <section aria-labelledby="agent-office-controls-title" className="rounded-2xl border border-gf-line bg-gf-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="agent-office-controls-title" className="font-display text-lg font-semibold">Agent Office app</h2>
          <p role="status" className="mt-1 text-sm text-gf-muted">
            {pending ? `Agent Office is ${pending === 'start' ? 'starting' : 'stopping'}…` : `Status: ${status?.status ?? 'checking'}`}
            {portSummary && ` · ${portSummary}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void act('start')} disabled={Boolean(pending) || !status?.installed || isRunning} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">
            Start
          </button>
          <button type="button" onClick={() => void act('stop')} disabled={Boolean(pending) || !hasProcesses} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">
            Stop
          </button>
          <button type="button" onClick={() => setOpen(value => !value)} disabled={!isRunning} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">
            {open ? 'Close' : 'Open'}
          </button>
          {isRunning && status?.url && (
            <a href={status.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent">
              Open in new tab
            </a>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-amber-900 bg-amber-950/60 p-3 text-sm text-amber-100">{error}</p>}
      {open && isRunning && status?.url && (
        <iframe
          title="Agent Office"
          src={status.url}
          sandbox="allow-forms allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="mt-4 h-[min(75dvh,800px)] w-full rounded-xl border border-gf-line bg-black"
        />
      )}
    </section>
  )
}
