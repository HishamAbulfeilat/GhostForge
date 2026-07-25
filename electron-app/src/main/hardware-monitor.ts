import { execSync } from 'child_process';
import os from 'os';

/**
 * Cross-platform hardware monitoring for GhostForge JARVIS.
 * Uses Node `os` module + `systeminformation` npm package.
 * Results are cached for 5 seconds to avoid hammering the system.
 */

const CACHE_TTL_MS = 5000;
const cache = new Map<string, { data: unknown; ts: number }>();

function cached<T>(key: string, fn: () => T): T {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.data as T;
  }
  const data = fn();
  cache.set(key, { data, ts: Date.now() });
  return data;
}

async function cachedAsync<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.data as T;
  }
  const data = await fn();
  cache.set(key, { data, ts: Date.now() });
  return data;
}

function runSync(cmd: string): string {
  try {
    return execSync(cmd, { timeout: 5000, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

async function runSi(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** CPU statistics. */
export interface CpuStats {
  model: string;
  cores: number;
  usagePercent: number;
  temperature: number | null;
  speed: number;
}

/** RAM statistics. */
export interface RamStats {
  totalGB: number;
  usedGB: number;
  freeGB: number;
  percent: number;
  swapTotalGB: number;
  swapUsedGB: number;
}

/** Single disk volume info. */
export interface DiskVolume {
  fs: string;
  mount: string;
  type: string;
  totalGB: number;
  usedGB: number;
  freeGB: number;
  percent: number;
}

/** GPU information. */
export interface GpuStats {
  name: string;
  usagePercent: number | null;
  memoryTotalMB: number | null;
  memoryUsedMB: number | null;
}

/** Fan speed info. */
export interface FanInfo {
  label: string;
  rpm: number;
}

/** Combined system report. */
export interface SystemReport {
  cpu: CpuStats;
  ram: RamStats;
  disks: DiskVolume[];
  gpu: GpuStats[];
  fans: FanInfo[];
  battery: { percent: number | null; charging: boolean };
  uptime: number;
  platform: string;
  hostname: string;
}

/** Get CPU usage percentage (averaged across cores). */
function getCpuUsageSync(): number {
  try {
    const output = runSync('top -l 1 -n 0 | grep "CPU usage"');
    const idleMatch = output.match(/([\d.]+)%\s+idle/);
    if (idleMatch) return Math.round(100 - parseFloat(idleMatch[1]));

    // Linux fallback
    const statLine = runSync('grep "^cpu " /proc/stat');
    if (statLine) {
      const parts = statLine.split(/\s+/).slice(1).map(Number);
      const idle = parts[3] || 0;
      const total = parts.reduce((a, b) => a + b, 0);
      return total > 0 ? Math.round(((total - idle) / total) * 100) : 0;
    }
  } catch { /* fall through */ }
  return 0;
}

/** Get CPU temperature if available. */
function getCpuTempSync(): number | null {
  try {
    if (process.platform === 'darwin') {
      const out = runSync('osx-cpu-temp 2>/dev/null');
      const match = out.match(/([\d.]+)/);
      if (match) return parseFloat(match[1]);
    }
    // Linux: thermal zones
    const out = runSync('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null');
    if (out) return Math.round(parseInt(out, 10) / 1000 * 10) / 10;
  } catch { /* fall through */ }
  return null;
}

/** Get CPU stats. */
export function getCpuStats(): CpuStats {
  return cached('cpu', () => {
    const cpus = os.cpus();
    return {
      model: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
      usagePercent: getCpuUsageSync(),
      temperature: getCpuTempSync(),
      speed: cpus[0]?.speed || 0,
    };
  });
}

/** Get RAM statistics. */
export function getRamStats(): RamStats {
  return cached('ram', () => {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;

    const toGB = (b: number) => Math.round((b / 1073741824) * 100) / 100;
    const swapTotal = os.totalmem() * 0.25; // estimate
    const swapUsed = 0;

    return {
      totalGB: toGB(totalBytes),
      usedGB: toGB(usedBytes),
      freeGB: toGB(freeBytes),
      percent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
      swapTotalGB: Math.round(swapTotal / 1073741824 * 100) / 100,
      swapUsedGB: swapUsed,
    };
  });
}

/** Get disk stats for all mounted volumes. */
export async function getDiskStats(): Promise<DiskVolume[]> {
  return cachedAsync('disks', async () => {
    try {
      if (process.platform === 'darwin') {
        const out = runSync('df -k / /System/Volumes/Data 2>/dev/null');
        const lines = out.split('\n').filter(l => l.trim() && !l.startsWith('Filesystem'));
        const seen = new Set<string>();
        const volumes: DiskVolume[] = [];

        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const mount = parts[5] || parts[8] || '';
          if (seen.has(mount) || !mount) continue;
          seen.add(mount);

          const total = (parseInt(parts[1], 10) || 0) / 1048576;
          const used = (parseInt(parts[2], 10) || 0) / 1048576;
          const free = (parseInt(parts[3], 10) || 0) / 1048576;

          volumes.push({
            fs: parts[0] || '',
            mount,
            type: 'local',
            totalGB: Math.round(total * 10) / 10,
            usedGB: Math.round(used * 10) / 10,
            freeGB: Math.round(free * 10) / 10,
            percent: total > 0 ? Math.round((used / total) * 100) : 0,
          });
        }
        return volumes;
      }

      // Linux / other
      const out = runSync('df -k --output=source,fstype,size,used,avail,target 2>/dev/null | grep -E "^/dev/"');
      const lines = out.split('\n').filter(Boolean);
      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        const total = (parseInt(parts[2], 10) || 0) / 1048576;
        const used = (parseInt(parts[3], 10) || 0) / 1048576;
        const free = (parseInt(parts[4], 10) || 0) / 1048576;
        return {
          fs: parts[0],
          mount: parts[5],
          type: parts[1],
          totalGB: Math.round(total * 10) / 10,
          usedGB: Math.round(used * 10) / 10,
          freeGB: Math.round(free * 10) / 10,
          percent: total > 0 ? Math.round((used / total) * 100) : 0,
        };
      });
    } catch {
      return [];
    }
  });
}

/** Get GPU stats. */
export async function getGpuStats(): Promise<GpuStats[]> {
  return cachedAsync('gpu', async () => {
    try {
      if (process.platform === 'darwin') {
        const out = runSync('system_profiler SPDisplaysDataType 2>/dev/null');
        const nameMatch = out.match(/Chipset Model:\s+(.+)/);
        const vramMatch = out.match(/VRAM.*?:\s+(\d+)\s+MB/);
        return [{
          name: nameMatch?.[1]?.trim() || 'Integrated GPU',
          usagePercent: null,
          memoryTotalMB: vramMatch ? parseInt(vramMatch[1], 10) : null,
          memoryUsedMB: null,
        }];
      }

      if (process.platform === 'linux') {
        const out = runSync('nvidia-smi --query-gpu=name,utilization.gpu,memory.total,memory.used --format=csv,noheader,nounits 2>/dev/null');
        if (out) {
          return out.split('\n').filter(Boolean).map(line => {
            const parts = line.split(',').map(s => s.trim());
            return {
              name: parts[0] || 'NVIDIA GPU',
              usagePercent: parseInt(parts[1], 10) || null,
              memoryTotalMB: parseInt(parts[2], 10) || null,
              memoryUsedMB: parseInt(parts[3], 10) || null,
            };
          });
        }
      }

      return [{ name: 'Unknown GPU', usagePercent: null, memoryTotalMB: null, memoryUsedMB: null }];
    } catch {
      return [{ name: 'Unknown GPU', usagePercent: null, memoryTotalMB: null, memoryUsedMB: null }];
    }
  });
}

/** Get fan speeds if available. */
export async function getFanSpeed(): Promise<FanInfo[]> {
  return cachedAsync('fans', async () => {
    try {
      if (process.platform === 'darwin') {
        const out = runSync('system_profiler SPPowerDataType 2>/dev/null');
        const fans: FanInfo[] = [];
        const fanMatches = out.matchAll(/Fan \d+:\s*\n\s*Current Speed:\s*(\d+)\s*rpm/gi);
        for (const match of fanMatches) {
          fans.push({ label: `Fan ${fans.length + 1}`, rpm: parseInt(match[1], 10) });
        }
        return fans;
      }

      if (process.platform === 'linux') {
        const out = runSync('cat /sys/class/hwmon/hwmon*/fan*_input 2>/dev/null');
        if (out) {
          return out.split('\n').filter(Boolean).map((rpm, i) => ({
            label: `Fan ${i + 1}`,
            rpm: parseInt(rpm, 10) || 0,
          }));
        }
      }
    } catch { /* fall through */ }
    return [];
  });
}

/** Get battery stats. */
function getBatterySync(): { percent: number | null; charging: boolean } {
  return cached('battery', () => {
    try {
      if (process.platform === 'darwin') {
        const out = runSync('pmset -g batt');
        const pctMatch = out.match(/(\d+)%/);
        return {
          percent: pctMatch ? parseInt(pctMatch[1], 10) : null,
          charging: out.includes('charging') || out.includes('AC Power'),
        };
      }

      if (process.platform === 'linux') {
        const pct = runSync('cat /sys/class/power_supply/BAT0/capacity 2>/dev/null');
        const status = runSync('cat /sys/class/power_supply/BAT0/status 2>/dev/null');
        return {
          percent: pct ? parseInt(pct, 10) : null,
          charging: status.toLowerCase().includes('charging'),
        };
      }
    } catch { /* fall through */ }
    return { percent: null, charging: false };
  });
}

/** Get a full system report combining all stats. */
export async function getFullSystemReport(): Promise<SystemReport> {
  const [disks, gpu, fans] = await Promise.all([
    getDiskStats(),
    getGpuStats(),
    getFanSpeed(),
  ]);

  return {
    cpu: getCpuStats(),
    ram: getRamStats(),
    disks,
    gpu,
    fans,
    battery: getBatterySync(),
    uptime: os.uptime(),
    platform: `${os.platform()} ${os.release()}`,
    hostname: os.hostname(),
  };
}
