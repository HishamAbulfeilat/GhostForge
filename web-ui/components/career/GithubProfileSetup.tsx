'use client'

import { useCallback, useEffect, useState } from 'react'
import type { GithubDesign, GithubProfileDraft } from '@/lib/job-hunter/store'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

interface PublishResult { repoUrl: string; profileUrl: string; createdRepo: boolean; profileUpdated: boolean; notes: string[] }

// GitHub-like dark styling for rendered previews (the HTML comes from GitHub's renderer)
const PREVIEW_CSS = `body{margin:0;padding:20px;background:#0d1117;color:#e6edf3;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
a{color:#58a6ff;text-decoration:none}img{max-width:100%}h1,h2,h3{border-bottom:1px solid #30363d;padding-bottom:.3em;margin:1em 0 .6em}
h1{font-size:1.8em}h2{font-size:1.35em}pre{background:#161b22;padding:12px;border-radius:6px;overflow:auto}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:85%}
p code,li code{background:#6e768166;padding:.1em .35em;border-radius:6px}table{border-collapse:collapse}td,th{border:1px solid #30363d;padding:6px 12px}
blockquote{margin:0;padding:0 1em;color:#9198a1;border-left:.25em solid #3d444d}ul{padding-left:1.6em}`

function Preview({ html, markdown, height = 380 }: { html?: string; markdown: string; height?: number }) {
  if (!html) {
    return <pre className="overflow-auto whitespace-pre-wrap bg-[#0d1117] p-4 font-mono text-xs text-slate-300" style={{ height }}>{markdown}</pre>
  }
  // sandbox="" — no scripts, no same-origin access; images still load
  return (
    <iframe title="README preview" sandbox="" className="w-full border-0 bg-[#0d1117]" style={{ height }}
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${PREVIEW_CSS}</style></head><body>${html}</body></html>`} />
  )
}

/** Generate several profile designs from the CV, pick one, edit, and publish it */
export function GithubProfileSetup() {
  const [github, setGithub] = useState('')
  const [notes, setNotes] = useState('')
  const [creative, setCreative] = useState(false)
  const [designs, setDesigns] = useState<GithubDesign[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [showOthers, setShowOthers] = useState(false)
  const [selected, setSelected] = useState<string>('')
  const [draft, setDraft] = useState<GithubProfileDraft | null>(null)
  const [editorTab, setEditorTab] = useState<'edit' | 'preview'>('preview')
  const [draftHtml, setDraftHtml] = useState('')
  const [canUseLocalGh, setCanUseLocalGh] = useState(false)
  const [useLocalGh, setUseLocalGh] = useState(false)
  const [token, setToken] = useState('')
  const [updateProfile, setUpdateProfile] = useState(true)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [published, setPublished] = useState<PublishResult | null>(null)

  const renderAll = useCallback(async (list: GithubDesign[]) => {
    const pairs = await Promise.all(list.map(async d => {
      try { return [d.style, (await api<{ html: string }>('/api/jobs/github', json({ action: 'preview', markdown: d.readme }))).html] as const } catch { return [d.style, ''] as const }
    }))
    setPreviews(Object.fromEntries(pairs))
  }, [])

  useEffect(() => {
    api<{ draft: GithubProfileDraft | null; designs: GithubDesign[]; canUseLocalGh: boolean }>('/api/jobs/github').then(d => {
      setDraft(d.draft)
      if (d.draft) setGithub(d.draft.username)
      setDesigns(d.designs)
      const current = d.designs.find(x => d.draft && x.readme === d.draft.readme) || d.designs.find(x => x.recommended)
      if (current) setSelected(current.style)
      if (d.designs.length) void renderAll(d.designs)
      setCanUseLocalGh(d.canUseLocalGh)
      setUseLocalGh(d.canUseLocalGh)
    }).catch(e => setNotice({ tone: 'error', text: e.message }))
  }, [renderAll])

  // Keep the editor's preview in sync (debounced)
  useEffect(() => {
    if (!draft || editorTab !== 'preview') return
    const t = setTimeout(() => {
      api<{ html: string }>('/api/jobs/github', json({ action: 'preview', markdown: draft.readme })).then(r => setDraftHtml(r.html)).catch(() => setDraftHtml(''))
    }, 500)
    return () => clearTimeout(t)
  }, [draft, editorTab])

  const run = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label); setNotice(null)
    try { await fn() } catch (e) { setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy('') }
  }

  const generate = run('designs', async () => {
    const d = await api<{ designs: GithubDesign[]; draft: GithubProfileDraft }>('/api/jobs/github', json({ action: 'designs', github, notes, creative }))
    setDesigns(d.designs); setDraft(d.draft); setPublished(null); setShowOthers(false)
    setSelected(d.designs.find(x => x.recommended)?.style || d.designs[0]?.style || '')
    setPreviews({})
    void renderAll(d.designs)
    setNotice({ tone: 'info', text: `${d.designs.length} designs ready. The recommended one is loaded into the editor.` })
  })

  const choose = (style: string) => run(`select:${style}`, async () => {
    const d = await api<{ draft: GithubProfileDraft }>('/api/jobs/github', json({ action: 'select', style }))
    setDraft(d.draft); setSelected(style); setEditorTab('preview')
  })

  const publish = run('publish', async () => {
    if (!draft) return
    const ok = window.confirm(`Publish to github.com/${draft.username}?\n\nThis creates or updates the ${draft.username}/${draft.username} repository's README${updateProfile ? ' and your GitHub bio, location and website' : ''}.`)
    if (!ok) return
    const d = await api<{ result: PublishResult }>('/api/jobs/github', json({
      action: 'publish', draft, updateProfile, ...(useLocalGh ? { useLocalGh: true } : { token }),
    }))
    setPublished(d.result); setToken('')
  })

  const field = (key: 'bio' | 'location' | 'blog' | 'company', label: string, max: number) => draft && (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`gh-${key}`} className="text-xs uppercase tracking-[0.06em] text-gf-muted">{label}</label>
      <input id={`gh-${key}`} value={draft[key]} maxLength={max} onChange={e => setDraft({ ...draft, [key]: e.target.value })}
        className="h-11 rounded-[10px] border border-gf-line bg-gf-bar px-3 text-sm outline-none focus:border-gf-accent" />
    </div>
  )

  const recommended = designs.filter(d => d.recommended)
  const others = designs.filter(d => !d.recommended)

  const DesignCard = ({ d }: { d: GithubDesign }) => (
    <article className={`flex flex-col overflow-hidden rounded-2xl border bg-gf-surface ${selected === d.style ? 'border-gf-accent' : 'border-gf-line'}`}>
      <div className="flex flex-col gap-1.5 border-b border-gf-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base font-semibold">{d.name}</h3>
          {d.recommended && <span className="rounded-full bg-gf-ok-soft px-2.5 py-0.5 text-xs font-semibold text-gf-ok">Recommended for you</span>}
          {selected === d.style && <span className="rounded-full bg-gf-accent-soft px-2.5 py-0.5 text-xs font-semibold text-gf-accent-ink">In editor</span>}
        </div>
        <p className="text-sm text-gf-muted">{d.why}</p>
      </div>
      <Preview html={previews[d.style]} markdown={d.readme} height={d.recommended ? 460 : 320} />
      <div className="border-t border-gf-line p-3">
        <button type="button" onClick={() => void choose(d.style)()} disabled={selected === d.style || busy === `select:${d.style}`}
          className="min-h-10 w-full rounded-[10px] bg-gf-ink text-sm font-semibold text-gf-bg disabled:opacity-50">
          {selected === d.style ? 'Selected' : 'Use this design'}
        </button>
      </div>
    </article>
  )

  return (
    <div className="flex flex-col gap-5 px-4 py-6 lg:px-8 lg:py-7">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-bold tracking-tight">Set up your GitHub profile</h1>
        <p className="max-w-3xl text-sm text-gf-muted">
          GitHub shows the README of your <span className="font-mono">username/username</span> repository on your profile. GhostForge writes it from your CV and real repositories in several designs, recommends the one that fits you, then creates the repo and publishes it.
        </p>
      </div>

      {notice && (
        <div role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === 'error' ? 'border-red-900 bg-red-950/60 text-red-200' : 'border-cyan-900 bg-gf-accent-soft text-sky-100'}`}>
          {notice.text}
        </div>
      )}

      <section className="grid gap-4 rounded-2xl border border-gf-line bg-gf-surface p-5 md:grid-cols-[260px_minmax(0,1fr)_auto] md:items-end">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="gh-user" className="text-xs uppercase tracking-[0.06em] text-gf-muted">GitHub username</label>
          <input id="gh-user" value={github} onChange={e => setGithub(e.target.value)} placeholder="your-username" autoComplete="off"
            className="h-11 rounded-[10px] border border-gf-line bg-gf-bar px-3 font-mono text-sm outline-none focus:border-gf-accent" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="gh-notes" className="text-xs uppercase tracking-[0.06em] text-gf-muted">Anything to include, or a look you want (optional)</label>
          <input id="gh-notes" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. open to remote roles · learning Rust · make it playful and colourful"
            className="h-11 rounded-[10px] border border-gf-line bg-gf-bar px-3 text-sm outline-none focus:border-gf-accent" />
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={creative} onChange={e => setCreative(e.target.checked)} className="h-4 w-4 accent-sky-500" />
            Surprise me with a creative design too
          </label>
          <button type="button" onClick={() => void generate()} disabled={!github.trim() || busy === 'designs'}
            className="h-11 rounded-xl bg-gf-accent px-6 text-[15px] font-semibold text-gf-bg disabled:opacity-60">
            {busy === 'designs' ? 'Designing…' : designs.length ? 'Generate new designs' : 'Generate designs'}
          </button>
        </div>
      </section>

      {designs.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="grid gap-5">{recommended.map(d => <DesignCard key={d.style} d={d} />)}</div>
          {others.length > 0 && (
            <>
              <button type="button" onClick={() => setShowOthers(v => !v)} aria-expanded={showOthers}
                className="w-fit rounded-lg border border-gf-line2 px-4 py-2 text-sm">
                {showOthers ? 'Hide other designs' : `See ${others.length} other design${others.length > 1 ? 's' : ''}`}
              </button>
              {showOthers && <div className="grid gap-5 lg:grid-cols-2">{others.map(d => <DesignCard key={d.style} d={d} />)}</div>}
            </>
          )}
        </section>
      )}

      {draft && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="flex min-h-[420px] flex-col rounded-2xl border border-gf-line bg-gf-surface">
            <div className="flex items-center justify-between border-b border-gf-line px-[18px] py-3">
              <h2 className="font-display text-base font-semibold">README.md</h2>
              <div role="tablist" aria-label="Editor view" className="flex gap-1">
                {(['preview', 'edit'] as const).map(t => (
                  <button key={t} role="tab" aria-selected={editorTab === t} type="button" onClick={() => setEditorTab(t)}
                    className={`min-h-8 rounded-lg px-3 text-sm capitalize ${editorTab === t ? 'bg-gf-raised font-semibold' : 'text-gf-muted'}`}>{t}</button>
                ))}
              </div>
            </div>
            {editorTab === 'edit' ? (
              <>
                <label htmlFor="gh-readme" className="sr-only">Profile README</label>
                <textarea id="gh-readme" value={draft.readme} onChange={e => setDraft({ ...draft, readme: e.target.value })}
                  className="min-h-[600px] flex-1 resize-y bg-transparent p-[18px] font-mono text-sm leading-relaxed text-slate-200 outline-none" />
              </>
            ) : (
              <Preview html={draftHtml} markdown={draft.readme} height={640} />
            )}
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-gf-line bg-gf-surface p-5">
            <h2 className="font-display text-base font-semibold">Publish</h2>
            {field('bio', 'Bio (160 characters)', 160)}
            <div className="grid grid-cols-2 gap-3">
              {field('location', 'Location', 100)}
              {field('company', 'Company', 100)}
            </div>
            {field('blog', 'Website', 200)}
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={updateProfile} onChange={e => setUpdateProfile(e.target.checked)} className="h-4 w-4 accent-sky-500" />
              Also update my GitHub bio, location, website and company
            </label>
            {canUseLocalGh && (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={useLocalGh} onChange={e => setUseLocalGh(e.target.checked)} className="h-4 w-4 accent-sky-500" />
                Use this computer&rsquo;s GitHub login (gh CLI)
              </label>
            )}
            {!useLocalGh && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="gh-token" className="text-xs uppercase tracking-[0.06em] text-gf-muted">GitHub token</label>
                <input id="gh-token" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off"
                  placeholder="ghp_… or github_pat_…"
                  className="h-11 rounded-[10px] border border-gf-line bg-gf-bar px-3 font-mono text-sm outline-none focus:border-gf-accent" />
                <span className="text-xs text-gf-muted">
                  Needs repository write access{updateProfile ? ' and profile write (classic: “repo” + “user”)' : ''}. Used once for this publish and never stored.{' '}
                  <a href="https://github.com/settings/tokens/new?scopes=repo,user&description=GhostForge%20profile" target="_blank" rel="noreferrer" className="text-sky-300 hover:text-sky-200">Create a token ↗</a>
                </span>
              </div>
            )}
            <button type="button" onClick={() => void publish()} disabled={busy === 'publish' || (!useLocalGh && !token.trim())}
              className="h-12 rounded-xl bg-gf-accent text-[15px] font-semibold text-gf-bg disabled:opacity-60">
              {busy === 'publish' ? 'Publishing…' : `Publish to github.com/${draft.username}`}
            </button>
            {published && (
              <div className="flex flex-col gap-1.5 rounded-xl border border-emerald-900 bg-gf-ok-soft p-3 text-sm text-emerald-100" role="status">
                <span>{published.createdRepo ? 'Created the profile repository and published your README.' : 'Updated your profile README.'}{published.profileUpdated ? ' Profile details updated.' : ''}</span>
                {published.notes.map((n, i) => <span key={i} className="text-gf-warn">{n}</span>)}
                <a href={published.profileUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:text-sky-200">View your profile ↗</a>
              </div>
            )}
            {draft.publishedAt && !published && <span className="text-xs text-gf-muted">Last published {new Date(draft.publishedAt).toLocaleString()}</span>}
          </section>
        </div>
      )}
    </div>
  )
}
