import { execFile } from 'child_process';
import { existsSync, promises as fsp } from 'fs';
import os from 'os';

/**
 * Windows-safe system metric helpers. On Windows we never spawn Unix tools
 * (top, grep, df, amixer, ...): CPU/RAM come from Node's `os`, disks from
 * fs.statfs, and only GPU/battery fall back to PowerShell Get-CimInstance
 * (async, short timeout, cached by the caller). wmic is gone on Windows 11.
 */

export interface CpuTimes {
  idle: number;
  total: number;
}

/** Sum idle/total CPU time across all cores from os.cpus(). */
export function sampleCpuTimes(cpus: os.CpuInfo[] = os.cpus()): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.idle + c.times.user + c.times.nice + c.times.sys + c.times.irq;
  }
  return { idle, total };
}

/** CPU busy percent (0-100) between two samples; 0 when there is no delta. */
export function cpuPercentBetween(prev: CpuTimes, cur: CpuTimes): number {
  const totalDelta = cur.total - prev.total;
  if (totalDelta <= 0) return 0;
  const idleDelta = cur.idle - prev.idle;
  return Math.min(100, Math.max(0, Math.round((1 - idleDelta / totalDelta) * 100)));
}

let lastCpuSample: CpuTimes | null = null;
let lastCpuPercent = 0;

/** CPU usage since the previous call (first call primes the baseline and returns 0). */
export function cpuUsageFromOs(): number {
  const cur = sampleCpuTimes();
  if (lastCpuSample) {
    const delta = cur.total - lastCpuSample.total;
    if (delta > 0) lastCpuPercent = cpuPercentBetween(lastCpuSample, cur);
  }
  lastCpuSample = cur;
  return lastCpuPercent;
}

/** Run a PowerShell snippet (Windows only) and parse its JSON output. Never throws. */
export function powershellJson(script: string, timeoutMs = 4000): Promise<unknown> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null);
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      },
    );
  });
}

const asArray = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export interface WindowsBattery {
  percent: number | null;
  charging: boolean;
  timeRemaining: number | null;
  present: boolean;
}

/** Parse `Get-CimInstance Win32_Battery | ConvertTo-Json` output. */
export function parseWindowsBattery(json: unknown): WindowsBattery {
  const b = asArray(json as Record<string, unknown> | Record<string, unknown>[] | null)[0];
  if (!b) return { percent: null, charging: false, timeRemaining: null, present: false };
  const pct = Number(b.EstimatedChargeRemaining);
  const status = Number(b.BatteryStatus);
  const minutes = Number(b.EstimatedRunTime);
  return {
    percent: Number.isFinite(pct) ? pct : null,
    // 2 = on AC, 6-9 = charging states
    charging: status === 2 || (status >= 6 && status <= 9),
    // 71582788 is the "unknown / on AC" sentinel
    timeRemaining: Number.isFinite(minutes) && minutes > 0 && minutes < 71582788 ? minutes : null,
    present: true,
  };
}

export function getWindowsBattery(): Promise<WindowsBattery> {
  return powershellJson(
    'Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime | ConvertTo-Json -Compress',
  ).then(parseWindowsBattery);
}

export interface WindowsGpu {
  name: string;
  memoryTotalMB: number | null;
}

/** Parse `Get-CimInstance Win32_VideoController | ConvertTo-Json` output. */
export function parseWindowsGpus(json: unknown): WindowsGpu[] {
  return asArray(json as Record<string, unknown> | Record<string, unknown>[] | null)
    .filter((g) => g && typeof g.Name === 'string')
    .map((g) => {
      const ram = Number(g.AdapterRAM);
      return {
        name: String(g.Name),
        // AdapterRAM is a uint32 and wraps at 4 GB; treat as a lower bound.
        memoryTotalMB: Number.isFinite(ram) && ram > 0 ? Math.round(ram / 1048576) : null,
      };
    });
}

export function getWindowsGpus(): Promise<WindowsGpu[]> {
  return powershellJson(
    'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress',
  ).then(parseWindowsGpus);
}

export interface StatfsLike {
  bsize: number;
  blocks: number;
  bavail: number;
}

/** Convert fs.statfs output to used/total/free GB. */
export function volumeFromStatfs(s: StatfsLike): { totalGB: number; usedGB: number; freeGB: number; percent: number } {
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  const used = Math.max(total - free, 0);
  const r = (b: number) => Math.round((b / 1073741824) * 10) / 10;
  return { totalGB: r(total), usedGB: r(used), freeGB: r(free), percent: total > 0 ? Math.round((used / total) * 100) : 0 };
}

/** Disk volumes on Windows via fs.statfs on each existing drive letter (no child process). */
export async function getWindowsDisks(): Promise<
  { fs: string; mount: string; type: string; totalGB: number; usedGB: number; freeGB: number; percent: number }[]
> {
  const out = [];
  for (let code = 67; code <= 90; code++) { // C..Z
    const mount = `${String.fromCharCode(code)}:\\`;
    if (!existsSync(mount)) continue;
    try {
      const s = await fsp.statfs(mount);
      const v = volumeFromStatfs(s);
      if (v.totalGB > 0) out.push({ fs: mount.slice(0, 2), mount, type: 'local', ...v });
    } catch { /* unreadable drive (e.g. empty card reader) */ }
  }
  return out;
}
