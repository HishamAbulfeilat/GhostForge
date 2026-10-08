/**
 * Getting jobs in besides search:
 *
 *  - addJobByUrl: paste any job link (LinkedIn, a company careers page, an ATS)
 *    and it is read, scored and queued like a search result.
 *  - connectLinkedIn: open the user's GhostForge browser profile on LinkedIn's
 *    sign-in page so they sign in once; later LinkedIn Easy Apply runs reuse it.
 *
 * Job details come from the page's own schema.org JobPosting data (most career
 * sites and LinkedIn's public job pages publish it), falling back to the title
 * and meta description. Only the one page the user pasted is read.
 */
import { auditLog } from '../audit'
import { isPrivateAddress, isSafeApplyUrl, launchProfile, resolvesPublicly, withProfile, withProfileLock } from './apply'
import { scoreJobs } from './match'
import { detectAts, stripHtml, type RawJob } from './sources'
import { getProfile, saveProfile, upsertJobs, listJobs, type JobRecord } from './store'

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>

interface Posting { title: string; company: string; location: string; remote: boolean; description: string; salary: string; postedAt: string; applyUrl: string }

/** Pull a JobPosting out of a page's HTML (JSON-LD first, then meta tags). */
export function parsePosting(html: string, url: string): Posting | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1])
  for (const raw of blocks) {
    let data: unknown
    try { data = JSON.parse(raw.trim()) } catch { continue }
    const items: unknown[] = Array.isArray(data) ? data : (data as { '@graph'?: unknown[] })['@graph'] || [data]
    for (const item of items) {
      const j = item as Record<string, unknown>
      if (!j || (j['@type'] !== 'JobPosting' && !(Array.isArray(j['@type']) && (j['@type'] as string[]).includes('JobPosting')))) continue
      const org = j.hiringOrganization as { name?: string } | undefined
      const locs = (Array.isArray(j.jobLocation) ? j.jobLocation : j.jobLocation ? [j.jobLocation] : []) as Array<{ address?: Record<string, string> }>
      const location = locs.map(l => [l.address?.addressLocality, l.address?.addressRegion, l.address?.addressCountry].filter(Boolean).join(', ')).filter(Boolean).join(' / ')
      const remote = j.jobLocationType === 'TELECOMMUTE' || /remote/i.test(location)
      const base = j.baseSalary as { currency?: string; value?: { minValue?: number; maxValue?: number; value?: number } } | undefined
      const salary = base?.value ? `${base.currency || ''} ${base.value.minValue ?? base.value.value ?? ''}${base.value.maxValue ? `-${base.value.maxValue}` : ''}`.trim() : ''
      return {
        title: String(j.title || '').trim(),
        company: String(org?.name || '').trim(),
        location: location || (remote ? 'Remote' : ''),
        remote,
        description: stripHtml(String(j.description || '')),
        salary,
        postedAt: String(j.datePosted || ''),
        applyUrl: url,
      }
    }
  }
  const meta = (name: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'))?.[1] || ''
  const title = meta('og:title') || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || ''
  if (!title.trim()) return null
  const site = meta('og:site_name')
  return { title: stripHtml(title).slice(0, 200), company: site, location: '', remote: false, description: stripHtml(meta('og:description') || meta('description')).slice(0, 4000), salary: '', postedAt: '', applyUrl: url }
}

/** "Senior Engineer at Acme" / "Acme hiring Senior Engineer in Berlin | LinkedIn" → parts. */
function splitTitle(p: Posting): Posting {
  if (p.company) return p
  const at = p.title.match(/^(.*?)\s+(?:at|@)\s+(.+?)(?:\s*[|·-].*)?$/i)
  if (at) return { ...p, title: at[1].trim(), company: at[2].trim() }
  const hiring = p.title.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+(.+?))?(?:\s*\|.*)?$/i)
  if (hiring) return { ...p, company: hiring[1].trim(), title: hiring[2].trim(), location: p.location || hiring[3]?.trim() || '' }
  return p
}

/**
 * GET a public page. Every hop (redirects included) must be a public http(s)
 * URL, and the address each connection is actually made to is checked at
 * connect time, so a redirect or a DNS answer that changes between checks
 * (rebinding) cannot reach this machine or the LAN.
 */
export async function fetchPublic(rawUrl: string, maxBytes = 2_000_000, hops = 5): Promise<{ status: number; body: string }> {
  const [{ request: httpRequest }, { request: httpsRequest }, { lookup }] = await Promise.all([import('http'), import('https'), import('dns')])
  const guardedLookup = (host: string, options: object, cb: (err: Error | null, address?: unknown, family?: number) => void) => {
    lookup(host, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err)
      const list = addresses as unknown as Array<{ address: string; family: number }>
      if (!list.length || list.some(a => isPrivateAddress(a.address))) return cb(new Error('Refusing a private network address'))
      cb(null, (options as { all?: boolean }).all ? list : list[0].address, list[0].family)
    })
  }
  let url = rawUrl
  for (let hop = 0; hop <= hops; hop++) {
    if (!isSafeApplyUrl(url)) throw new Error('That is not a public job link (http/https)')
    const target = new URL(url)
    const res = await new Promise<{ status: number; location?: string; body: string }>((resolve, reject) => {
      const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
        method: 'GET', lookup: guardedLookup as never, timeout: 15_000,
        headers: { 'User-Agent': 'Mozilla/5.0 GhostForge-JobHunter', Accept: 'text/html', 'Accept-Encoding': 'identity' },
      }, r => {
        const status = r.statusCode || 0
        if (status >= 300 && status < 400 && r.headers.location) { r.resume(); return resolve({ status, location: r.headers.location, body: '' }) }
        const chunks: Buffer[] = []
        let size = 0
        r.on('data', (c: Buffer) => { size += c.length; if (size <= maxBytes) chunks.push(c); else r.destroy() })
        r.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }))
        r.on('close', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }))
        r.on('error', reject)
      })
      req.on('timeout', () => req.destroy(new Error('Timed out')))
      req.on('error', reject)
      req.end()
    })
    if (!res.location) return { status: res.status, body: res.body }
    url = new URL(res.location, url).toString()
  }
  throw new Error('Too many redirects')
}

async function fetchHtml(url: string, username: string): Promise<string> {
  // LinkedIn answers plain HTTP clients with status 999; read it in the user's browser profile instead.
  if (detectAts(url) !== 'linkedin') {
    try {
      const res = await fetchPublic(url)
      if (res.status >= 200 && res.status < 300) return res.body
    } catch (e) {
      if (/private network/i.test(String(e))) throw new Error('That link leads to a private network address, so it was not opened')
      /* otherwise fall back to the browser */
    }
  }
  return withProfile(username, true, async context => {
    const page = context.pages()[0] || await context.newPage()
    const nav = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    // Same rebinding/redirect defence as applying: check where the browser really connected.
    const ip = (await nav?.serverAddr())?.ipAddress
    if ((ip && isPrivateAddress(ip)) || !isSafeApplyUrl(page.url())) throw new Error('That link leads to a private network address, so it was not opened')
    await page.waitForTimeout(1500)
    return page.content()
  })
}

/** Read a pasted job link, score it against the CV and add it to the queue. */
export async function addJobByUrl(username: string, rawUrl: string, generate: Generate | null): Promise<JobRecord> {
  const url = String(rawUrl || '').trim()
  if (!(await resolvesPublicly(url))) throw new Error('That is not a public job link (http/https)')
  const profile = await getProfile(username)
  if (!profile.cv) throw new Error('Upload your CV first')
  const posting = parsePosting(await fetchHtml(url, username), url)
  if (!posting?.title) throw new Error('Could not read a job from that page. Is it the job\'s own page?')
  const p = splitTitle(posting)
  const company = p.company || new URL(url).hostname.replace(/^www\./, '')
  const raw: RawJob = {
    key: `url|${url.replace(/[?#].*$/, '').toLowerCase()}`,
    source: 'Added by link', title: p.title, company, location: p.location, remote: p.remote, salary: p.salary,
    url, applyUrl: url, ats: detectAts(url), description: p.description, postedAt: p.postedAt,
  }
  const [score] = await scoreJobs([raw], profile, generate)
  await upsertJobs(username, [{ ...raw, ...score }])
  void auditLog({ level: 'info', event: 'job_added_by_url', params: { username, host: new URL(url).hostname } })
  const job = (await listJobs(username)).find(j => j.key === raw.key)
  if (!job) throw new Error('Could not save the job')
  return job
}

// ── LinkedIn sign-in ────────────────────────────────────────────────────────

let connecting = new Set<string>()

/** True when the user's browser profile holds a LinkedIn session cookie. */
async function hasLinkedInSession(username: string): Promise<boolean> {
  return withProfile(username, true, async context =>
    (await context.cookies('https://www.linkedin.com')).some(c => c.name === 'li_at' && c.value))
}

/**
 * Open LinkedIn's sign-in page in a visible GhostForge browser on this computer
 * (sign in there, or from your phone through Remote → Control this computer).
 * Resolves right away; the sign-in is detected in the background for 10 minutes.
 */
export async function connectLinkedIn(username: string): Promise<{ status: 'connected' | 'opened' | 'busy' }> {
  if (connecting.has(username)) return { status: 'busy' }
  if (await hasLinkedInSession(username).catch(() => false)) {
    await saveProfile(username, { linkedin: { connectedAt: new Date().toISOString(), checkedAt: new Date().toISOString() } })
    return { status: 'connected' }
  }
  connecting.add(username)
  // Hold the profile lock while the sign-in window is open (applications wait).
  let opened: () => void = () => {}
  const ready = new Promise<void>(r => { opened = r })
  void withProfileLock(username, async () => {
    const context = await launchProfile(username, false)
    try {
      const page = context.pages()[0] || await context.newPage()
      await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
      opened()
      const deadline = Date.now() + 10 * 60_000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 3000))
        const cookies = await context.cookies('https://www.linkedin.com').catch(() => [])
        if (cookies.some(c => c.name === 'li_at' && c.value)) {
          await saveProfile(username, { linkedin: { connectedAt: new Date().toISOString(), checkedAt: new Date().toISOString() } })
          void auditLog({ level: 'info', event: 'job_linkedin_connected', params: { username } })
          break
        }
        if (!context.pages().length) break // the user closed the window
      }
    } finally {
      opened()
      connecting.delete(username)
      if (connecting.size > 100) connecting = new Set()
      await context.close().catch(() => {})
    }
  }).catch(() => { opened(); connecting.delete(username) })
  await ready
  return { status: 'opened' }
}

/** Forget the LinkedIn sign-in (clears the cookies in the GhostForge browser profile). */
export async function disconnectLinkedIn(username: string): Promise<void> {
  await withProfile(username, true, async context => {
    const keep = (await context.cookies()).filter(c => !/linkedin\.com$/.test(c.domain.replace(/^\./, '')))
    await context.clearCookies()
    if (keep.length) await context.addCookies(keep)
  })
  await saveProfile(username, { linkedin: null })
}
