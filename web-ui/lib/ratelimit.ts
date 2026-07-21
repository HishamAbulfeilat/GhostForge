/**
 * In-memory rate limiter for GhostForge API routes
 * Sliding window: max N requests per window (default 30/min)
 */

interface RateWindow {
  timestamps: number[]
  blocked: boolean
}

const store = new Map<string, RateWindow>()

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, window] of store.entries()) {
    window.timestamps = window.timestamps.filter(t => now - t < 60_000)
    if (window.timestamps.length === 0) store.delete(key)
  }
}, 5 * 60_000)

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetIn: number  // ms until oldest request falls off
  limit: number
}

/**
 * Check rate limit for a given key (IP address)
 * @param key - usually the client IP
 * @param limit - max requests per window (default 30)
 * @param windowMs - window size in ms (default 60000 = 1 min)
 */
export function checkRateLimit(
  key: string,
  limit = 30,
  windowMs = 60_000,
): RateLimitResult {
  const now = Date.now()

  if (!store.has(key)) {
    store.set(key, { timestamps: [], blocked: false })
  }

  const win = store.get(key)!

  // Slide the window
  win.timestamps = win.timestamps.filter(t => now - t < windowMs)

  const remaining = Math.max(0, limit - win.timestamps.length)
  const resetIn = win.timestamps.length > 0
    ? windowMs - (now - win.timestamps[0])
    : 0

  if (win.timestamps.length >= limit) {
    return { allowed: false, remaining: 0, resetIn, limit }
  }

  win.timestamps.push(now)
  return { allowed: true, remaining: remaining - 1, resetIn, limit }
}

/** Extract client IP from Next.js request */
export function getClientIP(req: { headers: { get(k: string): string | null } }): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    'local'
  )
}
