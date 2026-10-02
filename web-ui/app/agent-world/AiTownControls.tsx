'use client'

import { useCallback, useEffect, useState } from 'react'

type EndpointStatus = {
  url: string
  ok: boolean
  httpStatus?: number
  error?: string
}

type AiTownStatus = {
  world: 'ai-town'
  status: 'running' | 'stopped' | 'unavailable'
  error?: string
  services?: string[]
  frontend?: EndpointStatus
  backend?: EndpointStatus
  dashboardUrl?: string | null
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

export default function AiTownControls() {
  const [status, setStatus] = useState<AiTownStatus | null>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (): Promise<AiTownStatus | null> => {
    try {
      const result = await readResponse(await fetch('/api/worlds/ai-town', { cache: 'no-store' }))
      if (result?.world !== 'ai-town' || typeof result.status !== 'string') {
        throw new Error('AI Town status response was invalid.')
      }
      const nextStatus = result as AiTownStatus
      setStatus(nextStatus)
      setError(nextStatus.status === 'unavailable' ? nextStatus.error || 'AI Town is unavailable.' : '')
      return nextStatus
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to read AI Town status.'
      setError(message)
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
      if (nextStatus?.status === 'unavailable') {
        setPending(null)
        return
      }
      if (Date.now() - startedAt >= ACTION_TIMEOUT_MS) {
        setError(`AI Town did not ${pending === 'start' ? 'start' : 'stop'} within two minutes. Check the local world logs and run status again.`)
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
      await readResponse(await fetch('/api/worlds/ai-town', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }))
      if (action === 'stop') {
        setPending(null)
        setOpen(false)
        await refresh()
      }
    } catch (cause) {
      setPending(null)
      setError(cause instanceof Error ? cause.message : `Could not ${action} AI Town.`)
    }
  }, [refresh])

  const isRunning = status?.status === 'running'
  return (
    <section aria-labelledby="ai-town-controls-title" className="rounded-2xl border border-gf-line bg-gf-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ai-town-controls-title" className="font-display text-lg font-semibold">AI Town</h2>
          <p role="status" className="mt-1 text-sm text-gf-muted">
            {pending ? `AI Town is ${pending === 'start' ? 'starting' : 'stopping'}…` : `Status: ${status?.status ?? 'checking'}`}
            {status?.frontend?.ok && ` · Frontend HTTP ${status.frontend.httpStatus}`}
            {status?.backend?.ok && ` · Convex HTTP ${status.backend.httpStatus}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void act('start')} disabled={Boolean(pending) || !status || status.status === 'unavailable' || isRunning} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">
            Start
          </button>
          <button type="button" onClick={() => void act('stop')} disabled={Boolean(pending) || !isRunning} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">
            Stop
          </button>
          <button type="button" onClick={() => setOpen(value => !value)} disabled={!isRunning} className="min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50">
            {open ? 'Close' : 'Open'}
          </button>
          {isRunning && status?.frontend?.url && (
            <a href={status.frontend.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent">
              Open in new tab
            </a>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-amber-900 bg-amber-950/60 p-3 text-sm text-amber-100">{error}</p>}
      {open && isRunning && status?.frontend?.url && (
        <iframe
          title="AI Town"
          src={status.frontend.url}
          sandbox="allow-forms allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="mt-4 h-[min(75dvh,800px)] w-full rounded-xl border border-gf-line bg-black"
        />
      )}
    </section>
  )
}
