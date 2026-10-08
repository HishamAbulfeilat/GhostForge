/**
 * Tiny keyed stale-while-revalidate cache.
 *
 * get(key, load) returns the cached value at once; when it is older than
 * `ttlMs` a background refresh starts (one per key at a time). With
 * `force`, or on a miss, it waits for a fresh load. Concurrent loads of the
 * same key share one promise.
 */
export interface SwrResult<T> {
  value: T
  fetchedAt: number
  cached: boolean
}

export function createSwrCache<T>(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, { value: T; fetchedAt: number }>()
  const inFlight = new Map<string, Promise<{ value: T; fetchedAt: number }>>()

  function refresh(key: string, load: () => Promise<T>) {
    const running = inFlight.get(key)
    if (running) return running
    const next = load()
      .then(value => {
        const entry = { value, fetchedAt: now() }
        entries.set(key, entry)
        return entry
      })
      .finally(() => { inFlight.delete(key) })
    inFlight.set(key, next)
    return next
  }

  return {
    async get(key: string, load: () => Promise<T>, force = false): Promise<SwrResult<T>> {
      const hit = entries.get(key)
      if (hit && !force) {
        if (now() - hit.fetchedAt > ttlMs) void refresh(key, load).catch(() => { /* keep serving the old copy */ })
        return { ...hit, cached: true }
      }
      return { ...(await refresh(key, load)), cached: false }
    },
    clear() {
      entries.clear()
      inFlight.clear()
    },
  }
}
