/**
 * Hosted ("friends") mode — GHOSTFORGE_MODE=hosted.
 *
 * GhostForge is built to run on its owner's own machine: it opens terminals,
 * drives the desktop, reads files, talks to the local bridge and uses the
 * owner's AI keys. When the web UI is hosted for other people, none of that
 * may be reachable. This module is the single place that says what is off:
 *
 *   - API routes that act on the host machine or the owner's accounts
 *     (blocked in middleware AND by hostedGuard() inside the routes)
 *   - permissions that unlock those capabilities (hasPermission() denies them,
 *     even for admins)
 *   - pages for those features (hidden in the navbar, redirected in middleware)
 *   - server-wide AI / integration keys from process.env (never used — every
 *     friend brings their own key, or uses the keyless free models)
 *
 * Edge-safe and dependency-free: middleware, server code and plain Node tests
 * all import it.
 */
// Shared with server.js (plain CommonJS), hence JSON: lists what hosted mode switches off
import policy from './hosted-policy.json' with { type: 'json' }

export const HOSTED_UNAVAILABLE = 'Not available on the hosted version'

export function isHostedMode(env: Record<string, string | undefined> = process.env): boolean {
  return (env.GHOSTFORGE_MODE || '').trim().toLowerCase() === 'hosted'
}

interface BlockedRoute {
  prefix: string
  /** Only these methods are blocked; omitted = every method */
  methods?: string[]
}

/** API surface that is off in hosted mode (prefix match on a path-segment boundary) */
export const HOSTED_BLOCKED_API: readonly BlockedRoute[] = policy.blockedApi

/** Pages for the blocked features (hidden in the UI, redirected in middleware) */
export const HOSTED_BLOCKED_PAGES: readonly string[] = policy.blockedPages

/** Permissions that unlock host / owner-account capabilities — denied to everyone */
export const HOSTED_BLOCKED_PERMISSIONS: ReadonlySet<string> = new Set(policy.blockedPermissions)

/**
 * JARVIS tools that only reach public web services. Everything else (shell,
 * AppleScript, mouse/keyboard, email, messages, files, bridge…) is refused.
 */
export const HOSTED_JARVIS_TOOLS: ReadonlySet<string> = new Set(policy.jarvisTools)

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

/** Is this API request blocked in hosted mode? (Pure: pass `hosted` to test.) */
export function isBlockedApi(pathname: string, method = 'GET', hosted = isHostedMode()): boolean {
  if (!hosted) return false
  const m = method.toUpperCase()
  return HOSTED_BLOCKED_API.some(r => matchesPrefix(pathname, r.prefix) && (!r.methods || r.methods.includes(m)))
}

export function isBlockedPage(pathname: string, hosted = isHostedMode()): boolean {
  return hosted && HOSTED_BLOCKED_PAGES.some(p => matchesPrefix(pathname, p))
}

export function isBlockedPermission(permission: string, hosted = isHostedMode()): boolean {
  return hosted && HOSTED_BLOCKED_PERMISSIONS.has(permission)
}

export function isHostedJarvisToolAllowed(tool: string, hosted = isHostedMode()): boolean {
  return !hosted || HOSTED_JARVIS_TOOLS.has(tool)
}

/** 403 for a feature that is off on the hosted version (plain Response: no Next import, so plain Node tests can load this) */
export function hostedUnavailableResponse(): Response {
  return new Response(JSON.stringify({ error: HOSTED_UNAVAILABLE, hosted: true }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Route-level guard. Call first in a handler that acts on the host:
 *   const blocked = hostedGuard(); if (blocked) return blocked
 * Middleware enforces the same list; this keeps the route safe on its own.
 */
export function hostedGuard(req?: { nextUrl?: { pathname: string }; method?: string }): Response | null {
  if (!isHostedMode()) return null
  if (!req?.nextUrl) return hostedUnavailableResponse()
  return isBlockedApi(req.nextUrl.pathname, req.method || 'GET', true) ? hostedUnavailableResponse() : null
}

/**
 * Read an integration secret from the environment — except in hosted mode,
 * where server-wide keys belong to the owner and are never used.
 */
export function ownerEnv(name: string): string | undefined {
  if (isHostedMode()) return undefined
  return process.env[name] || undefined
}

/** Env vars hosted mode needs to keep; everything else that looks like a secret is dropped */
const KEEP_ENV = new Set(['AUTH_SECRET', 'ADMIN_PASSWORD'])
const SECRET_ENV = /(^|_)(API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASS|PIN|CREDENTIALS?|WEBHOOK_URL|COOKIE|SESSION)$/i

/** Is this env var an owner/integration secret that hosted mode must not keep? */
export function isOwnerSecretEnv(name: string): boolean {
  if (KEEP_ENV.has(name) || name.startsWith('NEXT_') || name.startsWith('__NEXT') || name.startsWith('VERCEL_')) return false
  return SECRET_ENV.test(name)
}

/**
 * Hosted mode: delete the owner's integration secrets (AI keys, GitHub token,
 * bridge tokens, VAPID keys, ACCESS_PIN…) from process.env at startup, so no
 * code path can fall back to them. Returns the names removed (never values).
 */
export function scrubOwnerSecrets(env: Record<string, string | undefined> = process.env): string[] {
  if (!isHostedMode(env)) return []
  const removed = Object.keys(env).filter(isOwnerSecretEnv)
  for (const name of removed) delete env[name]
  return removed.sort()
}

const MIN_SECRET = 32
const MIN_ADMIN_PASSWORD = 12

/**
 * Hosted mode fails closed: refuse to run without a strong session secret and
 * an explicit admin password. Returns the list of problems (empty = OK).
 */
export function hostedConfigProblems(env: Record<string, string | undefined> = process.env): string[] {
  if (!isHostedMode(env)) return []
  const problems: string[] = []
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < MIN_SECRET) {
    problems.push(`AUTH_SECRET must be set to a random string of at least ${MIN_SECRET} characters (openssl rand -hex 32)`)
  }
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < MIN_ADMIN_PASSWORD) {
    problems.push(`ADMIN_PASSWORD must be set (at least ${MIN_ADMIN_PASSWORD} characters)`)
  }
  if (env.GF_EPHEMERAL_AUTH_SECRET === '1') {
    problems.push('AUTH_SECRET was auto-generated; set a fixed AUTH_SECRET for hosted mode')
  }
  return problems
}

export function assertHostedConfig(env: Record<string, string | undefined> = process.env): void {
  const problems = hostedConfigProblems(env)
  if (problems.length) {
    throw new Error(`[hosted] GhostForge will not start in hosted mode:\n  - ${problems.join('\n  - ')}`)
  }
}

/**
 * Is a URL safe for the server to call on a friend's behalf? Hosted mode
 * refuses plain http and loopback / private / link-local hosts, so a custom
 * model URL can't reach services on the host (Ollama, the bridge, metadata).
 * Literal-address check only; DNS that resolves to a private address is not
 * caught here.
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host.startsWith('::ffff:')) return false
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT / Tailscale
  }
  if (/^\d+$/.test(host)) return false // decimal-encoded IPv4
  return true
}
