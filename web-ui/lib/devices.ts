/**
 * GhostForge per-user device registry.
 *
 * Every time a user hits GhostForge we auto-record their device so admins can
 * see WHO is using WHAT, from WHERE. A device is keyed by a stable client-side
 * fingerprint id (persisted in localStorage) so returning devices are merged
 * rather than duplicated.
 *
 * What we capture:
 *   - name      — human-readable device name (hostname for local, UA-derived otherwise)
 *   - ip        — client IP seen by the server (best available from headers)
 *   - mac       — MAC address (only for local/Electron same-machine requests;
 *                 browsers never expose the client MAC, so it's null otherwise)
 *   - hostname  — the GhostForge host machine's name (local requests only)
 *   - ua        — full user agent
 *   - platform  — mac | windows | linux | ios | android | unknown
 *   - browser   — parsed browser + version
 *   - model     — high-entropy device model / architecture when available
 *   - details   — extra fingerprint signals (cores, memory, screen, lang, tz, ...)
 *   - isLocal   — true when the request came from the same machine as the server
 *   - current   — last reported device for this user (single active session)
 *
 * Data is persisted per user at ~/.ghostforge/users/<username>/devices.json
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir, hostname as osHostname } from 'os'

const execAsync = promisify(exec)

export interface DeviceRecord {
  id: string                    // stable client fingerprint id
  name: string                  // human-readable device name
  ip: string                    // last seen IP
  mac?: string | null           // MAC when capturable (local requests)
  hostname?: string | null      // host machine name (local requests)
  ua?: string                   // user agent
  platform?: string             // mac|windows|linux|ios|android|unknown
  browser?: string              // e.g. "Chrome 126"
  model?: string                // high-entropy model / architecture
  details?: Record<string, unknown>
  isLocal?: boolean
  current?: boolean
  firstSeen: string
  lastSeen: string
}

interface DeviceFile {
  devices: DeviceRecord[]
}

let _cache = new Map<string, { devices: DeviceRecord[]; ts: number }>()
const CACHE_TTL = 2000

function devicesFile(username: string): string {
  return join(homedir(), '.ghostforge', 'users', String(username).toLowerCase(), 'devices.json')
}

async function readDevices(username: string): Promise<DeviceRecord[]> {
  const file = devicesFile(username)
  const cached = _cache.get(file)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.devices
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as DeviceFile
    const devices = Array.isArray(parsed.devices) ? parsed.devices : []
    _cache.set(file, { devices, ts: Date.now() })
    return devices
  } catch {
    return []
  }
}

async function writeDevices(username: string, devices: DeviceRecord[]): Promise<void> {
  const file = devicesFile(username)
  await mkdir(join(homedir(), '.ghostforge', 'users', String(username).toLowerCase()), { recursive: true })
  await writeFile(file, JSON.stringify({ devices }, null, 2), 'utf8')
  _cache.set(file, { devices, ts: Date.now() })
}

// ── host info (used for local requests & MAC) ──────────────────────────────

export interface HostInfo {
  hostname: string
  mac: string | null
  lanIp: string
}

/** Best-effort capture of the GhostForge host machine's identity. */
export async function getHostInfo(): Promise<HostInfo> {
  let mac: string | null = null
  let lanIp = ''
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execAsync('ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null')
      lanIp = stdout.trim()
      const { stdout: macOut } = await execAsync('ifconfig en0 ether 2>/dev/null | awk \'{print $2}\' || ifconfig en1 ether 2>/dev/null | awk \'{print $2}\'')
      const m = macOut.trim().match(/[0-9a-fA-F:]{17}/)
      mac = m ? m[0].toUpperCase() : null
    } else if (process.platform === 'linux') {
      const { stdout } = await execAsync('hostname -I 2>/dev/null | awk \'{print $1}\'')
      lanIp = stdout.trim()
      const { stdout: macOut } = await execAsync('cat /sys/class/net/$(ip route show default | awk \'{print $5}\' | head -1)/address 2>/dev/null')
      const m = macOut.trim().match(/[0-9a-fA-F:]{17}/)
      mac = m ? m[0].toUpperCase() : null
    } else if (process.platform === 'win32') {
      const { stdout } = await execAsync('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike \\"127.*\\"} | Select-Object -First 1).IPAddress"')
      lanIp = stdout.trim()
      const { stdout: macOut } = await execAsync('powershell -NoProfile -Command "(Get-NetAdapter | Where-Object Status -eq \\"Up\\" | Select-Object -First 1).MacAddress"')
      mac = macOut.trim() || null
    }
  } catch {
    // non-fatal — MAC stays null
  }
  return { hostname: osHostname(), mac, lanIp }
}

/** True when a client IP refers to this same machine (loopback or host LAN IP). */
export function isLocalIp(ip: string, hostLanIp: string): boolean {
  const clean = (String(ip || '').split(',').pop() || '').trim()
  if (!clean || clean === 'local') return true
  return clean === '127.0.0.1' || clean === '::1' || clean === 'localhost' || clean === '::ffff:127.0.0.1' ||
    Boolean(hostLanIp && clean === hostLanIp)
}

// ── CRUD ───────────────────────────────────────────────────────────────────

/**
 * Upsert a device for a user. Merges server-captured data (ip, host info) with
 * client-reported fingerprint data. Marks the reported device as `current`.
 * Returns the updated record list.
 */
export async function upsertDevice(
  username: string,
  input: {
    id: string
    name?: string
    ip: string
    hostInfo?: HostInfo | null
    ua?: string
    platform?: string
    browser?: string
    model?: string
    details?: Record<string, unknown>
    isLocal?: boolean
  },
): Promise<DeviceRecord[]> {
  const devices = await readDevices(username)
  const now = new Date().toISOString()
  const idx = devices.findIndex(d => d.id === input.id)

  const host = input.hostInfo
  const mac = input.isLocal && host?.mac ? host.mac : null
  const hostname = input.isLocal && host?.hostname ? host.hostname : null

  const record: DeviceRecord = {
    id: input.id,
    name: input.name || (input.isLocal && hostname ? hostname : input.platform || 'unknown-device'),
    ip: input.ip,
    mac,
    hostname,
    ua: input.ua,
    platform: input.platform,
    browser: input.browser,
    model: input.model,
    details: input.details,
    isLocal: !!input.isLocal,
    current: true,
    firstSeen: idx !== -1 ? devices[idx].firstSeen : now,
    lastSeen: now,
  }

  // demote any other "current" device for this user
  const updated = devices.map(d => (d.id === input.id ? record : { ...d, current: false }))
  if (idx === -1) updated.push(record)
  await writeDevices(username, updated)
  return updated
}

export async function getDevicesForUser(username: string): Promise<DeviceRecord[]> {
  return readDevices(username)
}

/** Mark a device id as the current one (called when its request is seen). */
export async function markDeviceCurrent(username: string, deviceId: string): Promise<void> {
  const devices = await readDevices(username)
  if (!devices.some(d => d.id === deviceId)) return
  const updated = devices.map(d => ({ ...d, current: d.id === deviceId, lastSeen: new Date().toISOString() }))
  await writeDevices(username, updated)
}

export async function deleteDevice(username: string, deviceId: string): Promise<boolean> {
  const devices = await readDevices(username)
  const next = devices.filter(d => d.id !== deviceId)
  if (next.length === devices.length) return false
  await writeDevices(username, next)
  return true
}

export async function deviceFileExists(username: string): Promise<boolean> {
  return existsSync(devicesFile(username))
}
