import { isHostedMode } from './hosted'
/**
 * In-memory rate limiter for GhostForge API routes
 * Sliding window: max N requests per window (default 30/min)
 */

interface RateWindow {
  timestamps: number[]
  blocked: boolean
}

const store = new Map<string, RateWindow>()

// Cleanup old entries every 5 minutes. unref() so this timer never keeps the
// Node process (or the `node --test` runner) alive on its own.
const cleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, window] of store.entries()) {
    window.timestamps = window.timestamps.filter(t => now - t < 60_000)
    if (window.timestamps.length === 0) store.delete(key)
  }
}, 5 * 60_000)
cleanupInterval.unref?.()

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

/**
 * Extract the client IP for rate limiting and audit logs.
 *
 * Under server.js the address is stamped by the server itself
 * (x-gf-client-ip = "<per-process token>:<ip>", any client copy dropped), so
 * it can't be chosen by the client; proxies are only trusted when configured
 * (GHOSTFORGE_TRUST_PROXY, see server.js). Without that stamp:
 *   - hosted mode trusts no client-supplied header ('unknown' shares one bucket);
 *   - the local build keeps its old order: x-real-ip, req.ip, rightmost
 *     x-forwarded-for, cf-connecting-ip.
 */
export function getClientIP(req: { headers: { get(k: string): string | null }; ip?: string | null }): string {
  const token = process.env.GF_CLIENT_IP_TOKEN
  const stamped = req.headers.get('x-gf-client-ip')?.trim()
  if (token && stamped && stamped.startsWith(token + ':')) return stamped.slice(token.length + 1) || 'unknown'
  if (isHostedMode()) return req.ip?.trim() || 'unknown'
  return (
    req.headers.get('x-real-ip')?.trim() ||
    req.ip?.trim() ||
    // x-forwarded-for is attacker-controllable; the rightmost value is the one
    // appended by the last proxy in the chain, so it is the least spoofable.
    req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ||
    req.headers.get('cf-connecting-ip')?.trim() ||
    'local'
  )
}
