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
import { markdownToDocx } from './improve'
import { detectAts } from './sources'
import { trackApplicationPage, updateApplicationActivity } from './live'

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
interface OpenWindow {
  context: BrowserContext
  /** Background (headless) windows are closed after a while; nobody can close them by hand. */
  headless: boolean
  timer?: ReturnType<typeof setTimeout>
}
interface BrowserState {
  leftOpen: Map<string, OpenWindow>
  profileLocks: Map<string, Promise<unknown>>
}
// Next development reloads must not forget windows still owning profile locks.
const runtime = globalThis as typeof globalThis & { ghostforgeJobBrowserState?: BrowserState }
const browserState = runtime.ghostforgeJobBrowserState ??= {
  leftOpen: new Map<string, OpenWindow>(),
  profileLocks: new Map<string, Promise<unknown>>(),
}
const { leftOpen, profileLocks } = browserState

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

export function formUrl(job: Pick<JobRecord, 'ats' | 'applyUrl' | 'url'>): string {
  const raw = job.applyUrl?.trim() || job.url?.trim()
  const url = new URL(raw)
  // Only transform actual ATS hosts, not job-board redirects or attribution URLs.
  const ats = detectAts(url.href)
  const suffix = job.ats === ats && ats === 'lever' ? 'apply' : job.ats === ats && ats === 'ashby' ? 'application' : ''
  if (suffix && !url.pathname.replace(/\/+$/, '').endsWith(`/${suffix}`)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${suffix}`
  }
  return url.href
}

/**
 * Whether a visible browser window can be opened here. Linux/BSD servers
 * without an X11 or Wayland display (e.g. a cloud server) cannot; launching a
 * headed browser there throws.
 */
export function displayAvailable(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): boolean {
  if (platform === 'win32' || platform === 'darwin') return true
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
}

/**
 * Headless or visible for one application run. `requested` comes from the
 * "Allow control of this computer" setting (off = headless). Without a display
 * it is always headless; JOB_HUNTER_HEADLESS=1 forces headless everywhere.
 * Callers that pass nothing keep the old default (visible) unless
 * JOB_HUNTER_HEADLESS says otherwise.
 */
export function chooseHeadless(requested: boolean | undefined, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): boolean {
  if (!displayAvailable(env, platform)) return true
  if (env.JOB_HUNTER_HEADLESS === '1') return true
  return requested ?? false
}

const NO_DISPLAY = /without having a XServer|missing X server|\$DISPLAY|cannot open display|no display|ozone platform/i

/** Browser executable / channel options (Chrome, Edge or Chromium, or JOB_HUNTER_BROWSER). */
async function browserChoices(): Promise<Array<{ executablePath?: string; channel?: string }>> {
  const executablePath = process.env.JOB_HUNTER_BROWSER
  return executablePath ? [{ executablePath }] : [{ channel: 'chrome' }, { channel: 'msedge' }, { channel: 'chromium' }, {}]
}

// One browser profile per user, used by one application at a time.
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
  if (open) {
    // A background window kept for account sign-in can't be shown: a visible run replaces it.
    if (!headless && open.headless) await open.context.close().catch(() => {})
    else return shareOpenWindow(open.context)
  }
  const { chromium } = await import('playwright-core')
  const dir = join(userDir(username), 'browser')
  await mkdir(dir, { recursive: true })
  let lastError: unknown
  for (const choice of await browserChoices()) {
    try {
      return await chromium.launchPersistentContext(dir, { ...choice, headless, timeout: 20_000, viewport: { width: 1280, height: 900 } })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (/opening in existing browser session|processsingleton|singletonlock|profile.*(in use|locked)|user data directory.*in use/i.test(message)) {
        throw new Error('The Job Hunter browser profile is already open in another browser or server process. Close that Job Hunter window (not your normal browser), then retry Approve & apply. Do not run two GhostForge servers with the same user profile.')
      }
      if (!headless && NO_DISPLAY.test(message)) throw new Error(NO_DISPLAY_MESSAGE)
      lastError = e
    }
  }
  throw new Error(`Could not launch a browser for applying. Install Playwright Chromium with "npx playwright install chromium" in web-ui, or set JOB_HUNTER_BROWSER to a Chrome/Edge executable. Details: ${String(lastError).slice(0, 500)}`)
}

/** Added to a background run's hand-back: there is no window on screen to finish in. */
export function backgroundHint(display = displayAvailable()): string {
  return ` GhostForge ran this in a background browser, so no window opened on this screen. Use the account help and preview below, or open the application page yourself to finish${display ? '; turn on "Allow control of this computer" to get a visible window next time' : ''}.`
}

export const NO_DISPLAY_MESSAGE = 'This computer has no screen for a visible browser (no X11/Wayland display). Turn off "Allow control of this computer" so applications run in the background, or run GhostForge where a display is available.'

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

/** How long a background window stays open for account sign-in assistance and the live preview. */
export const BACKGROUND_WINDOW_MS = 45 * 60_000

/**
 * Keep the window open for the user to finish (one per user). A visible one
 * stays until the user closes it. A background (headless) one stays for a while
 * so the user can sign in through account assistance and watch the preview,
 * then closes by itself, because there is no window for them to close.
 */
function keepOpen(username: string, context: BrowserContext, headless: boolean) {
  const existing = leftOpen.get(username)
  if (existing) {
    // a tab in the window already kept open: leave it there for the user, and give a background window more time
    if (existing.headless) armBackgroundClose(username, existing)
    return
  }
  const entry: OpenWindow = { context, headless }
  leftOpen.set(username, entry)
  if (headless) armBackgroundClose(username, entry)
  context.on('close', () => {
    if (entry.timer) clearTimeout(entry.timer)
    if (leftOpen.get(username) === entry) leftOpen.delete(username)
  })
}

function armBackgroundClose(username: string, entry: OpenWindow) {
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    if (leftOpen.get(username) === entry) leftOpen.delete(username)
    void entry.context.close().catch(() => {})
  }, BACKGROUND_WINDOW_MS)
  entry.timer.unref?.()
}

export async function prepareApplicationFiles(job: JobRecord, profile: JobProfile, username: string): Promise<{ resumePath: string; coverPath: string }> {
  const docsDir = join(userDir(username), 'applications', job.id)
  await mkdir(docsDir, { recursive: true })
  let resumePath = profile.cv?.filePath || ''
  if (job.tailoredResume && !job.preparationWarning) {
    resumePath = join(docsDir, 'tailored-cv.docx')
    await writeFile(resumePath, await markdownToDocx(job.tailoredResume))
  }
  let coverPath = ''
  if (job.coverLetter) {
    coverPath = join(docsDir, 'cover-letter.txt')
    await writeFile(coverPath, job.coverLetter, 'utf8')
  }
  return { resumePath, coverPath }
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
  let target: string
  try { target = formUrl(job) } catch {
    return { status: 'failed', message: 'This listing has no valid application URL. Open the original posting or add the correct job link before retrying.', filled: [], missing: [] }
  }
  if (!(await resolvesPublicly(target))) {
    return { status: 'failed', message: 'This listing\'s application link is not a public web address, so it was not opened.', filled: [], missing: [] }
  }
  if (job.ats === 'linkedin' && !opts.linkedin) {
    return { status: 'needs_user', message: 'LinkedIn job: turn on "Apply on LinkedIn (Easy Apply)" under Autopilot and connect LinkedIn, or apply yourself. Your answers are in the Review panel.', filled: [], missing: [] }
  }
  const headless = chooseHeadless(opts.headless)

  return withProfileLock(username, async () => {
    updateApplicationActivity(username, job.id, 'Opening the application browser')
    const context = await launchProfile(username, headless)
    const finish = async (outcome: ApplyResult & { questions?: AgentOutcome['questions']; aiAnswers?: AgentOutcome['aiAnswers'] }) => {
      const result = headless && outcome.status === 'needs_user' ? { ...outcome, message: `${outcome.message}${backgroundHint()}` } : outcome
      updateApplicationActivity(username, job.id, result.message, result.status)
      // Something left for the user: leave the window open for them (a background
      // one only for a while, for account sign-in assistance and the preview).
      if (result.status === 'needs_user') keepOpen(username, context, headless)
      else await context.close().catch(error => {
        console.error('[Job Hunter] Could not close application browser:', error)
      })
      return result
    }
    try {
      const page = context.pages().find(candidate => candidate.url() === 'about:blank') || await context.newPage()
      trackApplicationPage(username, job.id, page)
      opts.log?.(`Opening application: ${target}`)
      if (!headless) await page.bringToFront()
      const nav = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      if (!isSafeApplyUrl(page.url()) || (nav && !nav.ok())) {
        return await finish({ status: 'failed', message: `The application page could not be opened${nav ? ` (HTTP ${nav.status()})` : ''}. Check the original posting and application link.`, filled: [], missing: [] })
      }
      // Defence against DNS rebinding: the pre-navigation lookup in resolvesPublicly()
      // and the browser's own resolution can differ. Verify the IP the browser
      // actually connected to (this is also the post-redirect host) is public.
      const serverIp = (await nav?.serverAddr())?.ipAddress
      if (serverIp && isPrivateAddress(serverIp)) {
        return await finish({ status: 'failed', message: 'This listing\'s application link resolved to a private address, so it was not used.', filled: [], missing: [] })
      }
      if (!headless) await page.bringToFront()
      for (const blank of context.pages().filter(candidate => candidate !== page && candidate.url() === 'about:blank')) {
        await blank.close()
      }

      const { resumePath, coverPath } = await prepareApplicationFiles(job, profile, username)

      const out = await runFormAgent(page, {
        profile, job, resumePath, coverPath,
        generate: opts.generate ?? null,
        vision: opts.vision ?? null,
        allowSubmit: opts.allowSubmit ?? AUTO_SUBMIT_ATS.has(job.ats),
        onPage: current => trackApplicationPage(username, job.id, current),
        log: message => {
          updateApplicationActivity(username, job.id, message)
          opts.log?.(message)
        },
      })
      return await finish({ status: out.status, message: out.message, filled: out.filled, missing: out.missing, questions: out.questions, aiAnswers: out.aiAnswers })
    } catch (e) {
      return await finish({ status: 'failed', message: `Applying failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`, filled: [], missing: [] })
    }
  })
}
