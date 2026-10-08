'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionDetail, World } from './types'

export type CliWorldState =
  | { status: 'loading' }
  | { status: 'loaded'; world: World; error?: string }
  | { status: 'disabled' }
  | { status: 'error'; message: string }

/** How long to wait before trying the push stream again after it failed. */
const STREAM_RETRY_MS = 30_000

/**
 * The CLI-session world snapshot at `endpoint`. With `streamUrl` (Server-Sent
 * Events) changes are pushed as they happen; polling every `refreshMs` stays
 * on as the fallback and only fetches when the stream has been quiet for
 * longer than that (not connected, failed or not supported). Both stop while
 * the page is hidden and catch up as soon as it is visible again. Keeps the
 * last good snapshot when a refresh fails.
 */
export function useCliWorld(endpoint: string, { paused = false, refreshMs = 5000, streamUrl }: { paused?: boolean; refreshMs?: number; streamUrl?: string } = {}): CliWorldState {
  const [state, setState] = useState<CliWorldState>({ status: 'loading' })
  const inFlight = useRef(false)
  // When the stream last delivered anything (0 = never / not connected).
  const lastPush = useRef(0)

  const accept = useCallback((world: World) => {
    setState({ status: 'loaded', world })
  }, [])

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
      accept(await r.json() as World)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to load CLI sessions.'
      setState(prev => prev.status === 'loaded' ? { ...prev, error: message } : { status: 'error', message })
    } finally {
      inFlight.current = false
    }
  }, [endpoint, accept])

  useEffect(() => {
    if (paused) return
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    const closeStream = () => {
      clearTimeout(retry)
      source?.close()
      source = null
      lastPush.current = 0
    }
    const openStream = () => {
      if (!streamUrl || typeof EventSource === 'undefined' || source || document.visibilityState === 'hidden') return
      const es = new EventSource(streamUrl)
      source = es
      es.addEventListener('world', event => {
        lastPush.current = Date.now()
        try { accept(JSON.parse((event as MessageEvent).data) as World) } catch { /* ignore a bad frame */ }
      })
      es.addEventListener('heartbeat', event => {
        lastPush.current = Date.now()
        let heartbeat: string | undefined
        try { heartbeat = JSON.parse((event as MessageEvent).data)?.heartbeat } catch { /* ignore a bad frame */ }
        if (heartbeat) setState(prev => prev.status === 'loaded' ? { ...prev, world: { ...prev.world, heartbeat }, error: undefined } : prev)
      })
      es.onerror = () => {
        // CONNECTING = the browser retries by itself; CLOSED = refused (auth,
        // 503, not an event stream): poll and try the stream again later.
        if (es.readyState !== EventSource.CLOSED) return
        closeStream()
        retry = setTimeout(openStream, STREAM_RETRY_MS)
      }
    }

    void load()
    openStream()
    const tick = () => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - lastPush.current < refreshMs * 1.5) return // the stream is live
      void load()
    }
    const timer = setInterval(tick, refreshMs)
    // Back on the tab: refresh now instead of showing a stale world for up to
    // refreshMs, and reopen the stream; hidden tabs hold no stream open.
    const onVisible = () => {
      if (document.visibilityState === 'visible') { void load(); openStream() } else closeStream()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      closeStream()
    }
  }, [load, accept, paused, refreshMs, streamUrl])

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
