/**
 * Validation for the Mark-L bridge base URL.
 *
 * Requests to the bridge carry the local bridge token read from
 * ~/.ghostforge/bridge/token, so the destination must be the bridge on this
 * machine. A non-loopback MARKL_BRIDGE_URL is refused unless the operator
 * explicitly opts in with GF_ALLOW_REMOTE_BRIDGE=1 (same rule as the CLIs in
 * scripts/ and the TUI).
 */
export const DEFAULT_MARKL_BRIDGE_URL = 'http://127.0.0.1:8765'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export class BridgeUrlError extends Error {}

/** Validate a bridge base URL and return its origin (scheme://host[:port]). */
export function validateBridgeUrl(
  raw: string,
  allowRemote: boolean = process.env.GF_ALLOW_REMOTE_BRIDGE === '1',
): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new BridgeUrlError('MARKL_BRIDGE_URL must be an absolute http(s) URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash) {
    throw new BridgeUrlError('MARKL_BRIDGE_URL must contain only an http(s) scheme, host, and optional port')
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname) && !allowRemote) {
    throw new BridgeUrlError('MARKL_BRIDGE_URL is not loopback; set GF_ALLOW_REMOTE_BRIDGE=1 to opt in')
  }
  return parsed.origin
}

/** The configured Mark-L bridge origin, validated. Throws BridgeUrlError if unsafe. */
export function getMarkLBridgeUrl(env: NodeJS.ProcessEnv = process.env): string {
  return validateBridgeUrl(env.MARKL_BRIDGE_URL?.trim() || DEFAULT_MARKL_BRIDGE_URL, env.GF_ALLOW_REMOTE_BRIDGE === '1')
}
