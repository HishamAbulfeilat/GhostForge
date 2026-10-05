'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionDetail, World } from './types'

export type CliWorldState =
  | { status: 'loading' }
  | { status: 'loaded'; world: World; error?: string }
  | { status: 'disabled' }
  | { status: 'error'; message: string }

/**
 * Polls the CLI-session world snapshot at `endpoint` while the page is
 * visible. Keeps the last good snapshot when a refresh fails.
 */
export function useCliWorld(endpoint: string, { paused = false, refreshMs = 5000 } = {}): CliWorldState {
  const [state, setState] = useState<CliWorldState>({ status: 'loading' })
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const r = await fetch(endpoint, { cache: 'no-store' })
      if (r.status === 404) {
        const body = await r.json().catch(() => ({}))
        if (body?.disabled) { setState({ status: 'disabled' }); return }
      }
      if (!r.ok) throw new Error(`CLI sessions request failed (${r.status})`)
      const world = await r.json() as World
      setState({ status: 'loaded', world })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to load CLI sessions.'
      setState(prev => prev.status === 'loaded' ? { ...prev, error: message } : { status: 'error', message })
    } finally {
      inFlight.current = false
    }
  }, [endpoint])

  useEffect(() => {
    if (paused) return
    void load()
    const tick = () => { if (document.visibilityState !== 'hidden') void load() }
    const timer = setInterval(tick, refreshMs)
    return () => clearInterval(timer)
  }, [load, paused, refreshMs])

  return state
}

/** One session's detail from `url`, reloaded whenever the world snapshot refreshes. */
export function useCliSessionDetail(url: string | undefined, id: string | undefined, heartbeat: string | undefined) {
  const [detail, setDetail] = useState<SessionDetail>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!id || !url) { setDetail(undefined); return }
    let cancelled = false
    fetch(url, { cache: 'no-store' })
      .then(async r => {
        if (r.status === 404) throw new Error('This session is no longer in the snapshot.')
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json() as Promise<SessionDetail>
      })
      .then(d => { if (!cancelled) { setDetail(d); setError(undefined) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [url, id, heartbeat])

  return { detail: detail?.id === id ? detail : undefined, error }
}

/** Re-renders on an interval so relative times keep moving. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
