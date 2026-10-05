/**
 * Applying to a job — runs after the user approves a prepared job, or from
 * autopilot.
 *
 * Opens the application in the user's own GhostForge browser profile (so
 * sign-ins to LinkedIn, Workday or career sites persist) and hands the page to
 * the form agent (./agent.ts), which fills every step, uploads the CV and cover
 * letter, and answers questions only from the CV/profile.
 *
 * Submit is pressed only when `allowSubmit` is set (the user approved this job,
 * or autopilot's mode allows this site) and everything required is answered.
 * Captchas, sign-in walls and questions it can't answer truthfully come back as
 * `needs_user`, with the open questions listed.
 */
import { mkdir, writeFile } from 'fs/promises'
import { isIP } from 'net'
import { join } from 'path'
import type { BrowserContext } from 'playwright-core'
import type { JobProfile, JobRecord } from './store'
import { userDir } from './store'
import { runFormAgent, type AgentContext, type AgentOutcome } from './agent'

export interface ApplyResult {
  status: 'submitted' | 'needs_user' | 'failed'
  message: string
  filled: string[]
  missing: string[]
}

/** ATSes whose forms can be completed and submitted unattended */
export const AUTO_SUBMIT_ATS = new Set(['lever', 'greenhouse', 'ashby'])

// Visible browsers left open for the user to finish, one per user (also keeps them from being collected).
// The profile directory can only be open once, so later runs share this window instead of failing to launch.
const leftOpen = new Map<string, BrowserContext>()

/**
 * Apply URLs come from third-party job boards. Only open public http(s)
 * pages — never localhost, the LAN, or other schemes a hostile listing
 * could use to point the browser at this machine.
 */
export function isSafeApplyUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  // IPv6 literals only — the old check also rejected real hostnames such as
  // fcbarcelona.com, fdic.gov or fe80-careers.com because they start with fc/fd/fe80.
  if (host.includes(':') && (host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host))) return false
  if (isIP(host) && isPrivateAddress(host)) return false
  return true
}

/** Loopback, private, link-local, CGNAT and unspecified addresses (v4 and v6) */
export function isPrivateAddress(ip: string): boolean {
  const a = ip.toLowerCase()
  if (a.includes(':')) {
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    // The same mapped address as URL parsers write it: ::ffff:7f00:1 = 127.0.0.1
    const hex = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex) {
      const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)]
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
    }
    return a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || /^fe[89ab]/.test(a)
  }
  const [p, q] = a.split('.').map(Number)
  return p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31)
    || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127)
}

/**
 * The hostname check above only sees the name. Resolve every A/AAAA record so
 * a public-looking name that points at this machine or the LAN is rejected too.
 */
export async function resolvesPublicly(raw: string, lookup = async (host: string) => {
  const { lookup: dnsLookup } = await import('dns/promises')
  return (await dnsLookup(host, { all: true })).map(r => r.address)
}): Promise<boolean> {
  if (!isSafeApplyUrl(raw)) return false
  try {
    const addresses = await lookup(new URL(raw).hostname.replace(/^\[|\]$/g, ''))
    return addresses.length > 0 && !addresses.some(isPrivateAddress)
  } catch {
    return false
  }
}

function formUrl(job: JobRecord): string {
  if (job.ats === 'lever') return job.applyUrl.endsWith('/apply') ? job.applyUrl : `${job.applyUrl.replace(/\/$/, '')}/apply`
  if (job.ats === 'ashby' && !/\/application\/?$/.test(job.applyUrl)) return `${job.applyUrl.replace(/\/$/, '')}/application`
  return job.applyUrl || job.url
}

/** Browser executable / channel options (Chrome, Edge or Chromium, or JOB_HUNTER_BROWSER). */
async function browserChoices(): Promise<Array<{ executablePath?: string; channel?: string }>> {
  const executablePath = process.env.JOB_HUNTER_BROWSER
  return executablePath ? [{ executablePath }] : [{ channel: 'chrome' }, { channel: 'msedge' }, { channel: 'chromium' }, {}]
}

// One browser profile per user, used by one application at a time.
const profileLocks = new Map<string, Promise<unknown>>()
export function withProfileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = profileLocks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  profileLocks.set(key, run.catch(() => {}))
  return run
}

/** Open the user's browser profile, run `fn`, close it — one at a time per user. */
export function withProfile<T>(username: string, headless: boolean, fn: (context: Awaited<ReturnType<typeof launchProfile>>) => Promise<T>): Promise<T> {
  return withProfileLock(username, async () => {
    const context = await launchProfile(username, headless)
    try { return await fn(context) } finally { await context.close().catch(() => {}) }
  })
}

/**
 * The user's own persistent browser profile (~/.ghostforge/jobs/<user>/browser),
 * so sign-ins to LinkedIn, Workday or a career site survive between runs.
 */
export async function launchProfile(username: string, headless: boolean): Promise<BrowserContext> {
  const open = leftOpen.get(username)
  if (open) return shareOpenWindow(open)
  const { chromium } = await import('playwright-core')
  const dir = join(userDir(username), 'browser')
  await mkdir(dir, { recursive: true })
  let lastError: unknown
  for (const choice of await browserChoices()) {
    try {
      return await chromium.launchPersistentContext(dir, { ...choice, headless, viewport: { width: 1280, height: 900 } })
    } catch (e) {
      lastError = e
    }
  }
  throw new Error(`No Chrome or Edge found for applying (set JOB_HUNTER_BROWSER to a browser path). ${String(lastError).slice(0, 120)}`)
}

/**
 * A view of the window the user is finishing: work happens in new tabs, and
 * close() closes only those tabs, never the user's own.
 */
function shareOpenWindow(context: BrowserContext): BrowserContext {
  const theirs = new Set(context.pages())
  const ours = () => context.pages().filter(p => !theirs.has(p))
  return new Proxy(context, {
    get(target, prop) {
      if (prop === 'close') return async () => { for (const p of ours()) await p.close().catch(() => {}) }
      if (prop === 'pages') return ours
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** Keep a visible window open for the user to finish (one per user). */
function keepOpen(username: string, context: BrowserContext) {
  if (leftOpen.has(username)) return // a tab in the window already kept open: leave it there for the user
  leftOpen.set(username, context)
  context.on('close', () => { if (leftOpen.get(username) === context) leftOpen.delete(username) })
}

export interface ApplyOptions {
  headless?: boolean
  /** Press the final Submit when the form is complete */
  allowSubmit?: boolean
  /** LinkedIn Easy Apply is allowed for this run */
  linkedin?: boolean
  generate?: AgentContext['generate']
  vision?: AgentContext['vision']
  log?: (msg: string) => void
}

export async function applyToJob(job: JobRecord, profile: JobProfile, username: string, opts: ApplyOptions = {}): Promise<ApplyResult & { questions?: AgentOutcome['questions']; aiAnswers?: AgentOutcome['aiAnswers'] }> {
  const target = formUrl(job)
  if (!(await resolvesPublicly(target))) {
    return { status: 'failed', message: 'This listing\'s application link is not a public web address, so it was not opened.', filled: [], missing: [] }
  }
  if (job.ats === 'linkedin' && !opts.linkedin) {
    return { status: 'needs_user', message: 'LinkedIn job: turn on "Apply on LinkedIn (Easy Apply)" under Autopilot and connect LinkedIn, or apply yourself. Your answers are in the Review panel.', filled: [], missing: [] }
  }
  const headless = opts.headless ?? process.env.JOB_HUNTER_HEADLESS === '1'

  return withProfileLock(username, async () => {
    const context = await launchProfile(username, headless)
    const page = context.pages()[0] || await context.newPage()
    const finish = (result: ApplyResult & { questions?: AgentOutcome['questions']; aiAnswers?: AgentOutcome['aiAnswers'] }) => {
      // Visible browser + something left for the user: leave it open for them.
      if (!headless && result.status === 'needs_user') keepOpen(username, context)
      else void context.close().catch(() => {})
      return result
    }
    try {
      const nav = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      // Defence against DNS rebinding: the pre-navigation lookup in resolvesPublicly()
      // and the browser's own resolution can differ. Verify the IP the browser
      // actually connected to (this is also the post-redirect host) is public.
      const serverIp = (await nav?.serverAddr())?.ipAddress
      if (serverIp && isPrivateAddress(serverIp)) {
        return finish({ status: 'failed', message: 'This listing\'s application link resolved to a private address, so it was not used.', filled: [], missing: [] })
      }

      const docsDir = join(userDir(username), 'applications', job.id)
      await mkdir(docsDir, { recursive: true })
      let coverPath = ''
      if (job.coverLetter) {
        coverPath = join(docsDir, 'cover-letter.txt')
        await writeFile(coverPath, job.coverLetter, 'utf8')
      }

      const out = await runFormAgent(page, {
        profile, job, coverPath,
        generate: opts.generate ?? null,
        vision: opts.vision ?? null,
        allowSubmit: opts.allowSubmit ?? AUTO_SUBMIT_ATS.has(job.ats),
        log: opts.log,
      })
      return finish({ status: out.status, message: out.message, filled: out.filled, missing: out.missing, questions: out.questions, aiAnswers: out.aiAnswers })
    } catch (e) {
      return finish({ status: 'failed', message: `Applying failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`, filled: [], missing: [] })
    }
  })
}
