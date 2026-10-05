/**
 * Job sources. Each adapter returns normalized listings; matching, scoring,
 * validation (verify.ts) and de-duplication happen upstream.
 *
 * Only official, documented public APIs and feeds — nothing behind a login is
 * scraped, and LinkedIn itself is never scraped.
 *
 * No key needed:
 *   Remotive, RemoteOK, Arbeitnow, The Muse, Jobicy, Himalayas,
 *   We Work Remotely (RSS), Hacker News "Who is hiring" (Algolia HN API)
 *   Company boards (per company, see preferences.companies):
 *     Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee
 * With a free key (set in the environment, never in code):
 *   JSearch (RapidAPI)   LinkedIn, Indeed, Glassdoor… — JSEARCH_API_KEY or RAPIDAPI_KEY
 *   Adzuna               ADZUNA_APP_ID + ADZUNA_APP_KEY (ADZUNA_COUNTRY, default from your location)
 *   USAJobs              USAJOBS_API_KEY + USAJOBS_EMAIL
 *   Reed (UK)            REED_API_KEY
 *
 * Feed-wide responses are cached for an hour so several search terms (and
 * autopilot runs) don't hammer the same feed; every source fails soft.
 */
import { dedupeKey, type Ats, type JobPreferences, type Trust } from './store'

export interface RawJob {
  key: string
  source: string
  title: string
  company: string
  location: string
  remote: boolean
  salary: string
  url: string
  applyUrl: string
  ats: Ats
  description: string
  postedAt: string
  trust: Trust
}

const UA = { 'User-Agent': 'GhostForge-JobHunter/1.0 (+https://github.com/HishamAbulfeilat/GhostForge)' }
const TIMEOUT = 15_000
const CACHE_TTL = 60 * 60_000
const cache = new Map<string, { at: number; body: Promise<unknown> }>()

/** Forget cached feed responses (tests, or a manual refresh) */
export function clearSourceCache(): void { cache.clear() }

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT) })
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned ${res.status}`)
  return res.text()
}

/** GET with a one-hour cache per URL (failed requests are not cached) */
function cached<T>(url: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.body as Promise<T>
  const body = load()
  cache.set(url, { at: Date.now(), body })
  body.catch(() => cache.delete(url))
  if (cache.size > 300) cache.delete(cache.keys().next().value as string)
  return body
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return cached(url, async () => JSON.parse(await fetchText(url, headers)) as T)
}

export function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // &amp; last, so "&amp;lt;" decodes to the text "&lt;" rather than "<"
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&#x2F;|&#47;/gi, '/').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

/**
 * Identify the applicant tracking system from an apply URL's hostname. The ATS
 * decides whether a form may be auto-submitted, so it must come from the host
 * itself — never from a substring anywhere in the URL (evil.com/?lever.co).
 */
export function detectAts(url: string): Ats {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return 'other' }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  if (on('lever.co')) return 'lever'
  if (on('greenhouse.io')) return 'greenhouse'
  if (on('ashbyhq.com')) return 'ashby'
  if (on('myworkdayjobs.com') || on('myworkdaysite.com')) return 'workday'
  if (on('workable.com')) return 'workable'
  if (on('smartrecruiters.com')) return 'smartrecruiters'
  if (on('recruitee.com')) return 'recruitee'
  if (on('icims.com')) return 'icims'
  if (on('taleo.net')) return 'taleo'
  if (on('bamboohr.com')) return 'bamboohr'
  if (on('teamtailor.com')) return 'teamtailor'
  if (on('linkedin.com')) return 'linkedin'
  return 'other'
}

function jobKey(company: string, title: string, location: string): string {
  return [company, title, location].map(s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).join('|')
}

function make(job: Omit<RawJob, 'key' | 'ats' | 'description' | 'trust'> & { description: string; trust?: Trust }): RawJob {
  return {
    ...job,
    description: stripHtml(job.description).slice(0, 8000),
    ats: detectAts(job.applyUrl || job.url),
    key: jobKey(job.company, job.title, job.location),
    trust: job.trust ?? 'board',
  }
}

/** Wording job sites use for a posting that is closed or gone */
export const CLOSED_POSTING = /no longer (accepting (applications|candidates)|available|open|active)|(job|position|posting|vacancy|role|opening) (has )?(expired|closed|been (filled|closed|removed))|(this|the) (job|position|posting|vacancy|role|opening) (is )?(no longer|closed|unavailable|not available|filled)|applications? (are |is )?(now )?closed|job not found|posting not found|couldn'?t find (that|this|the) job/i

const matchesTerm = (text: string, term: string) => text.toLowerCase().includes(term.toLowerCase())
const isoFromSeconds = (s: unknown) => (Number(s) > 0 ? new Date(Number(s) * 1000).toISOString() : '')
const money = (min?: number, max?: number, cur = '') =>
  min || max ? `${cur ? `${cur} ` : ''}${Math.round(min || max || 0)}-${Math.round(max || min || 0)}`.trim() : ''

// ── adapters ────────────────────────────────────────────────────────────────

// Response shapes (only the fields we read)
interface MuseJob { name: string; contents?: string; publication_date?: string; locations?: Array<{ name: string }>; categories?: Array<{ name: string }>; refs?: { landing_page?: string }; company?: { name?: string } }
interface RemoteOkJob { position?: string; company?: string; location?: string; tags?: string[]; salary_min?: number; salary_max?: number; url?: string; apply_url?: string; description?: string; date?: string }
interface GreenhouseJob { id: number; title: string; company_name?: string; location?: { name?: string }; absolute_url: string; content?: string; first_published?: string; updated_at?: string }
interface LeverPosting { text: string; categories?: { location?: string }; workplaceType?: string; hostedUrl: string; applyUrl?: string; descriptionPlain?: string; additionalPlain?: string; createdAt?: number }
interface JSearchJob { job_title: string; employer_name: string; job_publisher?: string; job_city?: string; job_state?: string; job_country?: string; job_is_remote?: boolean; job_min_salary?: number; job_max_salary?: number; job_salary_currency?: string; job_apply_link?: string; job_google_link?: string; job_description?: string; job_posted_at_datetime_utc?: string }

async function remotive(term: string): Promise<RawJob[]> {
  const data = await getJson<{ jobs: Array<Record<string, string>> }>(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=40`)
  return (data.jobs || []).map(j => make({
    source: 'Remotive', title: j.title, company: j.company_name, location: j.candidate_required_location || 'Remote',
    remote: true, salary: j.salary || '', url: j.url, applyUrl: j.url, description: j.description, postedAt: j.publication_date,
  }))
}

async function arbeitnow(term: string): Promise<RawJob[]> {
  const data = await getJson<{ data: Array<Record<string, unknown>> }>('https://www.arbeitnow.com/api/job-board-api')
  const t = term.toLowerCase()
  return (data.data || [])
    .filter(j => `${j.title} ${(j.tags as string[] || []).join(' ')}`.toLowerCase().includes(t))
    .map(j => make({
      source: 'Arbeitnow', title: String(j.title), company: String(j.company_name), location: String(j.location || ''),
      remote: Boolean(j.remote), salary: '', url: String(j.url), applyUrl: String(j.url), description: String(j.description || ''),
      postedAt: j.created_at ? new Date(Number(j.created_at) * 1000).toISOString() : '',
    }))
}

async function theMuse(term: string, locations: string[]): Promise<RawJob[]> {
  const params = new URLSearchParams({ page: '0', descending: 'true' })
  for (const loc of locations.slice(0, 5)) params.append('location', loc)
  const data = await getJson<{ results: MuseJob[] }>(`https://www.themuse.com/api/public/jobs?${params}`)
  const t = term.toLowerCase()
  return (data.results || [])
    .filter(j => String(j.name).toLowerCase().includes(t) || (j.categories || []).some(c => c.name.toLowerCase().includes(t)))
    .map(j => {
      const locs = (j.locations || []).map(l => l.name)
      return make({
        source: 'The Muse', title: j.name, company: j.company?.name || '', location: locs.join(' / '),
        remote: locs.some(l => /remote|flexible/i.test(l)), salary: '', url: j.refs?.landing_page || '',
        applyUrl: j.refs?.landing_page || '', description: j.contents || '', postedAt: j.publication_date || '',
      })
    })
}

async function remoteOk(term: string): Promise<RawJob[]> {
  const data = await getJson<RemoteOkJob[]>('https://remoteok.com/api')
  const t = term.toLowerCase()
  return data.slice(1)
    .filter(j => `${j.position} ${(j.tags || []).join(' ')}`.toLowerCase().includes(t))
    .map(j => make({
      source: 'RemoteOK', title: j.position || '', company: j.company || '', location: j.location || 'Remote', remote: true,
      salary: j.salary_min ? `$${Math.round(j.salary_min / 1000)}k-$${Math.round((j.salary_max || j.salary_min) / 1000)}k` : '',
      url: j.url || '', applyUrl: j.apply_url || j.url || '', description: j.description || '', postedAt: j.date || '',
    }))
}

async function greenhouseBoard(board: string): Promise<RawJob[]> {
  const data = await getJson<{ jobs: GreenhouseJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`)
  return (data.jobs || []).map(j => make({
    source: `Greenhouse (${board})`, title: j.title, company: j.company_name || board, location: j.location?.name || '',
    remote: /remote/i.test(j.location?.name || ''), salary: '', url: j.absolute_url,
    // The embeddable form works as a top-level page (see ats-patterns in the skill)
    applyUrl: `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${j.id}`,
    description: stripHtml(String(j.content || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')), postedAt: j.first_published || j.updated_at || '',
    trust: 'official',
  }))
}

async function leverBoard(company: string): Promise<RawJob[]> {
  const data = await getJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`)
  return data.map(j => make({
    source: `Lever (${company})`, title: j.text, company, location: j.categories?.location || '',
    remote: j.workplaceType === 'remote', salary: '', url: j.hostedUrl, applyUrl: j.applyUrl || `${j.hostedUrl}/apply`,
    description: `${j.descriptionPlain || ''}\n${j.additionalPlain || ''}`, postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : '',
    trust: 'official',
  }))
}

export function jsearchKey(): string {
  return process.env.JSEARCH_API_KEY || process.env.RAPIDAPI_KEY || ''
}

/** LinkedIn, Indeed, Glassdoor… via the JSearch aggregator API */
async function jsearch(term: string, location: string, remoteOnly: boolean): Promise<RawJob[]> {
  const key = jsearchKey()
  if (!key) return []
  const params = new URLSearchParams({
    query: location ? `${term} in ${location}` : term,
    page: '1', num_pages: '2', date_posted: 'month',
    ...(remoteOnly ? { work_from_home: 'true' } : {}),
  })
  const data = await getJson<{ data: JSearchJob[] }>(`https://jsearch.p.rapidapi.com/search?${params}`, {
    'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
  })
  return (data.data || []).map(j => {
    const loc = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ')
    const salary = j.job_min_salary ? `${j.job_salary_currency || ''} ${j.job_min_salary}-${j.job_max_salary || j.job_min_salary}`.trim() : ''
    return make({
      source: j.job_publisher ? `${j.job_publisher} (JSearch)` : 'JSearch', title: j.job_title, company: j.employer_name,
      location: loc || (j.job_is_remote ? 'Remote' : ''), remote: Boolean(j.job_is_remote), salary,
      url: j.job_apply_link || j.job_google_link || '', applyUrl: j.job_apply_link || '', description: j.job_description || '',
      postedAt: j.job_posted_at_datetime_utc || '',
    })
  })
}

interface AshbyJob { id: string; title: string; location?: string; isRemote?: boolean; workplaceType?: string; jobUrl: string; applyUrl?: string; descriptionPlain?: string; publishedAt?: string; isListed?: boolean; compensation?: { compensationTierSummary?: string } }
interface WorkableJob { title: string; shortcode?: string; url?: string; application_url?: string; telecommuting?: boolean; city?: string; state?: string; country?: string; published_on?: string; created_at?: string; description?: string }
interface SmartRecruitersJob { id: string; name: string; releasedDate?: string; location?: { city?: string; region?: string; country?: string; remote?: boolean }; company?: { name?: string; identifier?: string } }
interface RecruiteeOffer { title: string; company_name?: string; location?: string; remote?: boolean; careers_url?: string; careers_apply_url?: string; description?: string; requirements?: string; published_at?: string; created_at?: string; status?: string }

/** Ashby's public job-board API (the one its embeddable boards use) */
async function ashbyBoard(org: string): Promise<RawJob[]> {
  const data = await getJson<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`)
  return (data.jobs || []).filter(j => j.isListed !== false).map(j => make({
    source: `Ashby (${org})`, title: j.title, company: org, location: j.location || (j.isRemote ? 'Remote' : ''),
    remote: Boolean(j.isRemote) || j.workplaceType === 'Remote', salary: j.compensation?.compensationTierSummary || '',
    url: j.jobUrl, applyUrl: j.applyUrl || j.jobUrl, description: j.descriptionPlain || '', postedAt: j.publishedAt || '', trust: 'official',
  }))
}

/** Workable's public careers widget API */
async function workableBoard(account: string): Promise<RawJob[]> {
  const data = await getJson<{ name?: string; jobs?: WorkableJob[] }>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`)
  return (data.jobs || []).map(j => make({
    source: `Workable (${account})`, title: j.title, company: data.name || account,
    location: [j.city, j.state, j.country].filter(Boolean).join(', ') || (j.telecommuting ? 'Remote' : ''),
    remote: Boolean(j.telecommuting), salary: '', url: j.url || '', applyUrl: j.application_url || j.url || '',
    description: j.description || '', postedAt: j.published_on || j.created_at || '', trust: 'official',
  }))
}

/** SmartRecruiters' public Posting API */
async function smartRecruitersBoard(company: string): Promise<RawJob[]> {
  const data = await getJson<{ content?: SmartRecruitersJob[] }>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100`)
  return (data.content || []).map(j => {
    const id = j.company?.identifier || company
    const loc = [j.location?.city, j.location?.region, j.location?.country?.toUpperCase()].filter(Boolean).join(', ')
    return make({
      source: `SmartRecruiters (${company})`, title: j.name, company: j.company?.name || company,
      location: loc || (j.location?.remote ? 'Remote' : ''), remote: Boolean(j.location?.remote), salary: '',
      url: `https://jobs.smartrecruiters.com/${encodeURIComponent(id)}/${encodeURIComponent(j.id)}`,
      applyUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(id)}/${encodeURIComponent(j.id)}`,
      description: '', postedAt: j.releasedDate || '', trust: 'official',
    })
  })
}

/** Recruitee's public careers-site API */
async function recruiteeBoard(company: string): Promise<RawJob[]> {
  const data = await getJson<{ offers?: RecruiteeOffer[] }>(`https://${encodeURIComponent(company)}.recruitee.com/api/offers/`)
  return (data.offers || []).filter(j => !j.status || j.status === 'published').map(j => make({
    source: `Recruitee (${company})`, title: j.title, company: j.company_name || company, location: j.location || (j.remote ? 'Remote' : ''),
    remote: Boolean(j.remote), salary: '', url: j.careers_url || '', applyUrl: j.careers_apply_url || j.careers_url || '',
    description: `${j.description || ''}\n${j.requirements || ''}`, postedAt: j.published_at || j.created_at || '', trust: 'official',
  }))
}

interface JobicyJob { url: string; jobTitle: string; companyName: string; jobGeo?: string; jobDescription?: string; jobExcerpt?: string; pubDate?: string; annualSalaryMin?: number; annualSalaryMax?: number; salaryCurrency?: string }
interface HimalayasJob { title: string; companyName: string; locationRestrictions?: string[]; minSalary?: number; maxSalary?: number; currency?: string; pubDate?: number; applicationLink?: string; guid?: string; description?: string; excerpt?: string }

/** Jobicy remote jobs API (attribution: listings link back to Jobicy) */
async function jobicy(term: string): Promise<RawJob[]> {
  const data = await getJson<{ jobs?: JobicyJob[] }>(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(term)}`)
  return (data.jobs || []).map(j => make({
    source: 'Jobicy', title: j.jobTitle, company: j.companyName, location: j.jobGeo || 'Remote', remote: true,
    salary: money(j.annualSalaryMin, j.annualSalaryMax, j.salaryCurrency), url: j.url, applyUrl: j.url,
    description: j.jobDescription || j.jobExcerpt || '', postedAt: j.pubDate ? new Date(j.pubDate.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(j.pubDate) ? '' : 'Z')).toISOString() : '',
  }))
}

/** Himalayas remote jobs search API (attribution: listings link back to Himalayas) */
async function himalayas(term: string): Promise<RawJob[]> {
  const data = await getJson<{ jobs?: HimalayasJob[] }>(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(term)}`)
  return (data.jobs || []).map(j => make({
    source: 'Himalayas', title: j.title, company: j.companyName, location: (j.locationRestrictions || []).join(', ') || 'Worldwide', remote: true,
    salary: money(j.minSalary, j.maxSalary, j.currency), url: j.guid || j.applicationLink || '', applyUrl: j.applicationLink || j.guid || '',
    description: j.description || j.excerpt || '', postedAt: isoFromSeconds(j.pubDate),
  }))
}

/** Read <item>s from an RSS feed */
export function parseRss(xml: string): Array<Record<string, string>> {
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || ''
    return m.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim()
  }
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m => ({
    title: stripHtml(tag(m[1], 'title')), link: tag(m[1], 'link').trim(), region: stripHtml(tag(m[1], 'region')),
    pubDate: tag(m[1], 'pubDate'), description: tag(m[1], 'description'),
  }))
}

/** We Work Remotely's public RSS feed ("Company: Title") */
async function weWorkRemotely(term: string): Promise<RawJob[]> {
  const xml = await cached('https://weworkremotely.com/remote-jobs.rss', () => fetchText('https://weworkremotely.com/remote-jobs.rss'))
  return parseRss(xml).filter(i => matchesTerm(i.title, term)).map(i => {
    const [company, ...rest] = i.title.split(':')
    const posted = Date.parse(i.pubDate)
    return make({
      source: 'We Work Remotely', title: rest.join(':').trim() || i.title, company: rest.length ? company.trim() : '',
      location: i.region || 'Remote', remote: true, salary: '', url: i.link, applyUrl: i.link, description: i.description,
      postedAt: Number.isFinite(posted) ? new Date(posted).toISOString() : '',
    })
  })
}

interface HnHit { objectID: string; title?: string; comment_text?: string; created_at?: string; parent_id?: number; story_id?: number }

/**
 * One top-level comment of an HN "Who is hiring?" thread → a listing. The
 * convention is "Company | Role | Location | REMOTE | link" on the first line.
 */
export function parseHnComment(hit: HnHit, term: string): RawJob | null {
  const html = String(hit.comment_text || '')
  const firstLine = stripHtml(html.split(/<p>/i)[0] || '').split('\n')[0]
  const parts = firstLine.split('|').map(s => s.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const company = parts[0].replace(/\s*\(.*?\)\s*$/, '').slice(0, 80)
  const words = term.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const title = parts.slice(1).find(p => words.some(w => p.toLowerCase().includes(w)))
    || parts.slice(1).find(p => /engineer|developer|designer|manager|scientist|analyst|lead|architect|devops|sre/i.test(p))
  if (!title) return null
  const location = parts.slice(1).find(p => p !== title && !/^https?:/i.test(p) && /remote|onsite|on-site|hybrid|[A-Z][a-z]+,|\b(usa?|uk|eu|europe|nyc|sf)\b/i.test(p)) || ''
  const link = html.match(/href="(https?:[^"]+)"/i)?.[1]?.replace(/&#x2F;/gi, '/').replace(/&amp;/g, '&') || ''
  const item = `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`
  return make({
    source: 'HN Who is hiring', title: title.slice(0, 120), company, location, remote: /remote/i.test(firstLine), salary: '',
    url: item, applyUrl: link || item, description: html, postedAt: hit.created_at || '', trust: 'community',
  })
}

/** Hacker News "Who is hiring?" via the public Algolia HN Search API */
async function hackerNewsHiring(term: string): Promise<RawJob[]> {
  const stories = await getJson<{ hits: HnHit[] }>('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5')
  const story = stories.hits.find(h => /who is hiring/i.test(h.title || ''))
  if (!story) return []
  const data = await getJson<{ hits: HnHit[] }>(`https://hn.algolia.com/api/v1/search?tags=comment,story_${encodeURIComponent(story.objectID)}&query=${encodeURIComponent(term)}&hitsPerPage=50`)
  return data.hits
    .filter(h => String(h.parent_id) === String(story.objectID))
    .map(h => parseHnComment(h, term))
    .filter((j): j is RawJob => Boolean(j))
}

// ── keyed sources (free keys, read from the environment) ───────────────────

const ADZUNA_COUNTRIES: Record<string, string> = {
  'united kingdom': 'gb', uk: 'gb', england: 'gb', scotland: 'gb', 'united states': 'us', usa: 'us', us: 'us', austria: 'at',
  australia: 'au', belgium: 'be', brazil: 'br', canada: 'ca', switzerland: 'ch', germany: 'de', spain: 'es', france: 'fr',
  india: 'in', italy: 'it', mexico: 'mx', netherlands: 'nl', 'new zealand': 'nz', poland: 'pl', singapore: 'sg', 'south africa': 'za',
}

export function adzunaCountry(places: string[]): string | null {
  const env = (process.env.ADZUNA_COUNTRY || '').toLowerCase()
  if (/^[a-z]{2}$/.test(env)) return env
  for (const p of places) {
    const l = p.toLowerCase()
    for (const [name, code] of Object.entries(ADZUNA_COUNTRIES)) if (new RegExp(`\\b${name}\\b`).test(l)) return code
  }
  return null
}

interface AdzunaJob { title: string; company?: { display_name?: string }; location?: { display_name?: string }; redirect_url: string; description?: string; created?: string; salary_min?: number; salary_max?: number }
interface UsaJob { MatchedObjectDescriptor: { PositionTitle: string; OrganizationName?: string; PositionLocationDisplay?: string; PositionURI: string; ApplyURI?: string[]; PublicationStartDate?: string; UserArea?: { Details?: { JobSummary?: string } }; PositionRemuneration?: Array<{ MinimumRange?: string; MaximumRange?: string }> } }
interface ReedJob { jobId: number; employerName?: string; jobTitle: string; locationName?: string; minimumSalary?: number; maximumSalary?: number; currency?: string; date?: string; jobDescription?: string; jobUrl: string }

/** Adzuna (free key) — aggregated listings in ~20 countries */
async function adzuna(term: string, where: string, country: string): Promise<RawJob[]> {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY
  if (!id || !key) return []
  const p = new URLSearchParams({ app_id: id, app_key: key, what: term, results_per_page: '50', max_days_old: '30', 'content-type': 'application/json', ...(where ? { where } : {}) })
  const data = await getJson<{ results?: AdzunaJob[] }>(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${p}`)
  return (data.results || []).map(j => make({
    source: 'Adzuna', title: stripHtml(j.title), company: j.company?.display_name || '', location: j.location?.display_name || '',
    remote: /remote/i.test(`${j.title} ${j.location?.display_name}`), salary: money(j.salary_min, j.salary_max),
    url: j.redirect_url, applyUrl: j.redirect_url, description: j.description || '', postedAt: j.created || '',
  }))
}

/** USAJobs (free key) — US federal government jobs */
async function usaJobs(term: string, where: string): Promise<RawJob[]> {
  const key = process.env.USAJOBS_API_KEY, email = process.env.USAJOBS_EMAIL
  if (!key || !email) return []
  const p = new URLSearchParams({ Keyword: term, ResultsPerPage: '50', DatePosted: '30', ...(where ? { LocationName: where } : {}) })
  const data = await getJson<{ SearchResult?: { SearchResultItems?: UsaJob[] } }>(`https://data.usajobs.gov/api/search?${p}`, { 'User-Agent': email, 'Authorization-Key': key })
  return (data.SearchResult?.SearchResultItems || []).map(({ MatchedObjectDescriptor: j }) => make({
    source: 'USAJobs', title: j.PositionTitle, company: j.OrganizationName || 'US Government', location: j.PositionLocationDisplay || '',
    remote: /remote|anywhere/i.test(j.PositionLocationDisplay || ''), salary: money(Number(j.PositionRemuneration?.[0]?.MinimumRange), Number(j.PositionRemuneration?.[0]?.MaximumRange), 'USD'),
    url: j.PositionURI, applyUrl: j.ApplyURI?.[0] || j.PositionURI, description: j.UserArea?.Details?.JobSummary || '', postedAt: j.PublicationStartDate || '',
  }))
}

/** Reed (free key) — UK jobs */
async function reed(term: string, where: string): Promise<RawJob[]> {
  const key = process.env.REED_API_KEY
  if (!key) return []
  const p = new URLSearchParams({ keywords: term, resultsToTake: '50', ...(where ? { locationName: where } : {}) })
  const data = await getJson<{ results?: ReedJob[] }>(`https://www.reed.co.uk/api/1.0/search?${p}`, { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` })
  return (data.results || []).map(j => {
    const [d, m, y] = String(j.date || '').split('/')
    return make({
      source: 'Reed', title: j.jobTitle, company: j.employerName || '', location: j.locationName || '', remote: /remote/i.test(`${j.jobTitle} ${j.locationName}`),
      salary: money(j.minimumSalary, j.maximumSalary, j.currency || 'GBP'), url: j.jobUrl, applyUrl: j.jobUrl, description: j.jobDescription || '',
      postedAt: y && m && d ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z` : '',
    })
  })
}

/** Which keyed sources are configured (shown in the UI; never the keys themselves) */
export function keyedSources(): { jsearch: boolean; adzuna: boolean; usajobs: boolean; reed: boolean } {
  return {
    jsearch: Boolean(jsearchKey()),
    adzuna: Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
    usajobs: Boolean(process.env.USAJOBS_API_KEY && process.env.USAJOBS_EMAIL),
    reed: Boolean(process.env.REED_API_KEY),
  }
}

// ── company boards ───────────────────────────────────────────────────────────

const BOARDS = {
  greenhouse: greenhouseBoard, lever: leverBoard, ashby: ashbyBoard,
  workable: workableBoard, smartrecruiters: smartRecruitersBoard, recruitee: recruiteeBoard,
} as const
export type BoardAts = keyof typeof BOARDS
export const BOARD_ATS = Object.keys(BOARDS) as BoardAts[]

/** "ashby:openai" → [{ ats: 'ashby', slug: 'openai' }]; "openai" → every supported ATS */
export function parseCompany(entry: string): Array<{ ats: BoardAts; slug: string; pinned: boolean }> {
  const m = String(entry || '').trim().toLowerCase().match(/^(?:([a-z]+):)?([a-z0-9][a-z0-9_-]{0,79})$/)
  if (!m) return []
  if (m[1]) return (BOARD_ATS as string[]).includes(m[1]) ? [{ ats: m[1] as BoardAts, slug: m[2], pinned: true }] : []
  return BOARD_ATS.map(ats => ({ ats, slug: m[2], pinned: false }))
}

/** Run async tasks with at most `limit` in flight */
async function pool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<Array<PromiseSettledResult<T>>> {
  const out: Array<PromiseSettledResult<T>> = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++
      try { out[i] = { status: 'fulfilled', value: await tasks[i]() } } catch (reason) { out[i] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return out
}

const TRUST_RANK: Record<Trust, number> = { official: 3, board: 2, link: 2, community: 1 }

// ── public API ───────────────────────────────────────────────────────────────

export interface SourceReport { source: string; count: number; error?: string }

/** A LinkedIn search the user can open themselves (never scraped) */
export function linkedInSearchUrl(term: string, location: string): string {
  const p = new URLSearchParams({ keywords: term, ...(location ? { location } : {}) })
  return `https://www.linkedin.com/jobs/search/?${p}`
}

/** Query every enabled source for each search term and return merged listings */
export async function searchSources(prefs: JobPreferences, terms: string[]): Promise<{ jobs: RawJob[]; report: SourceReport[] }> {
  const remoteOnly = prefs.remote === 'remote'
  const onsiteLocations = prefs.locations.filter(l => !/^remote$/i.test(l.trim()))
  const keyed = keyedSources()
  const country = adzunaCountry(onsiteLocations)
  const tasks: Array<{ source: string; run: () => Promise<RawJob[]>; probe?: boolean }> = []

  terms.slice(0, 5).forEach((term, n) => {
    tasks.push({ source: `Remotive "${term}"`, run: () => remotive(term) })
    tasks.push({ source: `RemoteOK "${term}"`, run: () => remoteOk(term) })
    tasks.push({ source: `We Work Remotely "${term}"`, run: () => weWorkRemotely(term) })
    tasks.push({ source: `Himalayas "${term}"`, run: () => himalayas(term) })
    // Jobicy asks clients not to poll heavily: the first two terms only
    if (n < 2) tasks.push({ source: `Jobicy "${term}"`, run: () => jobicy(term) })
    if (n < 3) tasks.push({ source: `HN Who is hiring "${term}"`, run: () => hackerNewsHiring(term) })
    if (!remoteOnly) {
      tasks.push({ source: `Arbeitnow "${term}"`, run: () => arbeitnow(term) })
      tasks.push({ source: `The Muse "${term}"`, run: () => theMuse(term, onsiteLocations) })
    }
    const places = (onsiteLocations.length ? onsiteLocations : ['']).slice(0, 3)
    for (const loc of places) {
      const at = loc ? ` in ${loc}` : ''
      if (keyed.jsearch) tasks.push({ source: `LinkedIn/Indeed via JSearch "${term}"${at}`, run: () => jsearch(term, loc, remoteOnly) })
      if (keyed.adzuna && (country || loc)) tasks.push({ source: `Adzuna "${term}"${at}`, run: () => adzuna(term, loc, country || 'gb') })
      if (keyed.usajobs) tasks.push({ source: `USAJobs "${term}"${at}`, run: () => usaJobs(term, loc) })
      if (keyed.reed) tasks.push({ source: `Reed "${term}"${at}`, run: () => reed(term, loc) })
    }
  })
  for (const company of prefs.companies.slice(0, 20)) {
    for (const { ats, slug, pinned } of parseCompany(company)) {
      // An unpinned slug is tried on every ATS; it only exists on one, so misses are silent
      tasks.push({ source: `${ats[0].toUpperCase()}${ats.slice(1)} ${slug}`, run: () => BOARDS[ats](slug), probe: !pinned })
    }
  }

  const settled = await pool(tasks.map(t => t.run), 8)
  const report: SourceReport[] = []
  const all: RawJob[] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      if (!tasks[i].probe || r.value.length) report.push({ source: tasks[i].source, count: r.value.length })
      all.push(...r.value)
    } else {
      // A company slug only exists on one ATS — a 404 there is expected, not an error
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
      if (!tasks[i].probe && !/returned 404/.test(msg)) report.push({ source: tasks[i].source, count: 0, error: msg.slice(0, 120) })
    }
  })
  return { jobs: dedupeListings(all), report }
}

/**
 * One job posted on several boards becomes one listing: the copy from the most
 * trusted source wins (the company's own ATS over a board over a forum post).
 */
export function dedupeListings(jobs: RawJob[]): RawJob[] {
  const byKey = new Map<string, RawJob>()
  for (const job of jobs) {
    if (!job.title || !job.company) continue
    const k = dedupeKey(job)
    const seen = byKey.get(k)
    if (!seen || TRUST_RANK[job.trust] > TRUST_RANK[seen.trust]) byKey.set(k, job)
  }
  return [...byKey.values()]
}
