/**
 * How other devices can reach this GhostForge server.
 *
 *  - Same Wi-Fi / LAN: the server listens on 0.0.0.0 (server.js), so any of the
 *    machine's private IPv4 addresses works.
 *  - Anywhere, privately: Tailscale. When the machine is on a tailnet its
 *    100.x address (and MagicDNS name) is listed; nothing is exposed publicly.
 *  - Anywhere, by public link: a Cloudflare quick tunnel (`cloudflared`), started
 *    and stopped from the Remote page. The GhostForge login still protects it.
 *
 * Works on Windows, macOS and Linux (no `ipconfig getifaddr`).
 */
import { execFile, spawn, type ChildProcess } from 'child_process'
import { networkInterfaces } from 'os'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface Address { address: string; iface: string; kind: 'lan' | 'tailscale' | 'other' }

const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
const isTailscale = (ip: string) => {
  const [a, b] = ip.split('.').map(Number)
  return a === 100 && b >= 64 && b <= 127
}

/** Non-loopback IPv4 addresses, LAN and Tailscale first. */
export function listAddresses(): Address[] {
  const out: Address[] = []
  for (const [iface, entries] of Object.entries(networkInterfaces())) {
    for (const e of entries || []) {
      if (e.family !== 'IPv4' || e.internal) continue
      out.push({ address: e.address, iface, kind: isTailscale(e.address) ? 'tailscale' : isPrivate(e.address) ? 'lan' : 'other' })
    }
  }
  const rank = { lan: 0, tailscale: 1, other: 2 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind])
}

/** Tailscale's MagicDNS name for this machine, when Tailscale is installed and up. */
export async function tailscaleName(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], { timeout: 3000, windowsHide: true })
    const name = (JSON.parse(stdout) as { Self?: { DNSName?: string } }).Self?.DNSName
    return name ? name.replace(/\.$/, '') : null
  } catch {
    return null
  }
}

// ── Cloudflare quick tunnel ─────────────────────────────────────────────────

let tunnel: { child: ChildProcess; url: string | null; startedAt: string; error?: string } | null = null

export function tunnelStatus() {
  return tunnel ? { running: true, url: tunnel.url, startedAt: tunnel.startedAt, error: tunnel.error } : { running: false, url: null }
}

/**
 * Start `cloudflared tunnel --url <local>` and resolve with the public
 * https://*.trycloudflare.com address once cloudflared prints it.
 */
export function startTunnel(localUrl: string): Promise<ReturnType<typeof tunnelStatus>> {
  if (tunnel?.url) return Promise.resolve(tunnelStatus())
  return new Promise(resolve => {
    let child: ChildProcess
    try {
      // --no-tls-verify: the local server uses a mkcert certificate cloudflared does not trust.
      child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', localUrl, ...(localUrl.startsWith('https:') ? ['--no-tls-verify'] : [])], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ running: false, url: null, error: `cloudflared could not start: ${e instanceof Error ? e.message : e}` } as never)
      return
    }
    tunnel = { child, url: null, startedAt: new Date().toISOString() }
    const timer = setTimeout(() => resolve(tunnelStatus()), 20_000)
    const onData = (chunk: Buffer) => {
      const m = chunk.toString('utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (m && tunnel && !tunnel.url) {
        tunnel.url = m[0]
        clearTimeout(timer)
        resolve(tunnelStatus())
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', e => {
      clearTimeout(timer)
      const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
      tunnel = null
      resolve({ running: false, url: null, error: missing ? 'cloudflared is not installed. Install it (winget install Cloudflare.cloudflared / brew install cloudflared) or use Tailscale.' : e.message } as never)
    })
    child.on('exit', () => { if (tunnel?.child === child) tunnel = null })
  })
}

export function stopTunnel(): void {
  tunnel?.child.kill()
  tunnel = null
}
