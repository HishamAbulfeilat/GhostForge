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
 * Header that server.js (the custom server) sets from the TCP socket address on
 * every request, overwriting any value a client sent. It is only trusted when
 * server.js marked the process with GF_CUSTOM_SERVER=1.
 */
export const REMOTE_ADDR_HEADER = 'x-gf-remote-addr'

/**
 * Key used when the real client address is unknown (e.g. plain `next dev` /
 * `next start` without server.js). Everyone shares it, so rate limits and
 * lockouts get stricter rather than becoming bypassable via a spoofed header.
 */
export const SHARED_CLIENT_KEY = 'local'

function normalizeIp(ip: string | null | undefined): string {
  const v = String(ip || '').trim()
  // IPv4-mapped IPv6 (how Node reports v4 peers on a dual-stack socket)
  return v.toLowerCase().startsWith('::ffff:') && v.includes('.') ? v.slice(7) : v
}

/**
 * Client address for rate limits, lockouts and logs.
 *
 * Proxy headers (x-real-ip, x-forwarded-for, cf-connecting-ip) are written by
 * the client unless a reverse proxy overwrites them, so they are only trusted
 * when TRUSTED_PROXY=1. Otherwise the socket address from server.js is used.
 */
export function getClientIP(
  req: { headers: { get(k: string): string | null }; ip?: string | null },
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.TRUSTED_PROXY === '1') {
    const proxied =
      req.headers.get('x-real-ip')?.trim() ||
      // the rightmost value is the one appended by the (trusted) last proxy
      req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ||
      req.headers.get('cf-connecting-ip')?.trim()
    if (proxied) return normalizeIp(proxied)
  }
  if (env.GF_CUSTOM_SERVER === '1') {
    const socketAddr = normalizeIp(req.headers.get(REMOTE_ADDR_HEADER))
    if (socketAddr) return socketAddr
  }
  const platformIp = normalizeIp(req.ip)
  if (platformIp) return platformIp
  return SHARED_CLIENT_KEY
}
