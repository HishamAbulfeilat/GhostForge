/**
 * Outbound-request guard for URLs a user typed (custom model endpoints).
 *
 * Reuses Job Hunter's DNS-aware checks (lib/job-hunter/apply.ts) so there is
 * one definition of "private address":
 *   - isSafePublicUrl: literal check of the URL (scheme, localhost names,
 *     private / loopback / link-local IP literals, v4 and v6)
 *   - resolvesPublicly: every A/AAAA record of the name must be public
 *   - publicRequest: the request itself resolves through a guarded lookup (so
 *     DNS rebinding between check and connect is refused) and never follows
 *     redirects, which could otherwise point back at the host
 */
import { isPrivateAddress, isSafeApplyUrl, resolvesPublicly as resolvesPubliclyImpl } from './job-hunter/apply'

export { isPrivateAddress }

/** Literal URL check; `httpsOnly` (the default) also refuses plain http. */
export function isSafePublicUrl(raw: string, { httpsOnly = true } = {}): boolean {
  if (!isSafeApplyUrl(raw)) return false
  return !httpsOnly || new URL(raw).protocol === 'https:'
}

/** Literal check plus DNS: no record of the host may be a private address. */
export async function resolvesPublicly(raw: string, lookup?: (host: string) => Promise<string[]>): Promise<boolean> {
  return isSafePublicUrl(raw, { httpsOnly: false }) && (lookup ? resolvesPubliclyImpl(raw, lookup) : resolvesPubliclyImpl(raw))
}

/** https + public DNS: what a hosted user's custom model URL must satisfy. */
export async function isPublicHttpsUrl(raw: string, lookup?: (host: string) => Promise<string[]>): Promise<boolean> {
  return isSafePublicUrl(raw) && resolvesPublicly(raw, lookup)
}

export class PrivateNetworkError extends Error {
  constructor(message = 'Refusing a private network address') { super(message) }
}

/**
 * dns.lookup replacement for http(s).request: refuses the connection when any
 * resolved address is private. Same approach as fetchPublic in
 * lib/job-hunter/intake.ts.
 */
type ResolveHost = (host: string) => Promise<Array<{ address: string; family: number }>>

async function guardedLookupFn(resolveHost?: ResolveHost, isBlocked: (ip: string) => boolean = isPrivateAddress) {
  const { lookup } = await import('dns')
  const resolve: ResolveHost = resolveHost || (host => new Promise((ok, fail) =>
    lookup(host, { all: true }, (err, addresses) => (err ? fail(err) : ok(addresses as Array<{ address: string; family: number }>)))))
  return (host: string, options: object, cb: (err: Error | null, address?: unknown, family?: number) => void) => {
    resolve(host).then(list => {
      if (!list.length || list.some(a => isBlocked(a.address))) return cb(new PrivateNetworkError())
      cb(null, (options as { all?: boolean }).all ? list : list[0].address, list[0].family)
    }, err => cb(err))
  }
}

export interface PublicResponse {
  status: number
  ok: boolean
  body: string
}

/**
 * One HTTP(S) request to a public address only: literal check, guarded DNS
 * at connect time, no redirects (a 3xx is an error), bounded body size.
 */
export async function publicRequest(rawUrl: string, init: {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBytes?: number
  httpsOnly?: boolean
  /** DNS resolver override (tests); defaults to dns.lookup */
  resolveHost?: ResolveHost
  /** Address filter override (tests); defaults to isPrivateAddress */
  isBlockedAddress?: (ip: string) => boolean
} = {}): Promise<PublicResponse> {
  if (!init.isBlockedAddress && !isSafePublicUrl(rawUrl, { httpsOnly: init.httpsOnly ?? true })) throw new PrivateNetworkError('Refusing a non-public URL')
  const target = new URL(rawUrl)
  const [{ request: httpRequest }, { request: httpsRequest }, lookup] = await Promise.all([import('http'), import('https'), guardedLookupFn(init.resolveHost, init.isBlockedAddress)])
  const maxBytes = init.maxBytes ?? 4_000_000
  return new Promise<PublicResponse>((resolve, reject) => {
    const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method: init.method || 'GET',
      headers: { 'Accept-Encoding': 'identity', ...(init.headers || {}) },
      lookup: lookup as never,
      timeout: init.timeoutMs ?? 120_000,
    }, res => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400) {
        res.resume()
        return reject(Object.assign(new Error(`Refusing to follow a redirect (HTTP ${status})`), { status }))
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => { size += c.length; if (size <= maxBytes) chunks.push(c); else res.destroy() })
      const done = () => resolve({ status, ok: status >= 200 && status < 300, body: Buffer.concat(chunks).toString('utf8') })
      res.on('end', done)
      res.on('close', done)
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('Timed out')))
    req.on('error', reject)
    if (init.body) req.write(init.body)
    req.end()
  })
}
