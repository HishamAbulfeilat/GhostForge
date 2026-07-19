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

export function getBridgeUrl(): string {
  return process.env.WS_BRIDGE_URL ?? 'http://localhost:4747'
}
