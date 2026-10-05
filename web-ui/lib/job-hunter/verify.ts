/**
 * Real jobs only: screening every listing a search returns, and a lazy "is it
 * still open?" check before a job is prepared or applied to.
 *
 * Screening (cheap, runs on every listing, no network):
 *   - drops listings without a usable public apply link
 *   - drops postings older than `maxAgeDays` (default 30) when a date is known
 *   - scores scam signals: fees or deposits, Telegram/WhatsApp contact, pay in
 *     crypto or gift cards, "no experience, $5,000/week", unrealistic salary,
 *     personal-email-only contact, a shortener or chat link as the apply link,
 *     an ATS board that belongs to a different company. Strong evidence drops
 *     the listing; some evidence flags it (it is shown with a warning and
 *     autopilot never touches it).
 *   - listings read from a company's own ATS API count as verified.
 *
 * Live check (network, one job at a time, only for jobs being prepared or
 * applied to — never for whole search results): the posting must still
 * exist (not 404/410, not "no longer accepting applications"). Greenhouse and
 * Lever postings are checked through their public APIs.
 */
import { isSafeApplyUrl } from './apply'
import { CLOSED_POSTING, detectAts, pageHeadline, stripHtml, type RawJob } from './sources'
import { getJob, updateJob, type JobRecord, type Verification } from './store'

export const DEFAULT_MAX_AGE_DAYS = 30
/** A live check is trusted for this long before it is repeated */
export const VERIFIED_FOR_MS = 24 * 3_600_000

type Listing = Pick<RawJob, 'title' | 'company' | 'description' | 'salary' | 'url' | 'applyUrl' | 'postedAt' | 'trust' | 'ats'> & { fromBoardApi?: boolean; boardUnconfirmed?: boolean }

const STRONG: Array<[RegExp, string]> = [
  [/\b(application|registration|training|processing|onboarding|placement|interview) (fee|deposit|charge)s?\b|\bupfront (payment|fee|cost)\b|\brefundable deposit\b|\bpay (a |the |for (your |the )?)?(fee|training|starter kit)\b|\b(purchase|buy) (your own )?(equipment|software|starter kit|checks?)\b[^.\n]{0,40}\b(reimburs|refund)|\b(send|wire|transfer) (us )?(money|payment|funds)\b/gi, 'asks the applicant for money (fees, deposits or equipment purchases)'],
  [/\b(contact|text|message|reach out to|reach|dm|add)( us| me| the recruiter| hr| our hiring manager)?\b[^.\n]{0,25}\b(on|via|through|at|using) (telegram|whatsapp|wechat|kik)\b|\binterviews? (will be |are )?(conducted |held |done )?(on|via|through|over) (telegram|whatsapp|wechat|kik|google hangouts)\b|\b(telegram|whatsapp)\b[^.\n]{0,25}(@[a-z0-9_]{4,}|\+\d[\d ]{6,}|\bhandle\b)/gi, 'contact only through Telegram/WhatsApp-style chat apps'],
  [/\b(paid|payment|salary|compensation|pay|wages?)\b[^.\n]{0,30}\b(bitcoin|btc|usdt|tether|gift ?cards?)\b/gi, 'pays in crypto or gift cards'],
  [/no (prior )?experience (is )?(required|needed|necessary)[^\n]{0,120}\$\s?\d[\d,]{3,}\s*(\/|per|a|every)\s*(day|week)|\$\s?\d[\d,]{3,}\s*(\/|per|a|every)\s*(day|week)[^\n]{0,120}no (prior )?experience/gi, '"no experience" with an implausible weekly or daily pay'],
  [/\bearn (up to )?\$\s?\d[\d,]{3,}\s*(\/|per|a|every)\s*(day|week)\b|\bwork from home and earn\b|\bbe your own boss\b/gi, 'get-rich-quick wording'],
]

/** Anti-scam disclaimers ("we never charge an application fee") are not signals */
const NEGATION = /\b(never|not|no|don'?t|won'?t|will not|do not|does not|doesn'?t|without|free of|beware|scam|fraud)\b/i

function hasUnnegated(re: RegExp, text: string): boolean {
  re.lastIndex = 0
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 50), m.index)
    if (!NEGATION.test(before.split(/[.!?\n]/).pop() || '')) return true
  }
  return false
}

const PERSONAL_EMAIL = /\b[a-z0-9._%+-]+@(gmail|googlemail|yahoo|hotmail|outlook|live|aol|icloud|proton|protonmail|gmx|yandex|mail)\.[a-z.]{2,6}\b/i
const CHAT_LINK = /^(t\.me|telegram\.me|wa\.me|chat\.whatsapp\.com|api\.whatsapp\.com)$/
const SHORT_OR_FORM = /^(bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|cutt\.ly|rb\.gy|forms\.gle|shorturl\.at)$/
/** Currencies whose normal yearly salaries run into the millions */
/** Salaries in these units are judged against the $1M sanity line; other currencies are not (millions are normal in JPY, INR, KRW…) */
const STRONG_CURRENCY = /[$€£]|\b(usd|eur|gbp|chf|cad|aud|nzd|sgd)\b/i

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const compact = (s: string) => norm(s).replace(/\b(inc|llc|ltd|limited|gmbh|ag|corp|corporation|co|company|group|labs?|technologies|hq|careers?|jobs?)\b/g, '').replace(/\s+/g, '')

/** The company's board name inside an ATS URL (jobs.lever.co/<slug>, <slug>.recruitee.com…) */
export function atsBoardSlug(url: string): string {
  let u: URL
  try { u = new URL(url) } catch { return '' }
  const ats = detectAts(url)
  const first = u.pathname.split('/').filter(Boolean)[0] || ''
  const sub = u.hostname.split('.')[0]
  switch (ats) {
    case 'greenhouse': return u.searchParams.get('for') || (first === 'embed' ? '' : first)
    case 'lever': case 'ashby': return first
    case 'workable': return sub === 'apply' ? first : sub
    case 'smartrecruiters': return sub === 'jobs' || sub === 'careers' ? first : ''
    case 'recruitee': case 'bamboohr': case 'teamtailor': return sub
    default: return ''
  }
}

/** Does an ATS board name plausibly belong to the company? */
export function boardMatchesCompany(slug: string, company: string): boolean {
  const s = compact(slug), c = compact(company)
  if (!s || !c) return true
  if (s.includes(c) || c.includes(s)) return true
  const words = norm(company).split(' ').filter(w => w.length >= 3)
  return words.some(w => s.includes(w)) || (s.length >= 3 && c.startsWith(s.slice(0, 4)))
}

/** Highest amount in a salary string; "k" counts as thousands only as a standalone suffix (not "kr", "Kč", "KES") */
export function salaryTop(s: string): number | null {
  const nums = [...String(s || '').toLowerCase().matchAll(/(\d[\d,.]*)\s*(k(?!\p{L}))?/gu)]
    .map(m => parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1)).filter(n => n >= 1000)
  return nums.length ? Math.max(...nums) : null
}

/** Scam / fake-listing signals with a weight: 2 = strong, 1 = suspicious. */
export function scamSignals(job: Listing): Array<{ weight: number; reason: string }> {
  const text = `${job.title}\n${stripHtml(job.description)}`
  const out: Array<{ weight: number; reason: string }> = []
  for (const [re, reason] of STRONG) if (hasUnnegated(re, text)) out.push({ weight: 2, reason })

  const top = salaryTop(job.salary)
  // Only when the currency is known to be a strong one, or no currency is named at all
  const namedCurrency = /\p{L}{2,}|[¥₹₩₫]/u.test(job.salary.replace(/\b(k|per|year|yr|annual|annually|a|to|and|month|mo|hour|hr|week|day)\b/gi, ''))
  if (top !== null && top > 1_000_000 && (STRONG_CURRENCY.test(job.salary) || !namedCurrency)) out.push({ weight: 2, reason: `unrealistic salary (${job.salary})` })

  let host = ''
  try { host = new URL(job.applyUrl || job.url).hostname.toLowerCase().replace(/^www\./, '') } catch { /* invalid: dropped elsewhere */ }
  if (CHAT_LINK.test(host)) out.push({ weight: 2, reason: 'the apply link is a chat app' })
  else if (SHORT_OR_FORM.test(host) || /^docs\.google\.com$/.test(host)) out.push({ weight: 1, reason: 'the apply link is a URL shortener or a generic form' })

  // A personal mailbox as the way to apply, when there is no real application form
  if (PERSONAL_EMAIL.test(text) && detectAts(job.applyUrl || job.url) === 'other' && job.trust !== 'official') {
    out.push({ weight: 1, reason: 'asks you to apply to a personal email address' })
  }
  // A company's job hosted on someone else's ATS board
  const slug = atsBoardSlug(job.applyUrl || job.url)
  if (slug && job.trust !== 'official' && !boardMatchesCompany(slug, job.company)) {
    out.push({ weight: 1, reason: `the application is on "${slug}"'s job board, not ${job.company}'s` })
  }
  if (/^(confidential|private|undisclosed|hidden|n\/?a|unknown)( company| employer)?$/i.test(job.company.trim())) {
    out.push({ weight: 1, reason: 'the employer is not named' })
  }
  return out
}

/** Age of a posting in days, or null when the source gave no usable date */
export function postingAgeDays(postedAt: string, now = Date.now()): number | null {
  const t = Date.parse(postedAt || '')
  if (!Number.isFinite(t)) return null
  return (now - t) / 86_400_000
}

export interface Screened { drop: 'stale' | 'invalid' | 'scam' | null; verification: Verification }

/** Decide whether a listing is kept, and how far it is trusted. */
export function screenListing(job: Listing, opts: { now?: number; maxAgeDays?: number } = {}): Screened {
  const now = opts.now ?? Date.now()
  const maxAge = opts.maxAgeDays && opts.maxAgeDays > 0 ? opts.maxAgeDays : DEFAULT_MAX_AGE_DAYS
  const link = job.applyUrl || job.url
  if (!job.title?.trim() || !job.company?.trim() || !link || !isSafeApplyUrl(link)) {
    return { drop: 'invalid', verification: { status: 'unverified', flags: ['no usable public apply link'] } }
  }
  const age = postingAgeDays(job.postedAt, now)
  // Postings read from a company's own ATS API are open by definition (evergreen roles stay listed)
  if (age !== null && age > maxAge && job.trust !== 'official' && !job.fromBoardApi) {
    return { drop: 'stale', verification: { status: 'closed', flags: [`posted ${Math.round(age)} days ago`] } }
  }
  const signals = scamSignals(job)
  const score = signals.reduce((n, s) => n + s.weight, 0)
  const flags = signals.map(s => s.reason)
  if (score >= 4) return { drop: 'scam', verification: { status: 'flagged', flags } }
  if (score >= 2) return { drop: null, verification: { status: 'flagged', flags } }
  if (job.trust === 'official') {
    return { drop: null, verification: { status: 'verified', flags: [...flags, 'read from the company\'s own job board API'], checkedAt: new Date(now).toISOString(), live: 'live' } }
  }
  if (job.boardUnconfirmed) flags.push('found by company name on an ATS board: confirm it is the right company (enter it as "ats:name") before autopilot may apply')
  return { drop: null, verification: { status: 'unverified', flags } }
}

export interface ScreenReport { stale: number; invalid: number; scam: number; flagged: number }

/** Screen a batch: drop stale, invalid and clear scams; attach a verification to the rest. */
export function screenListings<T extends Listing>(jobs: T[], opts: { now?: number; maxAgeDays?: number } = {}): { kept: Array<T & { verification: Verification }>; dropped: ScreenReport } {
  const dropped: ScreenReport = { stale: 0, invalid: 0, scam: 0, flagged: 0 }
  const kept: Array<T & { verification: Verification }> = []
  for (const job of jobs) {
    const s = screenListing(job, opts)
    if (s.drop) { dropped[s.drop]++; continue }
    if (s.verification.status === 'flagged') dropped.flagged++
    kept.push({ ...job, verification: s.verification })
  }
  return { kept, dropped }
}

// ── live check ───────────────────────────────────────────────────────────────

export type Fetcher = (url: string) => Promise<{ status: number; body: string; url: string }>
export type Liveness = 'live' | 'gone' | 'unknown'


/** Public API endpoint that answers 404 when a Greenhouse/Lever posting is gone. */
export function atsApiCheckUrl(job: Pick<JobRecord, 'url' | 'applyUrl' | 'ats'>): string | null {
  try {
    if (job.ats === 'greenhouse') {
      const u = new URL(job.applyUrl || job.url)
      const board = u.searchParams.get('for'), token = u.searchParams.get('token')
      if (board && token) return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(token)}`
      const m = new URL(job.url || job.applyUrl).pathname.match(/^\/([^/]+)\/jobs\/(\d+)/)
      if (m) return `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`
    }
    if (job.ats === 'lever') {
      const m = new URL(job.url || job.applyUrl).pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i)
      if (m) return `https://api.lever.co/v0/postings/${m[1]}/${m[2]}`
    }
  } catch { /* fall through */ }
  return null
}

const liveChecksOff = () => process.env.JOB_HUNTER_VERIFY_LIVE === '0' || process.env.NODE_ENV === 'test'

/** Is the posting still open? Never throws; anything inconclusive is "unknown". */
export async function checkLive(job: Pick<JobRecord, 'url' | 'applyUrl' | 'ats'>, fetcher?: Fetcher): Promise<{ live: Liveness; note: string }> {
  // LinkedIn answers plain HTTP clients with status 999; the form agent sees the real page.
  if (job.ats === 'linkedin') return { live: 'unknown', note: 'LinkedIn pages are checked in your browser when applying' }
  if (!fetcher && liveChecksOff()) return { live: 'unknown', note: 'live checks are off' }
  const get: Fetcher = fetcher ?? (async url => (await import('./intake')).fetchPublic(url, 600_000))
  const api = atsApiCheckUrl(job)
  const target = api || job.url || job.applyUrl
  try {
    const res = await get(target)
    if (res.status === 404 || res.status === 410) return { live: 'gone', note: `the posting returns ${res.status}` }
    if (res.status >= 200 && res.status < 300) {
      // An ATS API answering for the posting is the structured answer: it exists.
      // (Its description may well say "not available for sponsorship" — never parsed.)
      if (api) return { live: 'live', note: 'the job board API lists the posting' }
      if (/[?&]error=true\b/.test(res.url)) return { live: 'gone', note: 'the job board says the posting no longer exists' }
      if (CLOSED_POSTING.test(pageHeadline(res.body))) return { live: 'gone', note: 'the page says the job is closed' }
      return { live: 'live', note: 'the posting is online' }
    }
    return { live: 'unknown', note: `the site answered ${res.status}` }
  } catch (e) {
    return { live: 'unknown', note: `could not reach the posting (${String(e instanceof Error ? e.message : e).slice(0, 60)})` }
  }
}

/** Fold a live-check result into a job's verification. */
export function withLiveResult(job: Pick<JobRecord, 'ats' | 'trust' | 'verification'>, result: { live: Liveness; note: string }, now = Date.now()): Verification {
  const prev = job.verification
  const flags = [...(prev?.flags || []).filter(f => !/^(the posting|the page|the site|could not reach|live checks|LinkedIn pages|the job board|read from)/.test(f)), result.note]
  const checkedAt = new Date(now).toISOString()
  if (result.live === 'gone') return { status: 'closed', flags, checkedAt, live: 'gone' }
  if (prev?.status === 'flagged') return { status: 'flagged', flags, checkedAt, live: result.live }
  if (result.live === 'live') return { status: 'verified', flags, checkedAt, live: 'live' }
  // Inconclusive (bot wall, timeout, LinkedIn): a known ATS or LinkedIn page is
  // opened by the form agent anyway, which stops on a closed posting; any other
  // site stays unverified, so autopilot leaves it for you.
  const known = job.ats !== 'other'
  return { status: known ? 'verified' : 'unverified', flags, checkedAt, live: 'unknown' }
}

/** Verified recently enough to apply without checking again */
export function isFreshlyVerified(job: Pick<JobRecord, 'verification'>, now = Date.now()): boolean {
  const v = job.verification
  return v?.status === 'verified' && Boolean(v.checkedAt) && now - Date.parse(v.checkedAt!) < VERIFIED_FOR_MS
}

/**
 * Make sure a job is still open before spending work on it. Checks at most
 * once per VERIFIED_FOR_MS; closed and flagged jobs are returned as they are.
 */
export async function ensureVerified(username: string, id: string, opts: { fetcher?: Fetcher; now?: number } = {}): Promise<JobRecord | null> {
  const job = await getJob(username, id)
  if (!job) return null
  const now = opts.now ?? Date.now()
  // Verified and closed readings both hold for a day; a closed one is then checked again,
  // since a page can read as closed by mistake or only for a while.
  const v = job.verification
  if ((v?.status === 'verified' || v?.status === 'closed') && v.checkedAt && now - Date.parse(v.checkedAt) < VERIFIED_FOR_MS) return job
  const verification = withLiveResult(job, await checkLive(job, opts.fetcher), now)
  const changed = verification.status !== job.verification?.status
  return updateJob(username, id, { verification }, changed ? `Verification: ${verification.status} (${verification.flags[verification.flags.length - 1]})` : undefined)
}
