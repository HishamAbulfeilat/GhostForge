/**
 * Cross-platform system metrics for the host running the web-ui server.
 * Works on macOS, Windows, and Linux. Windows never spawns Unix tools or wmic:
 * CPU/RAM use `os`, disk uses fs.statfs, and only the battery uses PowerShell
 * (async, cached). Results are cached so callers stay fast.
 * Never throws — every getter returns safe defaults on failure.
 */
import { execFile, execSync } from 'child_process'
import fs from 'fs'
import os from 'os'

export interface MetricStat {
  usedGB: number
  totalGB: number
  pct: number
}

export interface BatteryStat {
  pct: number | null
  charging: boolean
  present: boolean
}

export interface SystemSnapshot {
  cpu: number
  ram: MetricStat
  disk: MetricStat
  battery: BatteryStat
  platform: NodeJS.Platform
  hostname: string
  arch: string
  uptimeSec: number
}

const gb = (bytes: number) => Math.round((bytes / 1073741824) * 10) / 10
const safeParseInt = (value: string | undefined): number => {
  const n = parseInt(value ?? '', 10)
  return Number.isFinite(n) ? n : 0
}

const DEFAULT_RAM: MetricStat = { usedGB: 0, totalGB: 0, pct: 0 }
const DEFAULT_DISK: MetricStat = { usedGB: 0, totalGB: 0, pct: 0 }
const NO_BATTERY: BatteryStat = { pct: null, charging: false, present: false }

// ─── CPU ─────────────────────────────────────────────────────────────────────

let lastCpuSample: { idle: number; total: number; usage: number } | null = null

export function getCPU(): number {
  const cpus = os.cpus()
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    idle += cpu.times.idle
    total += cpu.times.idle + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq
  }

  if (!lastCpuSample) {
    lastCpuSample = { idle, total, usage: 0 }
    return 0 // first call: no baseline yet
  }

  const idleDelta = idle - lastCpuSample.idle
  const totalDelta = total - lastCpuSample.total
  // Use the total-time delta as denominator so back-to-back calls (e.g.
  // dashboard + metrics stream) don't report spurious 100%.
  const usage = totalDelta > 0
    ? Math.min(100, Math.max(0, Math.round((1 - idleDelta / totalDelta) * 100)))
    : lastCpuSample.usage

  lastCpuSample = { idle, total, usage }
  return usage
}

// ─── RAM ─────────────────────────────────────────────────────────────────────

export function getRAM(): MetricStat {
  try {
    const totalBytes = os.totalmem()
    const freeBytes = os.freemem()
    const usedBytes = Math.max(totalBytes - freeBytes, 0)
    return {
      usedGB: gb(usedBytes),
      totalGB: gb(totalBytes),
      pct: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
    }
  } catch {
    return DEFAULT_RAM
  }
}

// ─── Cache ───────────────────────────────────────────────────────────────────
// Disk and battery are expensive (child process / drive probing) and change
// slowly, so every caller (/api/metrics SSE, dashboard, JARVIS tools) shares a
// short-lived cache instead of re-running them on each request.

const DISK_TTL_MS = 10_000
const BATTERY_TTL_MS = 30_000
const cache = new Map<string, { value: unknown; ts: number }>()

function cachedValue<T>(key: string, ttlMs: number, compute: () => T): T {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < ttlMs) return hit.value as T
  const value = compute()
  cache.set(key, { value, ts: Date.now() })
  return value
}

/** Test hook: drop all cached metrics. */
export function resetMetricsCache(): void {
  cache.clear()
  winBatteryRefreshing = false
}

// ─── Disk ────────────────────────────────────────────────────────────────────

export interface StatfsLike {
  bsize: number
  blocks: number
  bavail: number
}

/** Add a statfs result to running used/total byte counters. */
export function addStatfs(acc: { used: number; total: number }, s: StatfsLike): void {
  const total = s.blocks * s.bsize
  const free = s.bavail * s.bsize
  if (total <= 0) return
  acc.total += total
  acc.used += Math.max(total - free, 0)
}

function toDiskStat(used: number, total: number): MetricStat {
  return { usedGB: gb(used), totalGB: gb(total), pct: total > 0 ? Math.round((used / total) * 100) : 0 }
}

function computeDisk(): MetricStat {
  try {
    if (process.platform === 'win32') {
      // No child process: statfs every existing fixed drive letter (C..Z).
      const acc = { used: 0, total: 0 }
      for (let code = 67; code <= 90; code++) {
        const root = `${String.fromCharCode(code)}:${'\\'}`
        if (!fs.existsSync(root)) continue
        try { addStatfs(acc, fs.statfsSync(root)) } catch { /* empty card reader etc. */ }
      }
      return toDiskStat(acc.used, acc.total)
    }
    // macOS / Linux: statfs on the root filesystem (no `df` spawn needed).
    const acc = { used: 0, total: 0 }
    addStatfs(acc, fs.statfsSync('/'))
    return toDiskStat(acc.used, acc.total)
  } catch {
    return DEFAULT_DISK
  }
}

export function getDisk(): MetricStat {
  return cachedValue('disk', DISK_TTL_MS, computeDisk)
}

// ─── Battery ─────────────────────────────────────────────────────────────────

/** Parse `Get-CimInstance Win32_Battery | ConvertTo-Json` output (object or array). */
export function parseWindowsBattery(json: unknown): BatteryStat {
  const list = Array.isArray(json) ? json : json ? [json] : []
  const b = list[0] as Record<string, unknown> | undefined
  if (!b) return NO_BATTERY
  const pct = Number(b.EstimatedChargeRemaining)
  const status = Number(b.BatteryStatus)
  return {
    pct: Number.isFinite(pct) ? pct : null,
    charging: status === 2 || (status >= 6 && status <= 9),
    present: true,
  }
}

let winBattery: BatteryStat = NO_BATTERY
let winBatteryTs = 0
let winBatteryRefreshing = false

/** Refresh the Windows battery cache in the background; never blocks the event loop. */
function refreshWindowsBattery(): void {
  if (winBatteryRefreshing) return
  winBatteryRefreshing = true
  execFile(
    'powershell.exe',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress',
    ],
    { timeout: 4000, windowsHide: true },
    (err, stdout) => {
      winBatteryRefreshing = false
      winBatteryTs = Date.now()
      if (err) { winBattery = NO_BATTERY; return }
      try { winBattery = parseWindowsBattery(stdout.trim() ? JSON.parse(stdout) : null) } catch { winBattery = NO_BATTERY }
    },
  )
}

function computeBattery(): BatteryStat {
  try {
    if (process.platform === 'darwin') {
      const out = execSync('pmset -g batt', { timeout: 2000 }).toString()
      const pctMatch = out.match(/(\d+)%/)
      return {
        pct: pctMatch ? parseInt(pctMatch[1], 10) : null,
        charging: out.includes('charging') || out.includes('AC Power'),
        present: Boolean(pctMatch),
      }
    }
    if (process.platform === 'linux') {
      const capacity = fs.readFileSync('/sys/class/power_supply/BAT0/capacity', 'utf8').trim()
      const status = fs.readFileSync('/sys/class/power_supply/BAT0/status', 'utf8').trim()
      return capacity ? { pct: safeParseInt(capacity), charging: status === 'Charging', present: true } : NO_BATTERY
    }
    return NO_BATTERY
  } catch {
    return NO_BATTERY
  }
}

export function getBattery(): BatteryStat {
  if (process.platform === 'win32') {
    // Return the last known value instantly; refresh asynchronously when stale.
    if (Date.now() - winBatteryTs >= BATTERY_TTL_MS) refreshWindowsBattery()
    return winBattery
  }
  return cachedValue('battery', BATTERY_TTL_MS, computeBattery)
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export function getSystemSnapshot(): SystemSnapshot {
  return {
    cpu: getCPU(),
    ram: getRAM(),
    disk: getDisk(),
    battery: getBattery(),
    platform: process.platform,
    hostname: os.hostname(),
    arch: os.arch(),
    uptimeSec: Math.round(os.uptime()),
  }
}
