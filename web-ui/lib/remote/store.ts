/**
 * Remote access state: one-time pairing codes, paired devices, and whether
 * remote desktop control is switched on.
 *
 *   ~/.ghostforge/remote.json
 *
 * Pairing: the owner of a signed-in session on the laptop creates a code; the
 * phone opens /api/remote/pair?code=… once and is signed in as that user. A code
 * works once and expires after 10 minutes. Each paired device gets an id that is
 * carried in its session token, so revoking the device ends that session.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

export const PAIR_TTL_MS = 10 * 60_000
const MAX_DEVICES = 20

export interface PairingCode { hash: string; username: string; createdAt: string; expiresAt: string; label: string }
export interface PairedDevice { id: string; username: string; name: string; pairedAt: string; lastSeen?: string; revoked?: boolean }
export interface RemoteState {
  pairings: PairingCode[]
  devices: PairedDevice[]
  /** Screen viewing + mouse/keyboard control from paired devices. Off by default. */
  desktopEnabled: boolean
  desktopEnabledAt?: string
}

const FILE = () => join(homedir(), '.ghostforge', 'remote.json')
const EMPTY: RemoteState = { pairings: [], devices: [], desktopEnabled: false }

// Writes run one at a time so concurrent requests never lose an update.
let queue: Promise<unknown> = Promise.resolve()
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

export async function readRemote(): Promise<RemoteState> {
  try {
    const parsed = JSON.parse(await readFile(FILE(), 'utf8')) as Partial<RemoteState>
    return {
      pairings: Array.isArray(parsed.pairings) ? parsed.pairings : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      desktopEnabled: parsed.desktopEnabled === true,
      desktopEnabledAt: parsed.desktopEnabledAt,
    }
  } catch {
    return { ...EMPTY, pairings: [], devices: [] }
  }
}

async function writeRemote(state: RemoteState): Promise<void> {
  await mkdir(join(homedir(), '.ghostforge'), { recursive: true })
  const tmp = `${FILE()}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, FILE())
}

export function updateRemote(fn: (state: RemoteState) => RemoteState | void): Promise<RemoteState> {
  return locked(async () => {
    const state = await readRemote()
    const next = fn(state) || state
    await writeRemote(next)
    return next
  })
}

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex')

/** A new one-time pairing code for `username` (only its hash is stored). */
export async function createPairing(username: string, label = 'Phone'): Promise<{ code: string; expiresAt: string }> {
  // 128 bits, URL-safe: it travels in a QR code / link, never typed.
  const code = randomBytes(16).toString('base64url')
  const now = Date.now()
  const expiresAt = new Date(now + PAIR_TTL_MS).toISOString()
  await updateRemote(s => {
    s.pairings = s.pairings.filter(p => Date.parse(p.expiresAt) > now).slice(-9)
    s.pairings.push({ hash: hashCode(code), username, createdAt: new Date(now).toISOString(), expiresAt, label: label.slice(0, 40) })
  })
  return { code, expiresAt }
}

/** Consume a pairing code: returns the new device, or null when the code is unknown, used or expired. */
export async function redeemPairing(code: string, deviceName: string): Promise<PairedDevice | null> {
  if (typeof code !== 'string' || code.length < 16 || code.length > 64) return null
  const given = Buffer.from(hashCode(code))
  let device: PairedDevice | null = null
  await updateRemote(s => {
    const now = Date.now()
    const idx = s.pairings.findIndex(p => {
      const stored = Buffer.from(p.hash)
      return stored.length === given.length && timingSafeEqual(stored, given)
    })
    if (idx === -1) return
    const pairing = s.pairings[idx]
    s.pairings.splice(idx, 1) // single use, even if expired
    if (Date.parse(pairing.expiresAt) <= now) return
    device = {
      id: randomBytes(9).toString('base64url'),
      username: pairing.username,
      name: deviceName.slice(0, 80) || pairing.label,
      pairedAt: new Date(now).toISOString(),
    }
    s.devices = [...s.devices.filter(d => !d.revoked), device].slice(-MAX_DEVICES)
  })
  return device
}

export async function revokeDevice(id: string, username: string, isOwner: boolean): Promise<boolean> {
  let found = false
  await updateRemote(s => {
    for (const d of s.devices) {
      if (d.id === id && (isOwner || d.username === username)) { d.revoked = true; found = true }
    }
  })
  return found
}

/** True when a token's device id is unknown or revoked (tokens without a device id are not device sessions). */
export async function isDeviceRevoked(deviceId: string): Promise<boolean> {
  const { devices } = await readRemote()
  const d = devices.find(x => x.id === deviceId)
  return !d || d.revoked === true
}

let lastTouch = new Map<string, number>()
/** Record when a paired device was last seen (at most once a minute). */
export async function touchDevice(deviceId: string): Promise<void> {
  const now = Date.now()
  if ((lastTouch.get(deviceId) ?? 0) > now - 60_000) return
  lastTouch.set(deviceId, now)
  if (lastTouch.size > 200) lastTouch = new Map([...lastTouch].slice(-100))
  await updateRemote(s => {
    const d = s.devices.find(x => x.id === deviceId)
    if (d) d.lastSeen = new Date(now).toISOString()
  }).catch(() => {})
}

/** A short device name from a User-Agent, e.g. "iPhone · Safari". */
export function deviceNameFromUA(ua: string | null): string {
  const s = ua || ''
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'Device'
  const browser = /EdgA?\//.test(s) ? 'Edge' : /CriOS|Chrome\//.test(s) ? 'Chrome' : /FxiOS|Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser'
  return `${os} · ${browser}`
}
