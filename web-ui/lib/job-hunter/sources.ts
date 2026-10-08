/**
 * Job sources. Each adapter returns normalized listings; matching, scoring and
 * de-duplication happen upstream.
 *
 * No key needed:  Remotive, Arbeitnow, The Muse, RemoteOK, Greenhouse/Lever boards
 * With a key:     JSearch (RapidAPI) — aggregates LinkedIn, Indeed, Glassdoor,
 *                 ZipRecruiter and more through a licensed API. Set JSEARCH_API_KEY
 *                 (or RAPIDAPI_KEY). LinkedIn itself is never scraped.
 */
import type { Ats, JobPreferences } from './store'

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
}

const UA = { 'User-Agent': 'GhostForge-JobHunter/1.0 (+https://github.com/HishamAbulfeilat/GhostForge)' }
const TIMEOUT = 15_000

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT) })
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned ${res.status}`)
  return res.json() as Promise<T>
}

export function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // &amp; last, so "&amp;lt;" decodes to the text "&lt;" rather than "<"
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
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
  if (on('linkedin.com')) return 'linkedin'
  return 'other'
}

function jobKey(company: string, title: string, location: string): string {
  return [company, title, location].map(s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).join('|')
}

function make(job: Omit<RawJob, 'key' | 'ats' | 'description'> & { description: string }): RawJob {
  return {
    ...job,
    description: stripHtml(job.description),
    ats: detectAts(job.applyUrl || job.url),
    key: jobKey(job.company, job.title, job.location),
  }
}

// ── adapters ────────────────────────────────────────────────────────────────

// Response shapes (only the fields we read)
interface MuseJob { name: string; contents?: string; publication_date?: string; locations?: Array<{ name: string }>; categories?: Array<{ name: string }>; refs?: { landing_page?: string }; company?: { name?: string } }
interface RemoteOkJob { position?: string; company?: string; location?: string; tags?: string[]; salary_min?: number; salary_max?: number; url?: string; apply_url?: string; description?: string; date?: string }
interface GreenhouseJob { id: number; title: string; company_name?: string; location?: { name?: string }; absolute_url: string; content?: string; first_published?: string; updated_at?: string }
interface LeverPosting { text: string; categories?: { location?: string }; workplaceType?: string; hostedUrl: string; applyUrl?: string; descriptionPlain?: string; additionalPlain?: string; lists?: Array<{ text?: string; content?: string }>; createdAt?: number }
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
  }))
}

async function leverBoard(company: string): Promise<RawJob[]> {
  const data = await getJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`)
  return data.map(j => make({
    source: `Lever (${company})`, title: j.text, company, location: j.categories?.location || '',
    remote: j.workplaceType === 'remote', salary: '', url: j.hostedUrl, applyUrl: j.applyUrl || `${j.hostedUrl}/apply`,
    description: [j.descriptionPlain, ...(j.lists || []).map(list => `${list.text || ''}\n${stripHtml(list.content || '')}`), j.additionalPlain].filter(Boolean).join('\n\n'),
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : '',
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
  const tasks: Array<{ source: string; run: () => Promise<RawJob[]> }> = []

  for (const term of terms.slice(0, 5)) {
    tasks.push({ source: `Remotive "${term}"`, run: () => remotive(term) })
    tasks.push({ source: `RemoteOK "${term}"`, run: () => remoteOk(term) })
    if (!remoteOnly) {
      tasks.push({ source: `Arbeitnow "${term}"`, run: () => arbeitnow(term) })
      tasks.push({ source: `The Muse "${term}"`, run: () => theMuse(term, onsiteLocations) })
    }
    if (jsearchKey()) {
      for (const loc of (onsiteLocations.length ? onsiteLocations : ['']).slice(0, 3)) {
        tasks.push({ source: `LinkedIn/Indeed via JSearch "${term}"${loc ? ` in ${loc}` : ''}`, run: () => jsearch(term, loc, remoteOnly) })
      }
    }
  }
  for (const company of prefs.companies.slice(0, 20)) {
    const c = company.trim()
    if (!c) continue
    tasks.push({ source: `Greenhouse ${c}`, run: () => greenhouseBoard(c) })
    tasks.push({ source: `Lever ${c}`, run: () => leverBoard(c) })
  }

  const settled = await Promise.allSettled(tasks.map(t => t.run()))
  const report: SourceReport[] = []
  const byKey = new Map<string, RawJob>()
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      report.push({ source: tasks[i].source, count: r.value.length })
      for (const job of r.value) if (job.title && job.company && !byKey.has(job.key)) byKey.set(job.key, job)
    } else {
      // A company slug only exists on one ATS — a 404 there is expected, not an error
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
      if (!/returned 404/.test(msg)) report.push({ source: tasks[i].source, count: 0, error: msg.slice(0, 120) })
    }
  })
  return { jobs: [...byKey.values()], report }
}
