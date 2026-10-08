'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApplicantData, AutopilotSettings, DigestSettings, JobPreferences, JobRecord, ModelChoice, SavedSearch } from '@/lib/job-hunter/store'
import { CvImprover } from '@/components/career/CvImprover'
import { GithubProfileSetup } from '@/components/career/GithubProfileSetup'
import type { ApplicationActivity } from '@/lib/job-hunter/live'
import type { AccountMode } from '@/lib/job-hunter/accounts'

// Layout and tokens follow the "GhostForge Job Hunter & Setup" Claude Design canvas.

interface ProfileView {
  cv: { fileName: string; uploadedAt: string; preview: string; length: number } | null
  applicant: ApplicantData
  preferences: JobPreferences
  customAnswers: Record<string, string>
  savedSearches?: SavedSearch[]
  digest?: DigestSettings
}

interface SearchResult {
  found: number
  matched: number
  added: number
  prepared: number
  dropped?: { stale: number; invalid: number; scam: number; flagged: number }
  report: Array<{ source: string; count: number; error?: string; note?: string }>
  linkedin: Array<{ term: string; location: string; url: string }>
}

type Tab = 'waiting' | 'all' | 'applied'

const FIT_STYLE: Record<string, string> = {
  High: 'bg-gf-ok-soft text-gf-ok',
  Medium: 'bg-gf-warn-soft text-gf-warn',
  Low: 'bg-[#1A1F2B] text-gf-muted',
  Skip: 'bg-[#1A1F2B] text-gf-muted',
}

const STATUS_VIEW: Record<string, { label: string; style: string; cta: string }> = {
  found:      { label: 'Found',        style: 'bg-[#1A1F2B] text-gf-muted',          cta: 'Prepare' },
  ready:      { label: 'Ready',        style: 'bg-gf-accent-soft text-gf-accent-ink', cta: 'Review & approve' },
  submitting: { label: 'Applying…',    style: 'bg-gf-accent-soft text-gf-accent-ink', cta: 'View' },
  needs_user: { label: 'Needs you',    style: 'bg-gf-warn-soft text-gf-warn',         cta: 'Finish application' },
  submitted:  { label: 'Applied',      style: 'bg-gf-ok-soft text-gf-ok',             cta: 'View' },
  failed:     { label: 'Failed',       style: 'bg-red-950 text-red-300',              cta: 'Retry' },
}

/** Is this listing a real, open job? (see lib/job-hunter/verify.ts) */
const VERIFY_VIEW: Record<string, { label: string; style: string }> = {
  verified:   { label: 'Verified',   style: 'bg-gf-ok-soft text-gf-ok' },
  unverified: { label: 'Unverified', style: 'bg-[#1A1F2B] text-gf-muted' },
  flagged:    { label: 'Possible scam', style: 'bg-red-950 text-red-300' },
  closed:     { label: 'Closed',     style: 'bg-[#1A1F2B] text-gf-muted' },
}

function VerifyBadge({ job }: { job: JobRecord }) {
  const v = VERIFY_VIEW[job.verification?.status || 'unverified']
  return (
    <span title={job.verification?.flags.join('\n') || 'Not checked yet: it is checked before it is prepared or applied to'}
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${v.style}`}>{v.label}</span>
  )
}

const splitList = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean)

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [profile, setProfile] = useState<ProfileView | null>(null)
  const [jsearch, setJsearch] = useState(false)
  const [tab, setTab] = useState<Tab>('waiting')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string>('')
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [lastSearch, setLastSearch] = useState<SearchResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [batchIds, setBatchIds] = useState<string[]>([])
  const [batchReview, setBatchReview] = useState(false)
  const [batchProgress, setBatchProgress] = useState('')
  const [batchResults, setBatchResults] = useState<Array<{ id: string; title: string; status: string; message: string }>>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const operationRef = useRef(false)

  // Editable preference fields (comma-separated inputs)
  const [roles, setRoles] = useState('')
  const [places, setPlaces] = useState('')
  const [remote, setRemote] = useState<JobPreferences['remote']>('any')
  const [minSalary, setMinSalary] = useState('')
  const [dealbreakers, setDealbreakers] = useState('')
  const [companies, setCompanies] = useState('')
  const [maxAge, setMaxAge] = useState('30')
  const [keyed, setKeyed] = useState<{ jsearch: boolean; adzuna: boolean; usajobs: boolean; reed: boolean } | null>(null)
  const [applicant, setApplicant] = useState<ApplicantData | null>(null)
  const [section, setSection] = useState<'jobs' | 'cv' | 'github'>('jobs')
  const [model, setModel] = useState<ModelChoice | null>(null)
  const [autopilot, setAutopilot] = useState<(AutopilotSettings & { submittedToday: number }) | null>(null)
  const [linkedinStatus, setLinkedinStatus] = useState<{ connected: boolean; connectedAt: string | null }>({ connected: false, connectedAt: null })
  const [jobUrl, setJobUrl] = useState('')

  const load = useCallback(async () => {
    const [j, p] = await Promise.all([
      api<{ jobs: JobRecord[]; sources: { linkedInViaJSearch: boolean; keyed?: { jsearch: boolean; adzuna: boolean; usajobs: boolean; reed: boolean } }; model: ModelChoice | null; autopilot: AutopilotSettings & { submittedToday: number }; linkedin?: { connected: boolean; connectedAt: string | null } }>('/api/jobs'),
      api<{ profile: ProfileView }>('/api/jobs/profile'),
    ])
    setJobs(j.jobs)
    setJsearch(j.sources.linkedInViaJSearch)
    setKeyed(j.sources.keyed || null)
    setModel(j.model)
    setAutopilot(j.autopilot)
    if (j.linkedin) setLinkedinStatus(j.linkedin)
    setProfile(p.profile)
    return p.profile
  }, [])

  useEffect(() => {
    load().then(p => {
      setRoles(p.preferences.titles.join(', '))
      setPlaces(p.preferences.locations.join(', '))
      setRemote(p.preferences.remote)
      setMinSalary(p.preferences.minSalary ? String(p.preferences.minSalary) : '')
      setDealbreakers(p.preferences.dealbreakers.join(', '))
      setCompanies(p.preferences.companies.join(', '))
      setMaxAge(String(p.preferences.maxAgeDays || 30))
      setApplicant(p.applicant)
    }).catch(e => setNotice({ tone: 'error', text: e.message }))
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void load().catch(e => setNotice({ tone: 'error', text: `Could not refresh applications: ${e instanceof Error ? e.message : String(e)}` }))
    }, 10_000)
    return () => clearInterval(timer)
  }, [load])

  const run = async (label: string, fn: () => Promise<void>) => {
    if (operationRef.current) {
      setNotice({ tone: 'error', text: 'Another operation is running. Wait for it to finish before starting another.' })
      return
    }
    operationRef.current = true
    setBusy(label); setNotice(null)
    try { await fn() } catch (e) { setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) }) } finally {
      operationRef.current = false
      setBusy('')
      setBatchProgress('')
    }
  }

  const savePreferences = () => api('/api/jobs/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preferences: {
        titles: splitList(roles), locations: splitList(places), remote,
        minSalary: minSalary ? Number(minSalary) : null,
        dealbreakers: splitList(dealbreakers), companies: splitList(companies), maxAgeDays: Number(maxAge) || 30,
        mustHaves: profile?.preferences.mustHaves || [], niceToHaves: profile?.preferences.niceToHaves || [],
      },
    }),
  })

  const uploadCv = (file: File) => run('cv', async () => {
    const form = new FormData(); form.append('cv', file)
    const r = await api<{ applicant: ApplicantData; suggestedTitles: string[] }>('/api/jobs/profile', { method: 'POST', body: form })
    setApplicant(r.applicant)
    if (!roles && r.suggestedTitles.length) setRoles(r.suggestedTitles.join(', '))
    await load()
    setNotice({ tone: 'info', text: `CV read. ${r.suggestedTitles.length ? `Suggested roles: ${r.suggestedTitles.join(', ')}.` : ''} Check your application details below.` })
  })

  const search = () => run('search', async () => {
    await savePreferences()
    const { result } = await api<{ result: SearchResult }>('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'search' }),
    })
    setLastSearch(result)
    await load()
    setTab(result.prepared ? 'waiting' : 'all')
    const d = result.dropped
    const removed = d ? d.stale + d.invalid + d.scam : 0
    setNotice({ tone: 'info', text: `Found ${result.found} jobs, ${result.matched} in your locations, ${result.added} new. ${result.prepared} prepared for your approval.${removed ? ` Removed ${removed} (old, broken link or scam).` : ''}${d?.flagged ? ` ${d.flagged} flagged as possible scams.` : ''}` })
  })

  const act = (action: 'prepare' | 'approve' | 'dismiss', id: string, extra: { confirmResubmit?: boolean } = {}) => run(`${action}:${id}`, async () => {
    const r = await api<{ job?: JobRecord; message?: string }>('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id, ...extra }),
    })
    await load()
    if (action === 'dismiss') setSelected(null)
    if (action === 'prepare') {
      setTab('waiting')
      setSelected(id)
      setNotice({ tone: 'info', text: r.job?.preparationWarning || 'Application prepared. Review the CV, cover letter and answers, then approve to apply.' })
    }
    if (action === 'approve' && r.job?.status === 'submitted') setTab('applied')
    if (r.message) setNotice({ tone: r.job?.status === 'failed' ? 'error' : 'info', text: r.message })
  })

  const batchIdSet = useMemo(() => new Set(batchIds), [batchIds])
  const batchJobs = jobs.filter(job => batchIdSet.has(job.id))
  const batchCanApply = batchJobs.length > 0 && batchJobs.every(job =>
    ['ready', 'needs_user', 'failed'].includes(job.status) && job.tailoredResume?.trim() && job.coverLetter?.trim())
  const toggleBatch = (id: string) => {
    setBatchReview(false)
    setBatchIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])
  }
  const runBatch = (action: 'prepare' | 'approve') => run(`batch:${action}`, async () => {
    if (!batchJobs.length || (action === 'approve' && !batchCanApply)) throw new Error('Prepare all selected jobs before confirming applications.')
    const queue = [...batchJobs]
    setBatchReview(false)
    setBatchResults([])
    const results: Array<{ id: string; title: string; status: string; message: string }> = []
    // One persistent browser profile and anonymous-model quota serve the whole batch.
    for (const [index, job] of queue.entries()) {
      setBatchProgress(`${action === 'prepare' ? 'Preparing' : 'Applying'} ${index + 1}/${queue.length}: ${job.title} at ${job.company}`)
      try {
        const result = await api<{ job: JobRecord; message?: string }>('/api/jobs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: job.id }),
        })
        results.push({ id: job.id, title: `${job.title} at ${job.company}`, status: result.job.status,
          message: result.message || result.job.preparationWarning || 'Prepared for review; not submitted.' })
      } catch (error) {
        results.push({ id: job.id, title: `${job.title} at ${job.company}`, status: 'failed',
          message: error instanceof Error ? error.message : String(error) })
      }
      setBatchResults([...results])
    }
    setBatchProgress('')
    await load()
    setBatchIds(action === 'prepare' ? queue.map(job => job.id) : [])
    const failed = results.filter(result => result.status === 'failed').length
    const submitted = results.filter(result => result.status === 'submitted').length
    setNotice({ tone: failed ? 'error' : 'info', text: action === 'prepare'
      ? `Preparation finished: ${results.length - failed} prepared, ${failed} failed. Review the materials before applying.`
      : `Batch finished: ${submitted} submitted, ${results.filter(result => result.status === 'needs_user').length} need you, ${failed} failed. See each result below.` })
  })

  const answer = (id: string, answers: Record<string, string>) => run(`answer:${id}`, async () => {
    await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'answer', id, answers }) })
    await load()
    setNotice({ tone: 'info', text: 'Saved. These answers are reused on future applications. Answer every remaining question to return this job to the approval queue.' })
  })

  const addByUrl = () => run('add-url', async () => {
    const { job } = await api<{ job: JobRecord }>('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-url', url: jobUrl }) })
    setJobUrl('')
    await load()
    setSelected(job.id)
    setNotice({ tone: 'info', text: `Added ${job.title} at ${job.company} (${job.score} · ${job.fit} fit). Prepare it, then approve.` })
  })

  const linkedinAction = (action: 'linkedin-connect' | 'linkedin-disconnect') => run('linkedin', async () => {
    const r = await api<{ status?: string }>('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    await load()
    setNotice({
      tone: 'info',
      text: action === 'linkedin-disconnect' ? 'LinkedIn disconnected.'
        : r.status === 'connected' ? 'LinkedIn is connected.'
        : 'A LinkedIn sign-in window opened on this computer. Sign in there (or from your phone via Remote → Control this computer); GhostForge notices within a few seconds.',
    })
  })

  const saveAutomation = (patch: { model?: ModelChoice | null; autopilot?: Partial<AutopilotSettings> }, message?: string) => run('automation', async () => {
    await api('/api/jobs/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    await load()
    if (message) setNotice({ tone: 'info', text: message })
  })

  const runAutopilotNow = () => run('autopilot', async () => {
    const { report } = await api<{ report: { ran: boolean; reason?: string; submitted?: number; prepared?: number; found?: number; needsUser?: number } }>('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'autopilot' }),
    })
    await load()
    setNotice({
      tone: report.ran ? 'info' : 'error',
      text: report.ran
        ? `Autopilot found ${report.found} jobs, prepared ${report.prepared} and submitted ${report.submitted}${report.needsUser ? ` (${report.needsUser} need you)` : ''}.`
        : report.reason || 'Autopilot did not run',
    })
  })

  const saveSearches = (savedSearches: SavedSearch[], message: string) => run('saved', async () => {
    await api('/api/jobs/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ savedSearches }) })
    await load()
    setNotice({ tone: 'info', text: message })
  })

  const saveDigest = (digest: Partial<DigestSettings>, message?: string) => run('digest', async () => {
    await api('/api/jobs/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ digest }) })
    await load()
    if (message) setNotice({ tone: 'info', text: message })
  })

  const runDigestNow = () => run('digest-run', async () => {
    const { report } = await api<{ report: { ran: boolean; reason?: string; newJobs?: unknown[]; searches?: number } }>('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'digest' }),
    })
    await load()
    setNotice({
      tone: report.ran ? 'info' : 'error',
      text: report.ran ? `Digest checked ${report.searches} search(es): ${report.newJobs?.length || 0} new High-fit job(s). Nothing was prepared or submitted.` : report.reason || 'The digest did not run',
    })
  })

  const saveApplicant = () => run('applicant', async () => {
    await api('/api/jobs/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicant }) })
    await load()
    setNotice({ tone: 'info', text: 'Application details saved.' })
  })

  const lists = useMemo(() => ({
    waiting: jobs.filter(j => ['ready', 'needs_user', 'submitting', 'failed'].includes(j.status)),
    all: jobs.filter(j => j.fit !== 'Skip').sort((a, b) => b.score - a.score),
    applied: jobs.filter(j => j.status === 'submitted'),
  }), [jobs])

  const stats = [
    { label: 'Matches in your locations', value: lists.all.length, tone: 'text-gf-ink' },
    { label: 'Waiting for your approval', value: jobs.filter(j => j.status === 'ready').length, tone: 'text-gf-accent-ink' },
    { label: 'Needs you to finish', value: jobs.filter(j => j.status === 'needs_user').length, tone: 'text-gf-warn' },
    { label: 'Applied', value: lists.applied.length, tone: 'text-gf-ok' },
  ]

  const job = selected ? jobs.find(j => j.id === selected) : null
  const linkedin = lastSearch?.linkedin[0]?.url
    || (roles ? `https://www.linkedin.com/jobs/search/?${new URLSearchParams({ keywords: splitList(roles)[0] || '', location: splitList(places)[0] || '' })}` : '')

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-gf-bg font-plex text-gf-ink">
      {notice && (
        <div role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`mx-4 mt-4 rounded-xl border px-4 py-3 text-sm lg:mx-8 ${notice.tone === 'error' ? 'border-red-900 bg-red-950/60 text-red-200' : 'border-cyan-900 bg-gf-accent-soft text-sky-100'}`}>
          {notice.text}
        </div>
      )}

      <nav aria-label="Job Hunter sections" className="flex gap-1 border-b border-gf-line px-4 pt-4 lg:px-8">
        {([['jobs', 'Find jobs'], ['cv', 'Improve CV'], ['github', 'GitHub profile']] as const).map(([k, label]) => (
          <button key={k} type="button" aria-current={section === k ? 'page' : undefined} onClick={() => { setSection(k); setSelected(null) }}
            className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-medium ${section === k ? 'border-gf-accent text-gf-ink' : 'border-transparent text-gf-muted hover:text-gf-ink'}`}>
            {label}
          </button>
        ))}
      </nav>

      {section === 'cv' ? (
        <CvImprover />
      ) : section === 'github' ? (
        <GithubProfileSetup />
      ) : job ? (
        <Review job={job} busy={busy} onBack={() => setSelected(null)} onAnswer={answers => void answer(job.id, answers)}
          onApprove={confirmResubmit => void act('approve', job.id, confirmResubmit ? { confirmResubmit } : {})} onPrepare={() => void act('prepare', job.id)} onDismiss={() => void act('dismiss', job.id)} />
      ) : (
        <div className="grid gap-6 px-4 py-6 lg:grid-cols-[400px_minmax(0,1fr)] lg:px-8 lg:py-7">
          <aside className="flex flex-col gap-4">
            <section className="flex flex-col gap-3.5 rounded-2xl border border-gf-line bg-gf-surface p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold">Your CV</h2>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === 'cv'}
                  className="min-h-9 rounded-lg border border-gf-line2 px-3 text-sm disabled:opacity-60">
                  {busy === 'cv' ? 'Reading…' : profile?.cv ? 'Replace' : 'Upload CV'}
                </button>
                <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" aria-label="Upload your CV"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void uploadCv(f); e.target.value = '' }} />
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-gf-line bg-gf-bar p-3">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7DD3FC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{profile?.cv?.fileName || 'No CV yet — PDF, DOCX or TXT'}</span>
                  <span className="font-mono text-xs text-gf-muted">{profile?.cv ? 'Read · contact details filled' : 'Everything starts from your CV'}</span>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-4 rounded-2xl border border-gf-line bg-gf-surface p-5">
              <h2 className="font-display text-base font-semibold">What to look for</h2>
              <Field id="jh-roles" label="Target roles" value={roles} onChange={setRoles} placeholder="Frontend Engineer, React Developer" />
              <Field id="jh-places" label="Locations" value={places} onChange={setPlaces} placeholder="Tokyo, Japan, Remote" />
              <div className="flex flex-col gap-2">
                <span id="jh-remote" className="text-xs uppercase tracking-[0.06em] text-gf-muted">Work style</span>
                <div role="radiogroup" aria-labelledby="jh-remote" className="grid grid-cols-4 gap-1 rounded-[10px] border border-gf-line bg-gf-bar p-1">
                  {(['any', 'remote', 'hybrid', 'onsite'] as const).map(r => (
                    <button key={r} type="button" role="radio" aria-checked={remote === r} onClick={() => setRemote(r)}
                      className={`min-h-9 rounded-[7px] text-sm capitalize ${remote === r ? 'bg-gf-accent font-semibold text-gf-bg' : 'text-gf-muted'}`}>
                      {r === 'onsite' ? 'On-site' : r}
                    </button>
                  ))}
                </div>
              </div>
              <details className="group">
                <summary className="cursor-pointer text-sm text-gf-muted">More filters</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <Field id="jh-salary" label="Minimum salary (yearly)" value={minSalary} onChange={setMinSalary} placeholder="e.g. 8000000" inputMode="numeric" />
                  <Field id="jh-deal" label="Dealbreakers" value={dealbreakers} onChange={setDealbreakers} placeholder="agency, crypto, relocation" />
                  <Field id="jh-comp" label="Company boards to watch" value={companies} onChange={setCompanies} placeholder="stripe, ashby:openai, workable:acme" />
                  <span className="-mt-2 text-xs text-gf-muted">A company&apos;s job-board name. Plain names are tried on Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee.</span>
                  <Field id="jh-age" label="Hide jobs older than (days)" value={maxAge} onChange={setMaxAge} placeholder="30" inputMode="numeric" />
                </div>
              </details>
              <button type="button" onClick={() => void search()} disabled={busy === 'search' || !profile?.cv}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-gf-accent text-[15px] font-semibold text-gf-bg disabled:opacity-60">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B0D12" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                {busy === 'search' ? 'Searching and scoring…' : 'Find matching jobs'}
              </button>
              <p className="text-xs leading-relaxed text-gf-muted">
                Best matches are prepared automatically — tailored CV, cover letter and form answers — then wait for your approval, unless autopilot is on.
              </p>
            </section>

            {profile && (
              <SavedSearchesCard searches={profile.savedSearches || []} digest={profile.digest} busy={busy} jobs={jobs}
                current={{ titles: splitList(roles), locations: splitList(places), remote, companies: splitList(companies) }}
                onSave={(list, message) => void saveSearches(list, message)}
                onUse={s => { setRoles(s.titles.join(', ')); setPlaces(s.locations.join(', ')); setRemote(s.remote); setCompanies(s.companies.join(', ')); setNotice({ tone: 'info', text: `Loaded "${s.name}". Find matching jobs to search it now.` }) }}
                onDigest={(d, message) => void saveDigest(d, message)}
                onRunNow={() => void runDigestNow()}
                onOpen={id => setSelected(id)} />
            )}

            <form className="flex flex-col gap-2.5 rounded-2xl border border-gf-line bg-gf-surface p-5" onSubmit={e => { e.preventDefault(); if (jobUrl.trim()) void addByUrl() }}>
              <label htmlFor="jh-url" className="font-display text-sm font-semibold">Add a job by link</label>
              <span className="text-xs text-gf-muted">Paste any job: LinkedIn, a company careers page, Workday, Greenhouse…</span>
              <div className="flex gap-2">
                <input id="jh-url" type="url" inputMode="url" value={jobUrl} onChange={e => setJobUrl(e.target.value)} placeholder="https://…"
                  className="h-11 min-w-0 flex-1 rounded-[10px] border border-gf-line bg-gf-bar px-3 text-sm" />
                <button type="submit" disabled={!jobUrl.trim() || busy === 'add-url'} className="min-h-11 shrink-0 rounded-[10px] border border-gf-line2 px-3 text-sm font-semibold disabled:opacity-60">
                  {busy === 'add-url' ? 'Reading…' : 'Add'}
                </button>
              </div>
            </form>

            <section className="flex flex-col gap-2.5 rounded-2xl border border-gf-line bg-gf-surface p-5">
              <h2 className="font-display text-sm font-semibold">Sources</h2>
              <SourceRow name="LinkedIn · Indeed (JSearch)" state={jsearch ? 'connected' : 'add JSEARCH_API_KEY'} ok={jsearch} />
              <SourceRow name="Remotive · RemoteOK · We Work Remotely" state="on" ok />
              <SourceRow name="Himalayas · Jobicy · HN Who is hiring" state="on" ok />
              <SourceRow name="The Muse · Arbeitnow" state={remote === 'remote' ? 'off (remote only)' : 'on'} ok={remote !== 'remote'} />
              <SourceRow name="Adzuna" state={keyed?.adzuna ? 'connected' : 'add ADZUNA_APP_ID/KEY'} ok={Boolean(keyed?.adzuna)} />
              <SourceRow name="USAJobs" state={keyed?.usajobs ? 'connected' : 'add USAJOBS_API_KEY'} ok={Boolean(keyed?.usajobs)} />
              <SourceRow name="Reed (UK)" state={keyed?.reed ? 'connected' : 'add REED_API_KEY'} ok={Boolean(keyed?.reed)} />
              <SourceRow name="Company boards" state={companies ? `${splitList(companies).length} watched` : 'none'} ok={Boolean(companies)} />
              <span className="text-xs text-gf-muted">Old postings, broken links and likely scams are removed. Only verified postings are applied to by autopilot.</span>
              {lastSearch?.report.filter(r => r.error).map(r => (
                <span key={r.source} className="text-xs text-red-300">{r.source}: {r.error}</span>
              ))}
              {lastSearch?.report.filter(r => r.note).map(r => (
                <span key={`n:${r.source}`} className="text-xs text-gf-warn">{r.source} ({r.count}): {r.note}</span>
              ))}
              {linkedin && <a href={linkedin} target="_blank" rel="noreferrer" className="mt-1 text-sm text-sky-300 hover:text-sky-200">Open this search on LinkedIn ↗</a>}
            </section>

            {autopilot && (
              <AutomationCard model={model} autopilot={autopilot} busy={busy} linkedin={linkedinStatus}
                onLinkedIn={a => void linkedinAction(a)}
                onModel={m => void saveAutomation({ model: m }, m ? `Job Hunter now uses ${m.model}.` : 'Job Hunter now uses automatic free models, including local and anonymous models.')}
                onAutopilot={(a, msg) => void saveAutomation({ autopilot: a }, msg)}
                onRunNow={() => void runAutopilotNow()} />
            )}

            <section className="rounded-2xl border border-gf-line bg-gf-surface p-5">
              <button type="button" onClick={() => setShowDetails(v => !v)} aria-expanded={showDetails}
                className="flex w-full items-center justify-between font-display text-sm font-semibold">
                Application details <span className="text-gf-muted">{showDetails ? '−' : '+'}</span>
              </button>
              {showDetails && applicant && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {(['firstName', 'lastName', 'email', 'phone', 'city', 'country', 'linkedin', 'github', 'portfolio'] as const).map(k => (
                    <Field key={k} id={`jh-a-${k}`} label={LABELS[k]} value={applicant[k]} wide={['email', 'linkedin', 'github', 'portfolio'].includes(k)}
                      onChange={v => setApplicant({ ...applicant, [k]: v })} />
                  ))}
                  <YesNo id="jh-auth" label="Authorized to work" value={applicant.workAuthorized} onChange={v => setApplicant({ ...applicant, workAuthorized: v })} />
                  <YesNo id="jh-visa" label="Needs visa sponsorship" value={applicant.needsSponsorship} onChange={v => setApplicant({ ...applicant, needsSponsorship: v })} />
                  <button type="button" onClick={() => void saveApplicant()} disabled={busy === 'applicant'}
                    className="col-span-2 min-h-11 rounded-xl border border-gf-line2 text-sm font-semibold disabled:opacity-60">
                    {busy === 'applicant' ? 'Saving…' : 'Save details'}
                  </button>
                </div>
              )}
            </section>
          </aside>

          <main className="flex min-w-0 flex-col gap-5">
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              {stats.map(s => (
                <div key={s.label} className="flex flex-col gap-1.5 rounded-[14px] border border-gf-line bg-gf-surface px-[18px] py-4">
                  <span className="text-sm text-gf-muted">{s.label}</span>
                  <span className={`font-display text-3xl font-semibold ${s.tone}`}>{s.value}</span>
                </div>
              ))}
            </div>

            <section aria-label="Multiple job applications" className="flex flex-col gap-3 rounded-2xl border border-gf-line bg-gf-surface p-5">
              <h2 className="font-display text-base font-semibold">Apply to multiple jobs</h2>
              <p className="text-sm text-gf-muted">Select jobs below. Prepare selected jobs first, then review the exact applications and explicitly confirm. Jobs run one at a time. Keep this page open until the batch finishes.</p>
              <div className="flex flex-wrap gap-3">
                <span className="self-center text-sm">{batchJobs.length} selected</span>
                <button type="button" disabled={Boolean(busy) || !batchJobs.length} onClick={() => void runBatch('prepare')}
                  className="min-h-11 rounded-xl border border-gf-line2 px-4 text-sm disabled:opacity-60">Prepare / retry AI for selected</button>
                <button type="button" disabled={Boolean(busy) || !batchCanApply} onClick={() => setBatchReview(true)}
                  className="min-h-11 rounded-xl bg-gf-accent px-4 text-sm font-semibold text-gf-bg disabled:opacity-60">Review selected applications</button>
                <button type="button" disabled={Boolean(busy) || !batchIds.length} onClick={() => { setBatchIds([]); setBatchReview(false) }}
                  className="min-h-11 px-3 text-sm disabled:opacity-60">Clear selection</button>
              </div>
              {batchProgress && <p role="status" className="text-sm text-sky-200">{batchProgress}</p>}
              {batchReview && (
                <div role="region" aria-label="Confirm selected applications" className="flex flex-col gap-3 rounded-xl border border-amber-700 p-4">
                  <h3 className="font-semibold">Review and approve these {batchJobs.length} applications</h3>
                  <p className="text-sm">Confirmation authorizes submission for exactly the jobs listed below. Captchas, sign-ins and unknown answers still stop for you. Review each CV, letter and answers, including any non-AI draft warnings.</p>
                  {batchJobs.map(job => (
                    <details key={job.id} className="rounded-lg border border-gf-line p-3">
                      <summary className="cursor-pointer text-sm font-semibold">{job.title} at {job.company} · {job.location || 'Location not provided'}{job.preparationWarning ? ' · Non-AI draft: review required' : ''}</summary>
                      {job.preparationWarning && <p className="my-3 text-sm text-gf-warn">{job.preparationWarning}</p>}
                      <p className="my-3 whitespace-pre-wrap break-words text-sm">{job.description || 'Description not provided'}</p>
                      <h4 className="mt-3 font-semibold">{job.preparationWarning ? 'Original CV' : 'Tailored CV'}</h4>
                      <pre className="whitespace-pre-wrap break-words text-sm">{job.tailoredResume}</pre>
                      <h4 className="mt-3 font-semibold">Cover letter</h4>
                      <pre className="whitespace-pre-wrap break-words text-sm">{job.coverLetter}</pre>
                      <h4 className="mt-3 font-semibold">Form answers</h4>
                      {(job.answers || []).map(answer => <p key={answer.label} className="text-sm">{answer.label}: {answer.value}</p>)}
                    </details>
                  ))}
                  <div className="flex flex-wrap gap-3">
                    <button type="button" disabled={Boolean(busy) || !batchCanApply} onClick={() => void runBatch('approve')}
                      className="min-h-11 rounded-xl bg-gf-accent px-4 text-sm font-semibold text-gf-bg disabled:opacity-60">Confirm & apply to {batchJobs.length} selected jobs</button>
                    <button type="button" onClick={() => setBatchReview(false)} className="min-h-11 px-3 text-sm">Cancel batch approval</button>
                  </div>
                </div>
              )}
              {batchResults.length > 0 && (
                <ul aria-label="Batch application results" className="flex flex-col gap-2">
                  {batchResults.map(result => <li key={result.id} className="text-sm"><strong>{result.title}</strong> · {STATUS_VIEW[result.status]?.label || result.status}: {result.message}</li>)}
                </ul>
              )}
            </section>

            <section className="flex min-h-0 flex-col rounded-2xl border border-gf-line bg-gf-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gf-line px-5 py-4">
                <div role="tablist" aria-label="Job lists" className="flex flex-wrap gap-2">
                  {([['waiting', 'Waiting for you'], ['all', 'All matches'], ['applied', 'Applied']] as const).map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
                      className={`min-h-9 rounded-lg px-3.5 text-sm ${tab === k ? 'bg-gf-raised font-semibold' : 'text-gf-muted'}`}>
                      {label} · {lists[k].length}
                    </button>
                  ))}
                </div>
                <span className="text-sm text-gf-muted">{tab === 'all' ? 'Sorted by fit' : 'Newest first'}</span>
              </div>
              {lists[tab].length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-gf-muted">
                  {!profile?.cv ? 'Upload your CV to start.' : tab === 'waiting' ? 'Nothing waiting. Run a search, or prepare a job from All matches.' : tab === 'applied' ? 'No applications sent yet.' : 'No matches yet — run a search.'}
                </p>
              ) : (
                <ul>
                  {lists[tab].map(j => {
                    const sv = STATUS_VIEW[j.status] || STATUS_VIEW.found
                    const cta = j.status === 'found' ? () => void act('prepare', j.id) : () => setSelected(j.id)
                    return (
                      <li key={j.id} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4 border-b border-[#1C2130] px-5 py-[18px] sm:grid-cols-[76px_minmax(0,1fr)_auto]">
                        <div className={`flex flex-col items-center gap-1 rounded-xl py-2 ${FIT_STYLE[j.fit] || FIT_STYLE.Low}`}>
                          <input type="checkbox" aria-label={`Select ${j.title} at ${j.company}`} checked={batchIdSet.has(j.id)}
                            disabled={Boolean(busy) || !['found', 'ready', 'needs_user', 'failed'].includes(j.status)}
                            onChange={() => toggleBatch(j.id)} className="h-5 w-5 accent-sky-300" />
                          <span className="font-display text-xl font-bold">{j.score}</span>
                          <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">{j.fit}</span>
                        </div>
                        <button type="button" onClick={() => setSelected(j.id)} className="flex min-w-0 flex-col gap-1.5 text-start">
                          <span className="flex flex-wrap items-baseline gap-x-2.5">
                            <span className="text-base font-semibold">{j.title}</span>
                            <span className="text-sm text-gf-muted">{j.company}</span>
                          </span>
                          <span className="flex flex-wrap gap-x-3.5 text-sm text-gf-muted">
                            <span>{j.location || '—'}{j.remote ? ' · Remote' : ''}</span>
                            {j.salary && <span>{j.salary}</span>}
                            {j.postedAt && <span>Posted {postingDate(j.postedAt)}</span>}
                            <span className="font-mono">{j.source}</span>
                            <span className="font-mono capitalize">{j.ats}</span>
                            <VerifyBadge job={j} />
                          </span>
                          {j.reasons && <span className="text-sm text-slate-300">{j.reasons}</span>}
                          {j.activity && <span className="text-sm text-sky-200">{j.activity.phase}: {j.activity.message}</span>}
                          {j.description && <span className="line-clamp-2 whitespace-pre-line text-sm text-gf-muted">{j.description}</span>}
                        </button>
                        <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sv.style}`}>{sv.label}</span>
                          <button type="button" onClick={cta} disabled={Boolean(busy)}
                            className="inline-flex min-h-10 items-center rounded-[10px] bg-gf-ink px-4 text-sm font-semibold text-gf-bg disabled:opacity-60">
                            {busy === `prepare:${j.id}` ? 'Preparing…' : sv.cta}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </main>
        </div>
      )}
    </div>
  )
}

const LABELS: Record<string, string> = {
  firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Phone', city: 'City', country: 'Country',
  linkedin: 'LinkedIn URL', github: 'GitHub URL', portfolio: 'Portfolio URL',
}

function Field({ id, label, value, onChange, placeholder, inputMode, wide }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string
  inputMode?: 'numeric' | 'text'; wide?: boolean
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${wide ? 'col-span-2' : ''}`}>
      <label htmlFor={id} className="text-xs uppercase tracking-[0.06em] text-gf-muted">{label}</label>
      <input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode}
        className="h-11 rounded-[10px] border border-gf-line bg-gf-bar px-3 text-sm outline-none placeholder:text-slate-500 focus:border-gf-accent" />
    </div>
  )
}

function YesNo({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: 'yes' | 'no' | '') => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs uppercase tracking-[0.06em] text-gf-muted">{label}</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value as 'yes' | 'no' | '')}
        className="h-11 rounded-[10px] border border-gf-line bg-gf-bar px-3 text-sm">
        <option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
    </div>
  )
}

function SourceRow({ name, state, ok }: { name: string; state: string; ok: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span>{name}</span>
      <span className={`font-mono ${ok ? 'text-gf-ok' : 'text-gf-muted'}`}>{state}</span>
    </div>
  )
}

function postingDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10)
}

function Review({ job, busy, onBack, onApprove, onPrepare, onDismiss, onAnswer }: {
  job: JobRecord; busy: string; onBack: () => void; onApprove: (confirmResubmit: boolean) => void; onPrepare: () => void; onDismiss: () => void
  onAnswer: (answers: Record<string, string>) => void
}) {
  const sv = STATUS_VIEW[job.status] || STATUS_VIEW.found
  const prepared = Boolean(job.tailoredResume)
  const approving = busy === `approve:${job.id}`
  const canApprove = prepared && ['ready', 'needs_user', 'failed'].includes(job.status)
  const [draft, setDraft] = useState<Record<string, string>>({})
  // Submit was pressed before: the application may have been sent, so applying again needs an explicit check
  const pressedBefore = Boolean(job.submitPressedAt)
  const [resubmitOk, setResubmitOk] = useState(false)

  return (
    <div className="flex flex-col gap-5 px-4 py-6 lg:px-8 lg:py-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <button type="button" onClick={onBack} className="w-fit text-sm text-sky-300 hover:text-sky-200">← Back to jobs</button>
          <div className="flex flex-wrap items-baseline gap-x-3.5">
            <h1 className="font-display text-3xl font-bold tracking-tight">{job.title}</h1>
            <span className="text-lg text-gf-muted">{job.company}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-sm text-gf-muted">
            <span className={`rounded-full px-2.5 py-1 font-semibold ${FIT_STYLE[job.fit]}`}>{job.score} · {job.fit} fit</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sv.style}`}>{sv.label}</span>
            <span>{job.location}{job.remote ? ' · Remote' : ''}</span>
            <span className="font-mono">{job.source}</span>
            <span className="font-mono capitalize">{job.ats} form</span>
            <VerifyBadge job={job} />
            {job.url && <a href={job.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:text-sky-200">View posting ↗</a>}
          </div>
          {job.verification && job.verification.flags.length > 0 && (
            <ul className={`flex list-disc flex-col gap-0.5 ps-5 text-sm ${job.verification.status === 'flagged' ? 'text-red-300' : 'text-gf-muted'}`}>
              {job.verification.flags.map(f => <li key={f}>{f}</li>)}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onDismiss} disabled={Boolean(busy) || job.status === 'submitting'} className="min-h-12 rounded-xl border border-gf-line2 px-5 text-[15px] disabled:opacity-60">Dismiss</button>
          {prepared && job.preparationWarning && canApprove && (
            <button type="button" onClick={onPrepare} disabled={Boolean(busy)}
              className="min-h-12 rounded-xl border border-gf-line2 px-5 text-[15px] disabled:opacity-60">
              {busy === `prepare:${job.id}` ? 'Preparing…' : 'Retry AI tailoring'}
            </button>
          )}
          {prepared ? (
            <button type="button" onClick={() => onApprove(pressedBefore && resubmitOk)} disabled={!canApprove || Boolean(busy) || (pressedBefore && !resubmitOk)}
              className="flex min-h-12 items-center gap-2 rounded-xl bg-gf-accent px-6 text-[15px] font-semibold text-gf-bg disabled:opacity-60">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B0D12" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
              {approving ? 'Filling the form…' : job.status === 'needs_user' ? 'Open & fill again' : 'Approve & apply'}
            </button>
          ) : (
            <button type="button" onClick={onPrepare} disabled={busy === `prepare:${job.id}`}
              className="min-h-12 rounded-xl bg-gf-accent px-6 text-[15px] font-semibold text-gf-bg disabled:opacity-60">
              {busy === `prepare:${job.id}` ? 'Preparing…' : 'Prepare application'}
            </button>
          )}
        </div>
      </div>

      <Panel title="Job details" note="As provided by the source; missing information is not inferred">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {([
            ['Company', job.company || 'Not provided'],
            ['Location', job.location || 'Not provided'],
            ['Remote work', job.remote ? 'Yes (check location restrictions below)' : 'Not marked remote by source'],
            ['Salary', job.salary || 'Not provided'],
            ['Posted', job.postedAt ? postingDate(job.postedAt) : 'Not provided'],
            ['Source', job.source],
            ['Application system', job.ats],
            ['Match assessment', job.reasons || 'Not provided'],
          ]).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-gf-muted">{label}</dt>
              <dd className="whitespace-pre-wrap break-words text-slate-200">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          {job.url && <a href={job.url} target="_blank" rel="noreferrer" className="text-sky-300">Original posting ↗</a>}
          {job.applyUrl && <a href={job.applyUrl} target="_blank" rel="noreferrer" className="text-sky-300">Application page ↗</a>}
        </div>
        <h3 className="mb-2 mt-5 font-display text-base font-semibold">Job description</h3>
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">{job.description || 'The source did not provide a description. Open the original posting for requirements and responsibilities.'}</p>
      </Panel>

      <div className="flex items-start gap-3 rounded-xl border border-cyan-800 bg-gf-accent-soft px-4 py-3.5 text-sm text-sky-100">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7DD3FC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
        <span>
          When you approve, GhostForge opens the application in its own browser, fills every step, uploads your CV and cover letter, answers questions only from your CV and profile, and submits.
          {job.ats === 'linkedin' ? ' LinkedIn jobs use Easy Apply with your connected LinkedIn account.' : ''}
          {' '}It stops for captchas, sign-ins and questions it can&apos;t answer truthfully, and lists those below for you.
        </span>
      </div>

      {pressedBefore && canApprove && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-amber-700/60 bg-amber-950/20 px-4 py-3 text-sm text-gf-warn">
          <span>Submit was already pressed for this application on {postingDate(job.submitPressedAt || '')}, so it may have been sent. Check your email or the website before applying again.</span>
          <label className="flex items-center gap-2 text-slate-200">
            <input type="checkbox" checked={resubmitOk} onChange={e => setResubmitOk(e.target.checked)} className="size-4" />
            I checked: it was not sent. Fill and submit it again.
          </label>
        </div>
      )}

      {job.preparationWarning && (
        <div role="status" className="rounded-xl border border-amber-700/60 bg-amber-950/20 px-4 py-3 text-sm text-gf-warn">
          {job.preparationWarning}
        </div>
      )}

      <ApplicationMonitor key={job.id} job={job} applying={approving} />

      {!!job.questions?.length && (
        <form className="flex flex-col gap-3 rounded-2xl border border-amber-700/60 bg-amber-950/20 p-5"
          onSubmit={e => { e.preventDefault(); onAnswer(draft) }}>
          <h2 className="font-display text-base font-semibold">Questions for you ({job.questions.length})</h2>
          <p className="text-sm text-gf-muted">The application needs these and your CV doesn&apos;t say. Answer once: GhostForge saves them and reuses them on every later form, then retries this job.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {job.questions.map((q, i) => (
              <label key={q.label + i} className="flex flex-col gap-1.5 text-sm">
                <span>{q.label}</span>
                {q.options.length ? (
                  <select value={draft[q.label] ?? ''} onChange={e => setDraft({ ...draft, [q.label]: e.target.value })}
                    className="h-11 rounded-[10px] border border-gf-line bg-gf-bar px-3">
                    <option value="">Choose…</option>
                    {q.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : q.type === 'textarea' ? (
                  <textarea rows={3} value={draft[q.label] ?? ''} onChange={e => setDraft({ ...draft, [q.label]: e.target.value })}
                    className="rounded-[10px] border border-gf-line bg-gf-bar px-3 py-2" />
                ) : (
                  <input value={draft[q.label] ?? ''} inputMode={q.type === 'number' ? 'numeric' : undefined} onChange={e => setDraft({ ...draft, [q.label]: e.target.value })}
                    className="h-11 rounded-[10px] border border-gf-line bg-gf-bar px-3" />
                )}
              </label>
            ))}
          </div>
          <button type="submit" disabled={!Object.values(draft).some(v => v.trim()) || busy === `answer:${job.id}`}
            className="min-h-11 w-fit rounded-xl bg-gf-accent px-5 text-sm font-semibold text-gf-bg disabled:opacity-60">
            {busy === `answer:${job.id}` ? 'Saving…' : 'Save answers'}
          </button>
        </form>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_380px]">
        <Panel title={job.preparationWarning ? 'Original CV' : 'Tailored CV'} note={job.preparationWarning ? 'Unchanged, not AI-tailored' : 'Only facts from your CV — reordered for this role'}>
          <pre className="whitespace-pre-wrap font-plex text-sm leading-relaxed text-slate-300">{job.tailoredResume || 'Not prepared yet.'}</pre>
        </Panel>
        <Panel title="Cover letter">
          <pre className="whitespace-pre-wrap font-plex text-sm leading-7 text-slate-300">{job.coverLetter || 'Not prepared yet.'}</pre>
        </Panel>
        <section className="flex flex-col rounded-2xl border border-gf-line bg-gf-surface">
          <div className="flex items-center justify-between border-b border-gf-line px-[18px] py-4">
            <h2 className="font-display text-base font-semibold">Form answers</h2>
          </div>
          <dl>
            {(job.answers || []).map(a => (
              <div key={a.label} className="flex justify-between gap-3 border-b border-[#1C2130] px-[18px] py-[11px] text-sm">
                <dt className="text-gf-muted">{a.label}</dt>
                <dd className="text-end font-mono text-xs">{a.value}</dd>
              </div>
            ))}
            {!job.answers?.length && <p className="px-[18px] py-4 text-sm text-gf-muted">Answers appear once the application is prepared.</p>}
            {(job.aiAnswers || []).map(a => (
              <div key={`ai-${a.label}`} className="flex justify-between gap-3 border-b border-[#1C2130] px-[18px] py-[11px] text-sm">
                <dt className="text-gf-muted">{a.label} <span className="rounded bg-gf-violet-soft px-1 text-[10px] text-gf-violet">AI, from your CV</span></dt>
                <dd className="max-w-[60%] text-end font-mono text-xs">{a.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-2 px-[18px] py-4">
            <span className="text-xs uppercase tracking-[0.06em] text-gf-muted">Activity</span>
            <ol className="flex flex-col gap-1.5">
              {job.log.slice(-8).map((l, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="shrink-0 font-mono text-slate-500">{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>{l.msg}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  )
}

/** Saved searches and the new-jobs digest (never prepares or submits) */
function SavedSearchesCard({ searches, digest, busy, jobs, current, onSave, onUse, onDigest, onRunNow, onOpen }: {
  searches: SavedSearch[]
  digest?: DigestSettings
  busy: string
  jobs: JobRecord[]
  current: Pick<SavedSearch, 'titles' | 'locations' | 'remote' | 'companies'>
  onSave: (list: SavedSearch[], message: string) => void
  onUse: (s: SavedSearch) => void
  onDigest: (d: Partial<DigestSettings>, message?: string) => void
  onRunNow: () => void
  onOpen: (id: string) => void
}) {
  const saving = busy === 'saved'
  const canSave = current.titles.length > 0 && searches.length < 10
  const saveCurrent = () => {
    const name = `${current.titles.join(', ')} · ${current.locations.join(', ') || 'anywhere'}${current.remote !== 'any' ? ` · ${current.remote}` : ''}`.slice(0, 80)
    onSave([...searches, { id: '', name, ...current, enabled: true }], `Saved "${name}".`)
  }
  const known = new Set(jobs.map(j => j.id))
  return (
    <section aria-label="Saved searches and digest" className="flex flex-col gap-3 rounded-2xl border border-gf-line bg-gf-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold">Saved searches &amp; digest</h2>
        <button type="button" onClick={saveCurrent} disabled={!canSave || saving}
          className="min-h-9 rounded-lg border border-gf-line2 px-3 text-sm disabled:opacity-60">Save current search</button>
      </div>
      {searches.length === 0 ? (
        <p className="text-xs text-gf-muted">Save a few searches (role, location, work style, company boards). The digest checks each one and sends you new High-fit jobs, without autopilot.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {searches.map(s => (
            <li key={s.id} className="flex flex-col gap-1.5 rounded-xl border border-gf-line p-3 text-sm">
              <span className="font-semibold">{s.name}</span>
              <span className="text-xs text-gf-muted">{s.titles.join(', ')} · {s.locations.join(', ') || 'any location'} · {s.remote}{s.companies.length ? ` · ${s.companies.length} board(s)` : ''}</span>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-h-9 items-center gap-2 text-xs">
                  <input type="checkbox" checked={s.enabled} disabled={saving} className="size-4"
                    onChange={e => onSave(searches.map(x => x.id === s.id ? { ...x, enabled: e.target.checked } : x), e.target.checked ? `"${s.name}" is in the digest.` : `"${s.name}" is left out of the digest.`)} />
                  In digest
                </label>
                <button type="button" onClick={() => onUse(s)} className="min-h-9 text-xs text-sky-300 hover:text-sky-200">Use</button>
                <button type="button" disabled={saving} onClick={() => onSave(searches.filter(x => x.id !== s.id), `Deleted "${s.name}".`)}
                  className="min-h-9 text-xs text-gf-muted hover:text-gf-ink disabled:opacity-60">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {digest && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-gf-line p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Digest of new High-fit jobs</span>
            <button type="button" role="switch" aria-checked={digest.enabled} disabled={busy === 'digest'}
              onClick={() => onDigest({ enabled: !digest.enabled }, digest.enabled ? 'The digest is off.' : `The digest is on: every ${digest.intervalHours} hours. It only searches; nothing is prepared or submitted.`)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${digest.enabled ? 'bg-gf-accent' : 'bg-gf-line2'}`}>
              <span className="sr-only">Digest</span>
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-gf-bg transition-all ${digest.enabled ? 'start-6' : 'start-1'}`} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberSetting id="jh-dg-every" label="Every (hours)" value={digest.intervalHours} min={1} max={168} onCommit={v => onDigest({ intervalHours: v })} />
            <NumberSetting id="jh-dg-score" label="Min score" value={digest.minScore} min={50} max={100} onCommit={v => onDigest({ minScore: v })} />
          </div>
          {digest.lastRunAt && <span className="text-xs text-gf-muted">Last digest {new Date(digest.lastRunAt).toLocaleString()}: {digest.lastResult}</span>}
          <button type="button" onClick={onRunNow} disabled={busy === 'digest-run'}
            className="min-h-11 rounded-xl border border-gf-line2 text-sm font-semibold disabled:opacity-60">
            {busy === 'digest-run' ? 'Checking searches…' : 'Check saved searches now'}
          </button>
          {!!digest.lastDigest?.jobs.length && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-[0.06em] text-gf-muted">New on {new Date(digest.lastDigest.at).toLocaleDateString()}</span>
              <ul aria-label="Latest digest" className="flex flex-col gap-1">
                {digest.lastDigest.jobs.map(e => (
                  <li key={e.id} className="text-sm">
                    {known.has(e.id)
                      ? <button type="button" onClick={() => onOpen(e.id)} className="text-start text-sky-300 hover:text-sky-200">{e.title} at {e.company}</button>
                      : <span>{e.title} at {e.company}</span>}
                    <span className="text-gf-muted"> · {e.score}{e.search ? ` · ${e.search}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <span className="text-xs text-gf-muted">One phone notification per digest when push is set up on a device; the list always appears here. No email is sent. With no saved search, your main search is used.</span>
        </div>
      )}
    </section>
  )
}

interface ModelOption { value: string; label: string; group: string }

/** Autopilot + AI model settings */
function AutomationCard({ model, autopilot, busy, linkedin, onLinkedIn, onModel, onAutopilot, onRunNow }: {
  linkedin: { connected: boolean; connectedAt: string | null }
  onLinkedIn: (action: 'linkedin-connect' | 'linkedin-disconnect') => void
  model: ModelChoice | null
  autopilot: AutopilotSettings & { submittedToday: number }
  busy: string
  onModel: (m: ModelChoice | null) => void
  onAutopilot: (a: Partial<AutopilotSettings>, message?: string) => void
  onRunNow: () => void
}) {
  const [options, setOptions] = useState<ModelOption[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [customForm, setCustomForm] = useState({ name: '', baseURL: '', model: '', apiKey: '' })
  const [customNotice, setCustomNotice] = useState<string | null>(null)

  const refreshOptions = useCallback(() => {
    fetch('/api/models').then(r => (r.ok ? r.json() : null)).then(data => {
      if (!data) return
      const opts: ModelOption[] = []
      for (const p of data.providers || []) {
        for (const m of p.models || []) opts.push({ value: `${p.id}|${m.id}`, label: `${m.label || m.id}${m.free ? ' (free)' : ''}`, group: p.name })
      }
      for (const c of data.custom || []) opts.push({ value: `custom|${c.id}`, label: c.name, group: 'Custom models' })
      for (const name of data.ollama?.models || []) opts.push({ value: `ollama|${name}`, label: name, group: 'Local (Ollama)' })
      setOptions(opts)
    }).catch(() => {})
  }, [])

  useEffect(() => { refreshOptions() }, [refreshOptions])

  const addCustomModel = async () => {
    setCustomNotice(null)
    try {
      const r = await fetch('/api/models/custom', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: customForm.name.trim(), baseURL: customForm.baseURL.trim(), model: customForm.model.trim(), apiKey: customForm.apiKey.trim() || undefined }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `Failed (${r.status})`)
      setCustomForm({ name: '', baseURL: '', model: '', apiKey: '' })
      setShowAdd(false)
      refreshOptions()
      if (data.model?.id) onModel({ provider: 'custom', model: data.model.id })
      setCustomNotice(`Added “${data.model?.name ?? 'model'}”.`)
    } catch (e) {
      setCustomNotice(e instanceof Error ? e.message : 'Could not add the model')
    }
  }

  const current = model ? `${model.provider}|${model.model}` : ''
  const groups = [...new Set(options.map(o => o.group))]
  const known = !current || options.some(o => o.value === current)

  const toggle = () => {
    if (autopilot.enabled) { onAutopilot({ enabled: false }, 'Autopilot is off. Nothing will be submitted automatically.'); return }
    const ok = window.confirm(
      `Turn on autopilot?\n\nEvery ${autopilot.intervalHours} hours GhostForge will search, tailor your CV and cover letter, and SUBMIT up to ${autopilot.dailyLimit} applications a day ` +
      `for High-fit jobs scoring ${autopilot.minScore}+ ${autopilot.mode === 'full' ? 'on any site it can complete' : 'on Lever, Greenhouse and Ashby'}${autopilot.linkedinEasyApply && linkedin.connected ? ', plus LinkedIn Easy Apply' : ''}, using your CV and application details. ` +
      'It never invents answers: questions it can\'t answer from your CV come to you first.')
    if (ok) onAutopilot({ enabled: true }, 'Autopilot is on.')
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-gf-line bg-gf-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold">Autopilot &amp; AI model</h2>
        <button type="button" role="switch" aria-checked={autopilot.enabled} onClick={toggle} disabled={busy === 'automation'}
          className={`relative h-7 w-12 rounded-full transition-colors ${autopilot.enabled ? 'bg-gf-accent' : 'bg-gf-line2'}`}>
          <span className="sr-only">Autopilot</span>
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-gf-bg transition-all ${autopilot.enabled ? 'start-6' : 'start-1'}`} />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="jh-model" className="text-xs uppercase tracking-[0.06em] text-gf-muted">AI model</label>
        <select id="jh-model" value={current} disabled={busy === 'automation'}
          onChange={e => {
            const v = e.target.value
            if (!v) return onModel(null)
            const i = v.indexOf('|')
            onModel({ provider: v.slice(0, i), model: v.slice(i + 1) })
          }}
          className="h-11 rounded-[10px] border border-gf-line bg-gf-bar px-3 text-sm">
          <option value="">Free models (automatic — no API key needed)</option>
          {!known && model && <option value={current}>{model.model} ({model.provider})</option>}
          {groups.map(g => (
            <optgroup key={g} label={g}>
              {options.filter(o => o.group === g).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="text-xs text-gf-muted">Used for fit scoring, CV tailoring and cover letters. Automatic mode tries configured free-tier models, installed local models (no account/key), then anonymous Pollinations (no signup/key, availability and length limits apply). Existing provider and custom models remain selectable. Anonymous requests use private mode; choose a local model to keep CV text on this server.</span>
        <button type="button" onClick={() => setShowAdd(v => !v)} className="self-start text-xs text-gf-accent underline-offset-2 hover:underline">
          {showAdd ? 'Cancel' : '+ Add another model (OpenAI-compatible)'}
        </button>
        {showAdd && (
          <div className="flex flex-col gap-2 rounded-xl border border-gf-line p-3">
            {([['name', 'Name (e.g. My gateway)'], ['baseURL', 'Base URL (e.g. http://localhost:1234/v1)'], ['model', 'Model id'], ['apiKey', 'API key (optional)']] as const).map(([k, ph]) => (
              <input key={k} value={customForm[k]} onChange={e => setCustomForm(f => ({ ...f, [k]: e.target.value }))}
                placeholder={ph} aria-label={ph} type={k === 'apiKey' ? 'password' : 'text'}
                className="h-9 rounded-[8px] border border-gf-line bg-gf-bar px-2.5 text-sm" />
            ))}
            <button type="button" onClick={() => void addCustomModel()} disabled={!customForm.name.trim() || !customForm.baseURL.trim() || !customForm.model.trim()}
              className="h-9 rounded-[8px] bg-gf-accent px-3 text-sm font-semibold text-gf-bg disabled:opacity-50">
              Save model
            </button>
          </div>
        )}
        {customNotice && <span className="text-xs text-gf-muted">{customNotice}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <NumberSetting id="jh-ap-every" label="Every (hours)" value={autopilot.intervalHours} min={1} max={168}
          onCommit={v => onAutopilot({ intervalHours: v })} />
        <NumberSetting id="jh-ap-limit" label="Max per day" value={autopilot.dailyLimit} min={1} max={25}
          onCommit={v => onAutopilot({ dailyLimit: v })} />
        <NumberSetting id="jh-ap-score" label="Min score" value={autopilot.minScore} min={50} max={100}
          onCommit={v => onAutopilot({ minScore: v })} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-xs uppercase tracking-[0.06em] text-gf-muted">Where autopilot may submit</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {([['safe', 'Safe sites', 'Lever, Greenhouse, Ashby'], ['full', 'Any site', 'Career sites, Workday, LinkedIn'] ] as const).map(([v, label, hint]) => (
            <button key={v} type="button" role="radio" aria-checked={autopilot.mode === v} disabled={busy === 'automation'}
              onClick={() => onAutopilot({ mode: v }, v === 'full' ? 'Autopilot may now submit on any site the form agent can complete.' : 'Autopilot submits only on Lever, Greenhouse and Ashby.')}
              className={`flex flex-col items-start rounded-xl border p-2.5 text-start text-sm ${autopilot.mode === v ? 'border-gf-accent bg-gf-accent-soft' : 'border-gf-line'}`}>
              <span className="font-semibold">{label}</span>
              <span className="text-xs text-gf-muted">{hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 rounded-xl border border-gf-line p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">Apply on LinkedIn (Easy Apply)</span>
          <button type="button" role="switch" aria-checked={autopilot.linkedinEasyApply} disabled={busy === 'automation'}
            onClick={() => {
              if (autopilot.linkedinEasyApply) return onAutopilot({ linkedinEasyApply: false }, 'LinkedIn Easy Apply is off.')
              const ok = window.confirm('Apply through LinkedIn Easy Apply automatically?\n\nLinkedIn\'s terms do not allow automated tools, and LinkedIn may restrict accounts it believes are automated. GhostForge keeps it slow and capped, uses only your own signed-in account, and never solves captchas. Turn it on only if you accept that risk.')
              if (ok) onAutopilot({ linkedinEasyApply: true, mode: 'full' }, 'LinkedIn Easy Apply is on (autopilot set to Any site).')
            }}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${autopilot.linkedinEasyApply ? 'bg-gf-accent' : 'bg-gf-line2'}`}>
            <span className="sr-only">Apply on LinkedIn</span>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-gf-bg transition-all ${autopilot.linkedinEasyApply ? 'start-6' : 'start-1'}`} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gf-muted">
          {linkedin.connected ? <span className="text-gf-ok">LinkedIn connected</span> : <span>LinkedIn not connected</span>}
          <button type="button" disabled={busy === 'linkedin'} onClick={() => onLinkedIn(linkedin.connected ? 'linkedin-disconnect' : 'linkedin-connect')}
            className="min-h-9 rounded-lg border border-gf-line2 px-2.5 text-xs font-semibold disabled:opacity-60">
            {busy === 'linkedin' ? 'Opening…' : linkedin.connected ? 'Disconnect' : 'Connect LinkedIn'}
          </button>
          <NumberSetting id="jh-li-limit" label="LinkedIn per day" value={autopilot.linkedinDailyLimit} min={1} max={15}
            onCommit={v => onAutopilot({ linkedinDailyLimit: v })} />
        </div>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-xl border border-gf-line p-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Allow control of this computer when stuck</span>
          <span className="text-xs text-gf-muted">
            Off: everything runs in the background, no screen needed. On: when a form gets stuck, GhostForge opens a visible browser on this computer and uses
            computer use (screenshots + clicks) to get past it. Never for captchas or passwords.
          </span>
        </span>
        <button type="button" role="switch" aria-checked={autopilot.laptopControl} disabled={busy === 'automation'}
          onClick={() => onAutopilot({ laptopControl: !autopilot.laptopControl }, autopilot.laptopControl ? 'Computer control is off: applications run in the background.' : 'GhostForge may now use this computer when an application gets stuck.')}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${autopilot.laptopControl ? 'bg-gf-accent' : 'bg-gf-line2'}`}>
          <span className="sr-only">Allow control of this computer</span>
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-gf-bg transition-all ${autopilot.laptopControl ? 'start-6' : 'start-1'}`} />
        </button>
      </div>

      <div className="flex flex-col gap-1 rounded-xl border border-gf-line bg-gf-bar p-3 text-sm">
        <span className={autopilot.enabled ? 'text-gf-ok' : 'text-gf-muted'}>
          {autopilot.enabled ? `On — ${autopilot.submittedToday}/${autopilot.dailyLimit} submitted today` : 'Off — applications wait for your approval'}
        </span>
        {autopilot.lastRunAt && (
          <span className="text-xs text-gf-muted">Last run {new Date(autopilot.lastRunAt).toLocaleString()}: {autopilot.lastResult}</span>
        )}
      </div>

      <button type="button" onClick={onRunNow} disabled={busy === 'autopilot'}
        className="min-h-11 rounded-xl border border-gf-line2 text-sm font-semibold disabled:opacity-60">
        {busy === 'autopilot' ? 'Running autopilot…' : 'Run autopilot now'}
      </button>
      <p className="text-xs leading-relaxed text-gf-muted">
        Autopilot submits only High-fit jobs at or above your minimum score, within your daily limits. Answers come only from your CV and profile;
        anything else becomes a question for you (with a phone notification when push is set up), and the job is retried once you answer.
      </p>
    </section>
  )
}

function NumberSetting({ id, label, value, min, max, onCommit }: {
  id: string; label: string; value: number; min: number; max: number; onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  const commit = () => {
    const n = Math.round(Number(draft))
    if (!Number.isFinite(n)) { setDraft(String(value)); return }
    const v = Math.min(max, Math.max(min, n))
    setDraft(String(v))
    if (v !== value) onCommit(v)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] uppercase tracking-[0.06em] text-gf-muted">{label}</label>
      <input id={id} inputMode="numeric" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit() }}
        className="h-10 rounded-[10px] border border-gf-line bg-gf-bar px-3 text-sm" />
    </div>
  )
}

const ACTIVITY_LABELS: Record<ApplicationActivity['phase'], string> = {
  opening: 'Opening application', filling: 'Filling form', waiting_ai: 'Waiting for AI answers', submitting: 'Submitting',
  login: 'Waiting for login / account verification', captcha: 'Waiting for captcha',
  terms: 'Waiting for your terms / privacy review',
  questions: 'Waiting for your answers', blocked: 'Needs your attention',
  submitted: 'Submission confirmed', failed: 'Application failed',
}

function monitorActivity(job: JobRecord, active: boolean, live?: ApplicationActivity | null) {
  if (active) return live || job.activity
  return job.activity || live
}

function ApplicationMonitor({ job, applying }: { job: JobRecord; applying: boolean }) {
  const [previewEnabled, setPreviewEnabled] = useState(false)
  const [live, setLive] = useState<{ activity: ApplicationActivity | null; available: boolean; image: string | null; origin?: string } | null>(null)
  const [error, setError] = useState('')
  const active = applying || ['submitting', 'needs_user'].includes(job.status)
  const refreshMonitor = useCallback(async (signal: AbortSignal) => {
    try {
      if (document.visibilityState === 'hidden') return
      const result = await api<{ activity: ApplicationActivity | null; available: boolean; image: string | null; origin?: string }>(
        `/api/jobs/${encodeURIComponent(job.id)}/live${previewEnabled ? '?preview=1' : ''}`, { signal })
      if (!signal.aborted) { setLive(result); setError('') }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [job.id, previewEnabled])
  useEffect(() => {
    if (!previewEnabled && !active) return
    const controller = new AbortController()
    let loading = false
    const refresh = async () => {
      if (loading) return
      loading = true
      try { await refreshMonitor(controller.signal) } finally { loading = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [active, previewEnabled, refreshMonitor])
  const activity = monitorActivity(job, active, live?.activity)
  return (
    <section aria-label="Application monitor" className="flex flex-col gap-3 rounded-2xl border border-gf-line bg-gf-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Application monitor</h2>
        <button type="button" aria-pressed={previewEnabled} onClick={() => { setPreviewEnabled(value => !value); setLive(null) }}
          className="min-h-11 rounded-xl border border-gf-line2 px-4 text-sm">{previewEnabled ? 'Hide browser preview' : 'Show browser preview'}</button>
      </div>
      <div role="status" className="rounded-xl bg-gf-raised p-3 text-sm">
        <strong>{activity ? ACTIVITY_LABELS[activity.phase] : active ? 'Starting application' : 'No active application'}</strong>
        <p className="mt-1 whitespace-pre-wrap">{activity?.message || 'Approve a prepared job to open its application in the server browser.'}</p>
      </div>
      <p className="text-sm text-gf-muted">Use account automation below for supported sign-in/signup forms, or complete them directly in the application browser. GhostForge reuses that browser&apos;s saved session on later attempts; it never stores your password. Automatic registration pauses for terms, MFA, email verification, captcha or unsupported fields. Finish those steps yourself, then use Open &amp; fill again. A new tab in your regular browser has a separate session.</p>
      {job.status === 'needs_user' && live?.available && live.origin &&
        <AccountAssistance key={`${job.id}:${live.origin}`} jobId={job.id} origin={live.origin} />}
      {previewEnabled && <p className="text-xs text-gf-muted">Read-only screenshot of the server browser, refreshed every three seconds. It may contain personal application data; only enable on a trusted screen. Input fields are masked, including passwords and verification codes. Nothing is recorded to disk.</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {previewEnabled && (
        <div className="overflow-hidden rounded-xl border border-gf-line bg-gf-bar p-3">
          {live?.origin && <p className="mb-2 break-words text-xs text-gf-muted">{live.origin}</p>}
          {live?.image
            // A transient authenticated screenshot, not a public optimizable asset.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={live.image} alt="Live read-only view of the application browser" className="h-auto w-full rounded-lg" />
            : <p className="py-8 text-center text-sm text-gf-muted">{live?.available ? 'Loading browser preview…' : 'No browser preview available. The window may be closed or running in another server process.'}</p>}
        </div>
      )}
    </section>
  )
}

const ACCOUNT_ACTION_LABELS: Record<AccountMode, string> = {
  login: 'Approve sign-in', 'open-signup': 'Open signup form', 'fill-signup': 'Fill signup form', register: 'Approve automatic registration',
}
const NOTIFICATION_MESSAGES = {
  sent: '',
  unavailable: ' Phone push is not configured; this alert and the job status remain in GhostForge.',
  failed: ' Phone notification failed; check this alert and the job status.',
}

function AccountAssistance({ jobId, origin }: { jobId: string; origin: string }) {
  const [mode, setMode] = useState<AccountMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (window.location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
      setPassword('')
      setError('Open GhostForge over HTTPS or on localhost before entering website credentials.')
      return
    }
    setBusy(true); setError(''); setMessage('')
    const body = JSON.stringify({ mode, origin, consent, ...(mode === 'open-signup' ? {} : { email, password }) })
    setPassword('')
    try {
      const result = await api<{ message: string; notification?: 'sent' | 'unavailable' | 'failed' }>(`/api/jobs/${encodeURIComponent(jobId)}/account`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      })
      setMessage(`${result.message}${NOTIFICATION_MESSAGES[result.notification || 'sent']}`)
      setConsent(false)
      if (mode === 'open-signup') setMode('fill-signup')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account assistance failed. Check the application browser.')
    } finally { setBusy(false) }
  }
  return (
    <details className="rounded-xl border border-gf-line2 p-4">
      <summary className="min-h-11 cursor-pointer font-semibold">Account sign-in / signup assistance</summary>
      <form onSubmit={event => void submit(event)} className="mt-3 flex flex-col gap-3">
        <p className="break-words text-sm">Approved website: <strong>{origin}</strong></p>
        <p className="text-xs text-gf-muted">Credentials are used for this request only, never saved by GhostForge or sent to AI. Only use on a trusted HTTPS GhostForge connection or this computer&apos;s localhost. Keep signup passwords in your own password manager. Email-first, SSO and embedded forms may need manual steps.</p>
        <label className="text-sm">Account action
          <select value={mode} disabled={busy} onChange={event => { setMode(event.target.value as AccountMode); setConsent(false); setPassword('') }}
            className="mt-1 min-h-11 w-full rounded-lg border border-gf-line2 bg-gf-bar p-2">
            <option value="login">Sign in with my existing account</option>
            <option value="open-signup">Open this website&apos;s signup form</option>
            <option value="fill-signup">Fill signup details (I finish account creation)</option>
            <option value="register">Automatically create account (pause at blockers)</option>
          </select>
        </label>
        {mode !== 'open-signup' && <>
          <label className="text-sm">Website account email
            <input type="email" required maxLength={254} autoComplete="username" value={email} disabled={busy}
              onChange={event => setEmail(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-gf-line2 bg-gf-bar p-2" />
          </label>
          <label className="text-sm">Website account password
            <input type="password" required maxLength={512} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password} disabled={busy} onChange={event => setPassword(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-gf-line2 bg-gf-bar p-2" />
          </label>
        </>}
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={consent} required disabled={busy} onChange={event => setConsent(event.target.checked)} />
          I trust this exact website and approve this account action{mode === 'register' ? ', including submitting registration once when no blockers are present' : ''}. Terms, MFA and captcha require my attention.
        </label>
        <button type="submit" disabled={busy || !consent} className="min-h-11 rounded-lg bg-gf-ink px-4 text-sm font-semibold text-gf-bg disabled:opacity-60">
          {busy ? 'Working on account…' : ACCOUNT_ACTION_LABELS[mode]}
        </button>
        {message && <p role="alert" className="text-sm text-sky-200">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      </form>
    </details>
  )
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-gf-line bg-gf-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gf-line px-[18px] py-4">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        {note && <span className="text-xs text-gf-muted">{note}</span>}
      </div>
      <div className="max-h-[640px] overflow-auto p-[18px]">{children}</div>
    </section>
  )
}
