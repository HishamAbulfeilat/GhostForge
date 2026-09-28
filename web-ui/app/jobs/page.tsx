'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApplicantData, AutopilotSettings, JobPreferences, JobRecord, ModelChoice } from '@/lib/job-hunter/store'
import { CvImprover } from '@/components/career/CvImprover'
import { GithubProfileSetup } from '@/components/career/GithubProfileSetup'

// Layout and tokens follow the "GhostForge Job Hunter & Setup" Claude Design canvas.

interface ProfileView {
  cv: { fileName: string; uploadedAt: string; preview: string; length: number } | null
  applicant: ApplicantData
  preferences: JobPreferences
  customAnswers: Record<string, string>
}

interface SearchResult {
  found: number
  matched: number
  added: number
  prepared: number
  report: Array<{ source: string; count: number; error?: string }>
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
  const fileRef = useRef<HTMLInputElement>(null)

  // Editable preference fields (comma-separated inputs)
  const [roles, setRoles] = useState('')
  const [places, setPlaces] = useState('')
  const [remote, setRemote] = useState<JobPreferences['remote']>('any')
  const [minSalary, setMinSalary] = useState('')
  const [dealbreakers, setDealbreakers] = useState('')
  const [companies, setCompanies] = useState('')
  const [applicant, setApplicant] = useState<ApplicantData | null>(null)
  const [section, setSection] = useState<'jobs' | 'cv' | 'github'>('jobs')
  const [model, setModel] = useState<ModelChoice | null>(null)
  const [autopilot, setAutopilot] = useState<(AutopilotSettings & { submittedToday: number }) | null>(null)

  const load = useCallback(async () => {
    const [j, p] = await Promise.all([
      api<{ jobs: JobRecord[]; sources: { linkedInViaJSearch: boolean }; model: ModelChoice | null; autopilot: AutopilotSettings & { submittedToday: number } }>('/api/jobs'),
      api<{ profile: ProfileView }>('/api/jobs/profile'),
    ])
    setJobs(j.jobs)
    setJsearch(j.sources.linkedInViaJSearch)
    setModel(j.model)
    setAutopilot(j.autopilot)
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
      setApplicant(p.applicant)
    }).catch(e => setNotice({ tone: 'error', text: e.message }))
  }, [load])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setNotice(null)
    try { await fn() } catch (e) { setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy('') }
  }

  const savePreferences = () => api('/api/jobs/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preferences: {
        titles: splitList(roles), locations: splitList(places), remote,
        minSalary: minSalary ? Number(minSalary) : null,
        dealbreakers: splitList(dealbreakers), companies: splitList(companies),
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
    setNotice({ tone: 'info', text: `Found ${result.found} jobs, ${result.matched} in your locations, ${result.added} new. ${result.prepared} prepared for your approval.` })
  })

  const act = (action: 'prepare' | 'approve' | 'dismiss', id: string) => run(`${action}:${id}`, async () => {
    const r = await api<{ message?: string }>('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }),
    })
    await load()
    if (action === 'dismiss') setSelected(null)
    if (r.message) setNotice({ tone: 'info', text: r.message })
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
        <Review job={job} busy={busy} onBack={() => setSelected(null)}
          onApprove={() => void act('approve', job.id)} onPrepare={() => void act('prepare', job.id)} onDismiss={() => void act('dismiss', job.id)} />
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
                  <Field id="jh-comp" label="Company boards to watch" value={companies} onChange={setCompanies} placeholder="Greenhouse or Lever slugs, e.g. stripe" />
                </div>
              </details>
              <button type="button" onClick={() => void search()} disabled={busy === 'search' || !profile?.cv}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-gf-accent text-[15px] font-semibold text-gf-bg disabled:opacity-60">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B0D12" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                {busy === 'search' ? 'Searching and scoring…' : 'Find matching jobs'}
              </button>
              <p className="text-xs leading-relaxed text-gf-muted">
                Best matches are prepared automatically — tailored CV, cover letter and form answers — then wait for your approval. Nothing is sent without your click.
              </p>
            </section>

            <section className="flex flex-col gap-2.5 rounded-2xl border border-gf-line bg-gf-surface p-5">
              <h2 className="font-display text-sm font-semibold">Sources</h2>
              <SourceRow name="LinkedIn · Indeed (JSearch)" state={jsearch ? 'connected' : 'add JSEARCH_API_KEY'} ok={jsearch} />
              <SourceRow name="Remotive · RemoteOK" state="on" ok />
              <SourceRow name="The Muse · Arbeitnow" state="on" ok />
              <SourceRow name="Company boards" state={companies ? `${splitList(companies).length} watched` : 'none'} ok={Boolean(companies)} />
              {lastSearch?.report.filter(r => r.error).map(r => (
                <span key={r.source} className="text-xs text-red-300">{r.source}: {r.error}</span>
              ))}
              {linkedin && <a href={linkedin} target="_blank" rel="noreferrer" className="mt-1 text-sm text-sky-300 hover:text-sky-200">Open this search on LinkedIn ↗</a>}
            </section>

            {autopilot && (
              <AutomationCard model={model} autopilot={autopilot} busy={busy}
                onModel={m => void saveAutomation({ model: m }, m ? `Job Hunter now uses ${m.model}.` : 'Job Hunter follows the model selected in Settings.')}
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
                            <span className="font-mono">{j.source}</span>
                            <span className="font-mono capitalize">{j.ats}</span>
                          </span>
                          {j.reasons && <span className="text-sm text-slate-300">{j.reasons}</span>}
                        </button>
                        <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sv.style}`}>{sv.label}</span>
                          <button type="button" onClick={cta} disabled={busy.endsWith(j.id)}
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

function Review({ job, busy, onBack, onApprove, onPrepare, onDismiss }: {
  job: JobRecord; busy: string; onBack: () => void; onApprove: () => void; onPrepare: () => void; onDismiss: () => void
}) {
  const sv = STATUS_VIEW[job.status] || STATUS_VIEW.found
  const prepared = Boolean(job.tailoredResume)
  const approving = busy === `approve:${job.id}`
  const canApprove = prepared && ['ready', 'needs_user', 'failed'].includes(job.status)
  const autoSubmits = ['lever', 'greenhouse', 'ashby'].includes(job.ats)

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
            {job.url && <a href={job.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:text-sky-200">View posting ↗</a>}
          </div>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onDismiss} className="min-h-12 rounded-xl border border-gf-line2 px-5 text-[15px]">Dismiss</button>
          {prepared ? (
            <button type="button" onClick={onApprove} disabled={!canApprove || approving}
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

      <div className="flex items-start gap-3 rounded-xl border border-cyan-800 bg-gf-accent-soft px-4 py-3.5 text-sm text-sky-100">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7DD3FC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
        <span>
          {job.ats === 'linkedin'
            ? 'LinkedIn applications are finished by you. Approving opens the listing with your answers ready here.'
            : autoSubmits
              ? 'When you approve, GhostForge opens the form in your browser, fills every field below, uploads your CV and submits. If a captcha or an unanswered required question appears, it stops and leaves the form open for you.'
              : 'When you approve, GhostForge opens and pre-fills the form. This site is not on the auto-submit list, so you press Submit yourself.'}
        </span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_380px]">
        <Panel title="Tailored CV" note="Only facts from your CV — reordered for this role">
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

interface ModelOption { value: string; label: string; group: string }

/** Autopilot + AI model settings */
function AutomationCard({ model, autopilot, busy, onModel, onAutopilot, onRunNow }: {
  model: ModelChoice | null
  autopilot: AutopilotSettings & { submittedToday: number }
  busy: string
  onModel: (m: ModelChoice | null) => void
  onAutopilot: (a: Partial<AutopilotSettings>, message?: string) => void
  onRunNow: () => void
}) {
  const [options, setOptions] = useState<ModelOption[]>([])

  useEffect(() => {
    fetch('/api/models').then(r => (r.ok ? r.json() : null)).then(data => {
      if (!data) return
      const opts: ModelOption[] = []
      for (const p of data.providers || []) {
        if (!p.available) continue
        for (const m of p.models || []) opts.push({ value: `${p.id}|${m.id}`, label: `${m.label || m.id}${m.free ? ' (free)' : ''}`, group: p.name })
      }
      for (const c of data.custom || []) opts.push({ value: `custom|${c.id}`, label: c.name, group: 'Custom models' })
      for (const name of data.ollama?.models || []) opts.push({ value: `ollama|${name}`, label: name, group: 'Local (Ollama)' })
      setOptions(opts)
    }).catch(() => {})
  }, [])

  const current = model ? `${model.provider}|${model.model}` : ''
  const groups = [...new Set(options.map(o => o.group))]
  const known = !current || options.some(o => o.value === current)

  const toggle = () => {
    if (autopilot.enabled) { onAutopilot({ enabled: false }, 'Autopilot is off. Nothing will be submitted automatically.'); return }
    const ok = window.confirm(
      `Turn on autopilot?\n\nEvery ${autopilot.intervalHours} hours GhostForge will search, tailor your CV and cover letter, and SUBMIT up to ${autopilot.dailyLimit} applications a day ` +
      `for High-fit jobs scoring ${autopilot.minScore}+ on Lever, Greenhouse and Ashby, using your CV and application details. Other sites stay in your queue.`)
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
          <option value="">Default — the model selected in Settings</option>
          {!known && model && <option value={current}>{model.model} ({model.provider})</option>}
          {groups.map(g => (
            <optgroup key={g} label={g}>
              {options.filter(o => o.group === g).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="text-xs text-gf-muted">Used for fit scoring, CV tailoring and cover letters. Add keys or custom models in Settings → AI Models.</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <NumberSetting id="jh-ap-every" label="Every (hours)" value={autopilot.intervalHours} min={1} max={168}
          onCommit={v => onAutopilot({ intervalHours: v })} />
        <NumberSetting id="jh-ap-limit" label="Max per day" value={autopilot.dailyLimit} min={1} max={25}
          onCommit={v => onAutopilot({ dailyLimit: v })} />
        <NumberSetting id="jh-ap-score" label="Min score" value={autopilot.minScore} min={50} max={100}
          onCommit={v => onAutopilot({ minScore: v })} />
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
        Autopilot submits only where forms can be completed unattended (Lever, Greenhouse, Ashby) and only for High-fit jobs at or above your minimum score. LinkedIn, Workday and other sites stay prepared in your queue.
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
