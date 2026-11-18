import fs from 'fs'
import path from 'path'
import os from 'os'

/** ~/.ghostforge/bridge/token — resolved per call so HOME changes are honoured. */
export function bridgeTokenFile(): string {
  return path.join(os.homedir(), '.ghostforge', 'bridge', 'token')
}

/** Always reads fresh from disk — never stale after bridge restart */
export function getLiveBridgeToken(): string {
  try {
    return fs.readFileSync(bridgeTokenFile(), 'utf8').trim()
  } catch {
    return process.env.WS_BRIDGE_TOKEN ?? ''
  }
}

/**
 * Token for the Mark-L bridge (mark-l-bridge/server.py, :8765) and the voice
 * pipeline (:8766). Same order the Python services use to check it:
 *   1. MARKL_BRIDGE_TOKEN (non-blank)
 *   2. ~/.ghostforge/bridge/token
 * Read fresh on every call so a rotated file is picked up without a restart.
 * Every :8765 caller must use this, otherwise setting MARKL_BRIDGE_TOKEN
 * (which the bridge then requires) turns their calls into 401s.
 */
export function getMarkLBridgeToken(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.MARKL_BRIDGE_TOKEN?.trim()
  if (fromEnv) return fromEnv
  try {
    return fs.readFileSync(bridgeTokenFile(), 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * Candidate bridge URLs, most-preferred first:
 * 1. Local bridge on the same machine (works when web-ui runs on the host)
 * 2. WS_BRIDGE_URL / WS_BRIDGE_URL_LOCAL from the environment (tunnel or LAN)
 */
export function getBridgeUrlCandidates(): string[] {
  const candidates = ['http://localhost:4747']
  const remote = process.env.WS_BRIDGE_URL ?? process.env.WS_BRIDGE_URL_LOCAL
  if (remote && !candidates.includes(remote.replace(/\/$/, ''))) candidates.push(remote.replace(/\/$/, ''))
  return candidates
}

/**
 * Preferred bridge URL. When the web-ui server runs on the same machine as
 * the bridge (the common local setup), the localhost candidate is used even
 * if a tunnel URL is configured, because the tunnel only works when the
 * bridge-side machine is online.
 */
export function getBridgeUrl(): string {
  return getBridgeUrlCandidates()[0]
}
