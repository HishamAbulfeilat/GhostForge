// Server-Sent Events for the world snapshot, shared by the external Agent World
// server (/api/world/stream) and GhostForge's /api/agents/cli-sessions?stream=1.
//
// One hub per server. While at least one client is connected it watches the
// collector's source folders (debounced) and also rebuilds on an interval,
// because a session's status moves from working to done by time alone. A
// client gets the snapshot when it connects, then a `world` event only when
// the snapshot changed (snapshotKey) and a small `heartbeat` event otherwise.
// When the last client goes, the watchers and the timer stop.
import fs from 'node:fs'
import { snapshotKey } from '../snapshot-key.mjs'

export const STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  // no-transform keeps compression middleware from buffering the stream.
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
  'x-content-type-options': 'nosniff',
}

/** One SSE message. */
export function sseEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Watches folders for changes; returns a function that stops every watcher.
 * Missing folders are skipped. Recursive watching needs Node 20+ on Linux.
 * @param {{ dir: string, recursive?: boolean }[]} roots
 */
export function watchRoots(roots, onChange, watchImpl = fs.watch) {
  const watchers = []
  for (const { dir, recursive = false } of roots ?? []) {
    try {
      if (!fs.existsSync(dir)) continue
      const w = watchImpl(dir, { recursive, persistent: false }, () => onChange())
      w.on?.('error', () => { try { w.close() } catch { /* already closed */ } })
      watchers.push(w)
    } catch { /* unsupported here: the interval still refreshes */ }
  }
  return () => { for (const w of watchers.splice(0)) { try { w.close() } catch { /* already closed */ } } }
}

/**
 * @param {{
 *   build: () => Promise<any>,
 *   roots?: { dir: string, recursive?: boolean }[],
 *   intervalMs?: number, debounceMs?: number, maxClients?: number, maxStreamMs?: number,
 *   watch?: typeof watchRoots,
 * }} options
 */
export function createSnapshotHub({
  build, roots = [], intervalMs = 5000, debounceMs = 300, maxClients = 16, maxStreamMs = 10 * 60_000, watch = watchRoots,
}) {
  /** @type {Set<{ send: (chunk: string) => void, close: () => void, timer: any }>} */
  const clients = new Set()
  let latest = null
  let latestKey = ''
  let stopWatch = null
  let interval = null
  let debounce = null
  let building = null

  const broadcast = chunk => {
    for (const c of [...clients]) {
      try { c.send(chunk) } catch { drop(c) }
    }
  }

  function refresh() {
    building ??= Promise.resolve().then(build).then(world => {
      const key = snapshotKey(world)
      const changed = key !== latestKey
      latest = world
      latestKey = key
      broadcast(changed ? sseEvent('world', world) : sseEvent('heartbeat', { heartbeat: world?.heartbeat }))
    }, error => {
      broadcast(sseEvent('collector-error', { error: error instanceof Error ? error.message : String(error) }))
    }).finally(() => { building = null })
    return building
  }

  function start() {
    stopWatch = watch(roots, () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => { void refresh() }, debounceMs)
    })
    interval = setInterval(() => { void refresh() }, intervalMs)
    interval.unref?.()
  }

  function stop() {
    stopWatch?.()
    stopWatch = null
    clearInterval(interval)
    clearTimeout(debounce)
    interval = debounce = null
  }

  function drop(c) {
    if (!clients.delete(c)) return
    clearTimeout(c.timer)
    if (!clients.size) stop()
  }

  return {
    get size() { return clients.size },
    get full() { return clients.size >= maxClients },
    /**
     * Adds a client. `send` writes one chunk; `close` ends its response (called
     * when the stream reaches maxStreamMs, so the browser reconnects and the
     * request is authorised again). Returns unsubscribe, or null when full.
     */
    subscribe(send, close = () => {}) {
      if (clients.size >= maxClients) return null
      const c = { send, close, timer: null }
      c.timer = setTimeout(() => { drop(c); try { close() } catch { /* already closed */ } }, maxStreamMs)
      c.timer.unref?.()
      clients.add(c)
      if (clients.size === 1) start()
      try {
        send('retry: 5000\n\n')
        if (latest) send(sseEvent('world', latest))
      } catch { drop(c); return null }
      // A first client, or a cached snapshot that may be old: rebuild now.
      void refresh()
      return () => drop(c)
    },
  }
}
