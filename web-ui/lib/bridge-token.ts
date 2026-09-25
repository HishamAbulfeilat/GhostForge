import fs from 'fs'
import path from 'path'
import os from 'os'

const TOKEN_FILE = path.join(os.homedir(), '.ghostforge', 'bridge', 'token')

/** Always reads fresh from disk — never stale after bridge restart */
export function getLiveBridgeToken(): string {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  } catch {
    return process.env.WS_BRIDGE_TOKEN ?? ''
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
