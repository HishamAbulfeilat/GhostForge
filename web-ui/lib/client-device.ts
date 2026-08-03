/**
 * Client-side device fingerprinting for GhostForge.
 *
 * Generates a STABLE device id (persisted in localStorage) so returning devices
 * are recognised and merged on the server, and collects high-entropy signals
 * the browser will share (user agent, platform, model, screen, cores, memory,
 * language, timezone) to help identify the device.
 *
 * NOTE: browsers never expose the client MAC address — that's resolved
 * server-side only for local/Electron same-machine requests.
 */
'use client'

import type { PlatformType } from './platform'

const STORAGE_KEY = 'gf_device_id'

let cachedId: string | null = null

/** Get or create the stable device id for this browser. */
export function getDeviceId(): string {
  if (cachedId) return cachedId
  if (typeof window !== 'undefined' && window.localStorage) {
    const existing = window.localStorage.getItem(STORAGE_KEY)
    if (existing) {
      cachedId = existing
      return existing
    }
    const id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6)
    window.localStorage.setItem(STORAGE_KEY, id)
    cachedId = id
    return id
  }
  if (!cachedId) {
    cachedId = 'dev_' + Math.random().toString(36).slice(2, 12)
  }
  return cachedId
}

interface UAData {
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, string | number | string[] | undefined>>
}

async function getHighEntropy(): Promise<Record<string, string | number>> {
  const nav = navigator as Navigator & { userAgentData?: UAData }
  try {
    if (nav.userAgentData?.getHighEntropyValues) {
      const hints = await nav.userAgentData.getHighEntropyValues([
        'architecture', 'platformVersion', 'model', 'uaFullVersion',
      ])
      const out: Record<string, string | number> = {}
      if (hints.architecture) out.architecture = String(hints.architecture)
      if (hints.platformVersion) out.platformVersion = String(hints.platformVersion)
      if (hints.model) out.model = String(hints.model)
      if (hints.uaFullVersion) out.uaFullVersion = String(hints.uaFullVersion)
      return out
    }
  } catch {
    // privacy mode etc.
  }
  return {}
}

function parseBrowser(ua: string): string {
  type Match = [RegExp, (m: RegExpMatchArray) => string]
  const rules: Match[] = [
    [/Edg\/([\d.]+)/, m => `Edge ${m[1].split('.')[0]}`],
    [/Chrome\/([\d.]+)/, m => `Chrome ${m[1].split('.')[0]}`],
    [/Firefox\/([\d.]+)/, m => `Firefox ${m[1].split('.')[0]}`],
    [/Safari\/([\d.]+)/, m => `Safari ${m[1].split('.')[0]}`],
  ]
  for (const [re, label] of rules) {
    const m = ua.match(re)
    if (m) return label(m)
  }
  return 'Unknown'
}

function detectType(ua: string): PlatformType {
  if (/android/.test(ua)) return 'android'
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/macintosh|mac os x/.test(ua)) return 'mac'
  if (/windows/.test(ua)) return 'windows'
  if (/linux/.test(ua)) return 'linux'
  return 'unknown'
}

function buildDeviceName(model: string, platform: PlatformType): string {
  const device = model.trim() ? model.trim() : platform
  if (typeof window !== 'undefined' && window.screen) {
    return `${device} (${window.screen.width}x${window.screen.height})`
  }
  return device
}

export interface ClientFingerprint {
  id: string
  name: string
  platform: PlatformType
  browser: string
  model: string
  ua: string
  details: Record<string, unknown>
}

/**
 * Collect a fingerprint for this browser/device. Cheap and safe to call on
 * mount. Returns the device id and signals to POST to /api/devices.
 */
export async function collectFingerprint(): Promise<ClientFingerprint | null> {
  if (typeof window === 'undefined') return null
  const ua = navigator.userAgent
  const platform = detectType(ua)
  const high = await getHighEntropy()
  const model = String(high.model || '').trim() || platform
  const browser = parseBrowser(ua)
  const details: Record<string, unknown> = {
    screen: window.screen ? `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}` : null,
    cores: navigator.hardwareConcurrency || null,
    memoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory || null,
    lang: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    touchpoints: navigator.maxTouchPoints || 0,
    ...high,
  }

  return {
    id: getDeviceId(),
    name: buildDeviceName(model, platform),
    platform,
    browser,
    ua,
    model,
    details,
  }
}

/** POST this device to the server for auto-registration under the current user. */
export async function reportDevice(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return false
    const fp = await collectFingerprint()
    if (!fp) return false
    const res = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fp),
    })
    return res.ok
  } catch {
    return false
  }
}
