/**
 * Cross-platform system metrics for the host running the web-ui server.
 * Works on macOS, Windows, and Linux using os + child_process built-ins.
 * Never throws — every getter returns safe defaults on failure.
 */
import { execSync } from 'child_process'
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

// Disk usage and battery level change slowly but cost a blocking child process
// (df / wmic / pmset) each. The metrics SSE stream polls every 4 s per open tab
// and the dashboard polls too, so reuse a reading for a short while.
const SLOW_METRIC_TTL_MS = 30_000

function cachedFor<T>(ttlMs: number, read: () => T): () => T {
  let value: T
  let readAt = -Infinity
  return () => {
    const now = Date.now()
    if (now - readAt >= ttlMs) {
      value = read()
      readAt = now
    }
    return value
  }
}

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

// ─── Disk ────────────────────────────────────────────────────────────────────

export const getDisk: () => MetricStat = cachedFor(SLOW_METRIC_TTL_MS, readDisk)

function readDisk(): MetricStat {
  try {
    if (process.platform === 'win32') {
      // Prefer wmic; fall back to PowerShell CIM when wmic is unavailable
      // (removed on recent Windows 11 builds).
      const parseCsv = (out: string) => {
        let used = 0
        let total = 0
        for (const line of out.split('\n')) {
          // Strip CSV quotes (wmic /format:csv is unquoted, ConvertTo-Csv
          // quotes every field) and whitespace.
          const cols = line.trim().split(',').map(c => c.trim().replace(/^"|"$/g, ''))
          // wmic CSV header: Node,Caption,FreeSpace,Size (shifted by one)
          // ConvertTo-Csv header: Caption,FreeSpace,Size
          const captionIdx = cols.findIndex(c => /^[A-Za-z]:$/.test(c))
          if (captionIdx < 0) continue
          const free = safeParseInt(cols[captionIdx + 1])
          const size = safeParseInt(cols[captionIdx + 2])
          if (size <= 0) continue
          used += size - free
          total += size
        }
        return { used, total }
      }
      try {
        const out = execSync('wmic logicaldisk get caption,freespace,size /format:csv', { timeout: 3000 }).toString()
        const { used, total } = parseCsv(out)
        if (total > 0) return { usedGB: gb(used), totalGB: gb(total), pct: Math.round((used / total) * 100) }
      } catch { /* fall through to PowerShell */ }
      const psOut = execSync(
        "powershell -NoProfile -Command \"Get-CimInstance Win32_LogicalDisk | Select-Object Caption,FreeSpace,Size | ConvertTo-Csv -NoTypeInformation\"",
        { timeout: 5000 },
      ).toString()
      const { used, total } = parseCsv(psOut)
      return {
        usedGB: gb(used),
        totalGB: gb(total),
        pct: total > 0 ? Math.round((used / total) * 100) : 0,
      }
    }

    // macOS / Linux: df on the filesystem that holds cwd
    const mountPoint = process.platform === 'darwin' ? '/' : '/'
    const out = execSync(`df -k ${mountPoint}`, { timeout: 2000 }).toString()
    const line = out.split('\n')[1] ?? ''
    const parts = line.trim().split(/\s+/)
    const total = (safeParseInt(parts[1])) / 1048576
    const used = (safeParseInt(parts[2])) / 1048576
    return {
      usedGB: Math.round(used * 10) / 10,
      totalGB: Math.round(total * 10) / 10,
      pct: total > 0 ? Math.round((used / total) * 100) : 0,
    }
  } catch {
    return DEFAULT_DISK
  }
}

// ─── Battery ─────────────────────────────────────────────────────────────────

export const getBattery: () => BatteryStat = cachedFor(SLOW_METRIC_TTL_MS, readBattery)

function readBattery(): BatteryStat {
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
    if (process.platform === 'win32') {
      // wmic battery approximates charge level from FullChargeCapacity vs
      // EstimatedChargeRemaining when available; present only if a battery exists.
      const out = execSync(
        'wmic path Win32_Battery get EstimatedChargeRemaining,BatteryStatus /format:list',
        { timeout: 2000 },
      ).toString()
      const pct = safeParseInt(out.match(/EstimatedChargeRemaining=(\d+)/)?.[1])
      if (out.includes('EstimatedChargeRemaining') || out.includes('BatteryStatus')) {
        return { pct: pct || null, charging: /BatteryStatus=(2|6|7|8|9)/.test(out), present: true }
      }
      return NO_BATTERY
    }
    // Linux: /sys/class/power_supply (plain files, no need to spawn `cat`)
    const readSys = (name: string) => {
      try { return fs.readFileSync(`/sys/class/power_supply/BAT0/${name}`, 'utf8').trim() } catch { return '' }
    }
    const capacity = readSys('capacity')
    if (capacity) {
      return { pct: safeParseInt(capacity), charging: readSys('status') === 'Charging', present: true }
    }
    return NO_BATTERY
  } catch {
    return NO_BATTERY
  }
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
