/**
 * Windows implementations for JARVIS tools that are macOS/Unix-only elsewhere.
 * Uses PowerShell CIM/WMI (async, short timeout); never spawns Unix tools.
 */
import { execFile } from 'child_process'

export function runPowerShell(script: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout.trim())),
    )
  })
}

export const clampPercent = (n: number): number => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 50)))

/** PowerShell that sets built-in display brightness (laptop panels; external monitors are unsupported). */
export function brightnessSetScript(level: number): string {
  return `Invoke-CimMethod -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=${clampPercent(level)}} | Out-Null`
}

export const BRIGHTNESS_GET_SCRIPT = '(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness'

export async function setBrightnessWindows(level: number): Promise<string> {
  const pct = clampPercent(level)
  try {
    await runPowerShell(brightnessSetScript(pct))
    return `Brightness set to ${pct}%`
  } catch {
    return 'Brightness control is not available on this display (external monitors do not expose it)'
  }
}

export async function getBrightnessWindows(): Promise<string> {
  try {
    const out = await runPowerShell(BRIGHTNESS_GET_SCRIPT)
    const n = parseInt(out, 10)
    return Number.isFinite(n) ? `Brightness: ${n}%` : 'Brightness detection is not available on this display'
  } catch {
    return 'Brightness detection is not available on this display'
  }
}

export async function getClipboardWindows(): Promise<string> {
  try {
    const text = await runPowerShell('Get-Clipboard -Raw', 3000)
    return text.slice(0, 500) || '(clipboard is empty)'
  } catch {
    return 'Could not read clipboard'
  }
}
