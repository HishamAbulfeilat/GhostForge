'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { profileForTitle } from '@/lib/title-profiles'
import { bridgeReadiness, modelReadiness } from './readiness.js'

interface ProfileView {
  id: string
  label: string
  description: string
  permissions: Array<{ key: string; label: string }>
  pages: Array<{ path: string; label: string; icon: string }>
}

interface SetupState {
  user: { name: string; username: string; role: 'admin' | 'user'; jobTitle: string; profileId: string | null; setupComplete: boolean }
  isAdmin: boolean
  profiles: ProfileView[]
}

const TITLE_CHIPS = ['Software Engineer', 'DevOps Engineer', 'Data Analyst', 'Product Designer', 'Recruiter', 'Sales Manager', 'Project Manager', 'Student / job seeker']

// Privileged capabilities called out when a title does NOT include them
const RESTRICTED_NOTE: Record<string, string> = {
  remote: 'Remote access', mac_control: 'System control', admin_tools: 'Admin tools', terminal: 'Terminal',
}

interface ReadinessRow {
  id: string
  label: string
  state: 'configured' | 'missing' | 'unreachable'
  detail: string
  action: string
}

const READINESS_STYLE: Record<ReadinessRow['state'], { label: string; cls: string }> = {
  configured: { label: 'Configured', cls: 'bg-emerald-500/15 text-emerald-300' },
  missing: { label: 'Missing', cls: 'bg-amber-500/15 text-amber-300' },
  unreachable: { label: 'Unreachable', cls: 'bg-red-500/15 text-red-300' },
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

function ReadinessSection() {
  const [rows, setRows] = useState<ReadinessRow[] | null>(null)
  const [checking, setChecking] = useState(false)

  const check = async () => {
    setChecking(true)
    const [bridge, models] = await Promise.all([fetchJson('/api/bridge-status'), fetchJson('/api/models')])
    setRows([
      modelReadiness(models as Parameters<typeof modelReadiness>[0]),
      bridgeReadiness(bridge as Parameters<typeof bridgeReadiness>[0]),
    ] as ReadinessRow[])
    setChecking(false)
  }

  useEffect(() => { void check() }, [])

  return (
    <div className="flex flex-col gap-2.5" data-testid="setup-readiness">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-[0.08em] text-gf-muted">Readiness</span>
        <button type="button" onClick={() => void check()} disabled={checking}
          className="min-h-9 rounded-lg border border-gf-line2 px-3 text-sm text-gf-accent-ink disabled:opacity-60">
          {checking ? 'Checking…' : 'Re-check'}
        </button>
      </div>
      {!rows && <p className="text-sm text-gf-muted">Checking…</p>}
      <ul className="flex flex-col gap-2.5">
        {rows?.map(r => (
          <li key={r.id} className="flex flex-col gap-1 rounded-xl border border-gf-line bg-gf-surface p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{r.label}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${READINESS_STYLE[r.state].cls}`}>{READINESS_STYLE[r.state].label}</span>
            </div>
            <span className="text-gf-muted">{r.detail}</span>
            {r.state !== 'configured' && <span className="text-gf-accent-ink">Next: {r.action}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SetupPage() {
  const router = useRouter()
  const [state, setState] = useState<SetupState | null>(null)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [override, setOverride] = useState<string>('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/setup').then(async res => {
      if (res.status === 401) { router.replace('/login?from=/setup'); return }
      const data = await res.json() as SetupState
      setState(data)
      setName(data.user.name || '')
      setTitle(data.user.jobTitle || '')
    }).catch(() => setError('Could not load setup'))
  }, [router])

  const detected = useMemo(() => profileForTitle(title), [title])
  const profileId = override || detected.id
  const profile = state?.profiles.find(p => p.id === profileId)
  const locked = Boolean(state?.user.setupComplete && !state?.isAdmin)
  const missingPrivileged = profile
    ? Object.entries(RESTRICTED_NOTE).filter(([k]) => !profile.permissions.some(p => p.key === k)).map(([, v]) => v)
    : []

  const submit = async () => {
    setError('')
    if (!name.trim()) { setError('Tell us your name'); return }
    if (!title.trim()) { setError('Tell us your job title'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, jobTitle: title, profileId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not save'); return }
      // Full reload so the navbar and page guard pick up the new access
      window.location.href = '/jarvis'
    } finally {
      setSaving(false)
    }
  }

  if (!state) {
    return <div className="grid min-h-[calc(100dvh-64px)] place-items-center bg-gf-bg font-plex text-gf-muted">{error || 'Loading…'}</div>
  }

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-gf-bg font-plex text-gf-ink">
      <div className="mx-auto grid max-w-6xl lg:grid-cols-2">
        <section className="flex flex-col gap-8 border-gf-line px-6 py-10 sm:px-12 lg:border-e lg:py-16">
          <ol className="flex items-center gap-2 text-sm text-gf-muted" aria-label="Setup steps">
            <li className="flex items-center gap-2 text-gf-ink">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-gf-accent font-bold text-gf-bg">1</span> About you
            </li>
            <li aria-hidden className="h-px w-8 bg-gf-line2" />
            <li className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full border border-gf-line2">2</span> Your access
            </li>
          </ol>

          <div className="flex flex-col gap-3">
            <h1 className="font-display text-4xl font-bold leading-tight tracking-tight">
              Welcome to GhostForge.<br />Who are you?
            </h1>
            <p className="max-w-md text-base leading-relaxed text-gf-muted">
              JARVIS uses this to know who it is talking to. Your job title decides which tools and pages you get.
            </p>
          </div>

          {locked && (
            <p className="rounded-xl border border-gf-line bg-gf-surface px-4 py-3 text-sm text-gf-muted">
              Your setup is already complete. The owner can reset it from the Users page if your role changes.
            </p>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="gf-name" className="text-sm font-medium">Your name</label>
            <input id="gf-name" value={name} onChange={e => setName(e.target.value)} disabled={locked} autoComplete="name"
              className="h-12 rounded-xl border border-gf-line2 bg-gf-surface px-4 text-base outline-none focus:border-gf-accent disabled:opacity-60" />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="gf-title" className="text-sm font-medium">Job title</label>
            <input id="gf-title" value={title} onChange={e => { setTitle(e.target.value); setOverride('') }} disabled={locked}
              placeholder="e.g. Frontend Developer" autoComplete="organization-title"
              className="h-12 rounded-xl border border-gf-line2 bg-gf-surface px-4 text-base outline-none focus:border-gf-accent disabled:opacity-60" />
            {!locked && (
              <div className="mt-1 flex flex-wrap gap-2">
                {TITLE_CHIPS.map(c => (
                  <button key={c} type="button" onClick={() => { setTitle(c); setOverride('') }}
                    className="min-h-9 rounded-full border border-gf-line bg-gf-surface px-3 text-sm text-slate-300 hover:border-gf-line2">
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

          <div className="mt-auto flex items-center justify-between gap-4">
            <span className="text-sm text-gf-muted">{state.isAdmin ? 'You are an admin — you keep full access.' : 'Admins always keep full access.'}</span>
            {!locked && (
              <button type="button" onClick={() => void submit()} disabled={saving}
                className="min-h-12 rounded-xl bg-gf-accent px-7 text-[15px] font-semibold text-gf-bg disabled:opacity-60">
                {saving ? 'Saving…' : 'Continue'}
              </button>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-6 bg-gf-bar px-6 py-10 sm:px-12 lg:py-16" aria-live="polite">
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.08em] text-gf-muted">{state.isAdmin ? 'Your access' : 'Detected profile'}</span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-2xl font-semibold">{state.isAdmin ? 'Administrator' : profile?.label}</span>
              {!state.isAdmin && !locked && (
                <>
                  <label htmlFor="gf-profile" className="sr-only">Choose a different profile</label>
                  <select id="gf-profile" value={profileId} onChange={e => setOverride(e.target.value)}
                    className="min-h-9 rounded-lg border border-gf-line2 bg-gf-surface px-2 text-sm text-gf-accent-ink">
                    {state.profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </>
              )}
            </div>
            <span className="text-sm text-gf-muted">{state.isAdmin ? 'Every page and every tool, including user management.' : profile?.description}</span>
          </div>

          {state.isAdmin && <ReadinessSection />}

          {!state.isAdmin && profile && (
            <>
              <div className="flex flex-col gap-2.5">
                <span className="text-xs uppercase tracking-[0.08em] text-gf-muted">Pages you will see</span>
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {profile.pages.map(p => (
                    <li key={p.path} className="flex items-center gap-2.5 rounded-xl border border-gf-line bg-gf-surface p-3 text-sm">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6EE7B7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
                      {p.label}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2.5">
                <span className="text-xs uppercase tracking-[0.08em] text-gf-muted">Tools JARVIS can use for you</span>
                <ul className="flex flex-wrap gap-2">
                  {profile.permissions.map(p => (
                    <li key={p.key} className="rounded-lg bg-gf-raised px-2.5 py-1.5 text-sm text-slate-300">{p.label}</li>
                  ))}
                </ul>
              </div>
              {missingPrivileged.length > 0 && (
                <p className="flex gap-2.5 rounded-xl border border-dashed border-gf-line2 px-4 py-3.5 text-sm text-gf-muted">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                  {missingPrivileged.join(', ')} and user management stay off for this title. The owner can change your access later.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
