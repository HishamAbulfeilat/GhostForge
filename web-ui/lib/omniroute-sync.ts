/**
 * Register GhostForge's free-tier provider keys as OmniRoute connections, so
 * OmniRoute's `auto` routing can spread requests across real free providers
 * (a fresh OmniRoute has none, and its keyless sources often refuse outside
 * callers). Paid providers are never synced — `auto` could then spend money.
 *
 * Uses the `omniroute` CLI with the key on stdin (never argv).
 */
import { execFile } from 'child_process'
import { getProviderKey, omniRouteBaseURL, PROVIDERS, type ProviderId } from './providers'

/** GhostForge provider → OmniRoute catalog id (all marked "free" in OmniRoute) */
const FREE_TIER_CONNECTORS: Partial<Record<ProviderId, string>> = {
  google: 'gemini',
  groq: 'groq',
  openrouter: 'openrouter',
  nvidia: 'nvidia',
}

export interface SyncResult { provider: ProviderId; omniId: string; ok: boolean; message: string }

const CLI = process.platform === 'win32' ? 'omniroute.cmd' : 'omniroute'

/**
 * The Next.js server's own vars break the CLI (a separate Node app) — notably
 * PORT, which the CLI would use to find "its" server. Point it at OmniRoute.
 */
function cliEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'PORT' || k === 'HOSTNAME' || k === 'NODE_OPTIONS' || k === 'NODE_ENV' ||
      k.startsWith('__NEXT') || k.startsWith('NEXT_') || k.startsWith('TURBOPACK')) continue
    env[k] = v
  }
  env.OMNIROUTE_BASE_URL = omniRouteBaseURL().replace(/\/v1$/, '')
  return env
}

function runCli(args: string[], stdin?: string): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    const child = execFile(CLI, [...args, '--no-color'], {
      timeout: 60_000,
      windowsHide: true,
      env: cliEnv() as NodeJS.ProcessEnv, // NODE_ENV deliberately left out
      // .cmd shims need a shell on Windows; every arg is a fixed string from
      // this file (never user input) and the key itself goes via stdin
      shell: process.platform === 'win32',
    }, (error, stdout, stderr) => {
      resolve({ code: error ? 1 : 0, out: `${stdout}\n${stderr}` })
    })
    if (stdin !== undefined) child.stdin?.end(stdin)
  })
}

const clean = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/.*Loaded env.*\n?/g, '').trim()

export async function syncProviderToOmniRoute(provider: ProviderId): Promise<SyncResult | null> {
  const omniId = FREE_TIER_CONNECTORS[provider]
  if (!omniId) return null
  const key = getProviderKey(provider)
  const name = `ghostforge-${provider}`

  // Replace any previous GhostForge-managed connection (the key may have changed)
  await runCli(['providers', 'remove', name, '--yes'])
  if (!key) return { provider, omniId, ok: true, message: 'Key removed from OmniRoute' }

  const { code, out } = await runCli(['providers', 'add', omniId, '--name', name, '--credential-stdin', '--yes'], key)
  const ok = code === 0
  return {
    provider,
    omniId,
    ok,
    message: ok
      ? `${PROVIDERS[provider].name} connected to OmniRoute`
      : `OmniRoute sync failed: ${clean(out).split('\n').slice(-2).join(' ').slice(0, 200)}`,
  }
}

/** Sync every free-tier provider that has a key */
export async function syncFreeKeysToOmniRoute(): Promise<SyncResult[]> {
  const results: SyncResult[] = []
  for (const provider of Object.keys(FREE_TIER_CONNECTORS) as ProviderId[]) {
    if (!getProviderKey(provider)) continue
    const result = await syncProviderToOmniRoute(provider)
    if (result) results.push(result)
  }
  return results
}

export function isFreeTierSyncable(provider: ProviderId): boolean {
  return provider in FREE_TIER_CONNECTORS
}
