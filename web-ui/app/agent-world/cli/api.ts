'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionDetail, World } from './types'

const ENDPOINT = '/api/agents/cli-sessions'
const REFRESH_MS = 10_000

export type CliWorldState =
  | { status: 'loading' }
  | { status: 'loaded'; world: World; error?: string }
  | { status: 'disabled' }
  | { status: 'error'; message: string }

/** Polls the CLI sessions snapshot while the page is visible. */
export function useCliWorld(): CliWorldState {
  const [state, setState] = useState<CliWorldState>({ status: 'loading' })
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const r = await fetch(ENDPOINT, { cache: 'no-store' })
      if (r.status === 404) {
        const body = await r.json().catch(() => ({}))
        if (body?.disabled) { setState({ status: 'disabled' }); return }
      }
      if (!r.ok) throw new Error(`CLI sessions request failed (${r.status})`)
      const world = await r.json() as World
      setState({ status: 'loaded', world })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to load CLI sessions.'
      // Keep showing the last snapshot when a refresh fails.
      setState(prev => prev.status === 'loaded' ? { ...prev, error: message } : { status: 'error', message })
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    void load()
    const tick = () => { if (document.visibilityState !== 'hidden') void load() }
    const timer = setInterval(tick, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  return state
}

/** One session's detail, reloaded whenever the world snapshot refreshes. */
export function useCliSessionDetail(id: string | undefined, heartbeat: string | undefined) {
  const [detail, setDetail] = useState<SessionDetail>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!id) { setDetail(undefined); return }
    let cancelled = false
    fetch(`${ENDPOINT}?session=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async r => {
        if (r.status === 404) throw new Error('This session is no longer in the snapshot.')
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json() as Promise<SessionDetail>
      })
      .then(d => { if (!cancelled) { setDetail(d); setError(undefined) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [id, heartbeat])

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
