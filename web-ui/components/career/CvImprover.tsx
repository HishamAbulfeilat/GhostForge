'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ImprovedCv } from '@/lib/job-hunter/store'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}

const post = (action: string) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })

/** Review + rewrite the user's CV, then download or adopt the improved version */
export function CvImprover() {
  const [cv, setCv] = useState<{ fileName: string; text: string } | null>(null)
  const [improved, setImproved] = useState<ImprovedCv | null>(null)
  const [usingImproved, setUsingImproved] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const d = await api<{ cv: { fileName: string; text: string } | null; improvedCv: ImprovedCv | null; usingImproved: boolean }>('/api/jobs/cv')
    setCv(d.cv); setImproved(d.improvedCv); setUsingImproved(d.usingImproved)
  }, [])

  useEffect(() => { load().catch(e => setNotice({ tone: 'error', text: e.message })) }, [load])

  const run = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label); setNotice(null)
    try { await fn() } catch (e) { setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy('') }
  }

  const improve = run('improve', async () => {
    const d = await api<{ improvedCv: ImprovedCv }>('/api/jobs/cv', post('improve'))
    setImproved(d.improvedCv)
    setNotice({ tone: 'info', text: `Review done: ${d.improvedCv.review.score}/100. Your improved CV is ready below.` })
  })
  const adopt = run('adopt', async () => {
    await api('/api/jobs/cv', post('adopt'))
    await load()
    setNotice({ tone: 'info', text: 'Job Hunter now uses the improved CV for tailoring and uploads it (as .docx) to applications.' })
  })
  const restore = run('restore', async () => {
    await api('/api/jobs/cv', post('restore'))
    await load()
    setNotice({ tone: 'info', text: 'Back to your original CV.' })
  })

  const r = improved?.review
  const scoreTone = !r ? '' : r.score >= 80 ? 'text-gf-ok' : r.score >= 60 ? 'text-gf-warn' : 'text-red-300'

  return (
    <div className="flex flex-col gap-5 px-4 py-6 lg:px-8 lg:py-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-bold tracking-tight">Improve your CV</h1>
          <p className="max-w-2xl text-sm text-gf-muted">
            An honest review and a rewrite that reorganizes and sharpens what your CV already says. Nothing is invented, and your original is kept.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void improve()} disabled={!cv || busy === 'improve'}
            className="min-h-12 rounded-xl bg-gf-accent px-6 text-[15px] font-semibold text-gf-bg disabled:opacity-60">
            {busy === 'improve' ? 'Reviewing and rewriting…' : improved ? 'Improve again' : 'Review & improve my CV'}
          </button>
          {usingImproved && (
            <button type="button" onClick={() => void restore()} disabled={busy === 'restore'}
              className="min-h-12 rounded-xl border border-gf-line2 px-5 text-[15px] disabled:opacity-60">Use my original CV</button>
          )}
        </div>
      </div>

      {notice && (
        <div role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === 'error' ? 'border-red-900 bg-red-950/60 text-red-200' : 'border-cyan-900 bg-gf-accent-soft text-sky-100'}`}>
          {notice.text}
        </div>
      )}

      {!cv && <p className="rounded-2xl border border-gf-line bg-gf-surface p-6 text-sm text-gf-muted">Upload your CV in &ldquo;Find jobs&rdquo; first.</p>}

      {r && (
        <section className="grid gap-4 rounded-2xl border border-gf-line bg-gf-surface p-5 lg:grid-cols-[160px_minmax(0,1fr)]">
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gf-bar p-4">
            <span className={`font-display text-5xl font-bold ${scoreTone}`}>{r.score}</span>
            <span className="text-xs uppercase tracking-[0.06em] text-gf-muted">out of 100</span>
          </div>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-300">{r.summary}</p>
            <div className="grid gap-4 md:grid-cols-3">
              <ReviewList title="Strengths" items={r.strengths} tone="text-gf-ok" />
              <ReviewList title="Issues" items={r.issues} tone="text-gf-warn" />
              <ReviewList title="What the rewrite does" items={r.suggestions} tone="text-gf-accent-ink" />
            </div>
          </div>
        </section>
      )}

      {improved && (
        <div className="grid gap-5 xl:grid-cols-2">
          <CvPanel title={usingImproved ? 'Your original CV (kept)' : 'Your CV now'} text={usingImproved ? 'Kept on file. Switch back with “Use my original CV”.' : cv?.text || ''} />
          <section className="flex min-h-0 flex-col rounded-2xl border border-gf-line bg-gf-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gf-line px-[18px] py-4">
              <h2 className="font-display text-base font-semibold">Improved CV</h2>
              <div className="flex flex-wrap gap-2">
                <a href="/api/jobs/cv?download=docx" className="inline-flex min-h-9 items-center rounded-lg border border-gf-line2 px-3 text-sm">Download .docx</a>
                <a href="/api/jobs/cv?download=md" className="inline-flex min-h-9 items-center rounded-lg border border-gf-line2 px-3 text-sm">Download .md</a>
                {!usingImproved && (
                  <button type="button" onClick={() => void adopt()} disabled={busy === 'adopt'}
                    className="min-h-9 rounded-lg bg-gf-ink px-3 text-sm font-semibold text-gf-bg disabled:opacity-60">
                    {busy === 'adopt' ? 'Switching…' : 'Use for job applications'}
                  </button>
                )}
              </div>
            </div>
            <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap p-[18px] font-plex text-sm leading-relaxed text-slate-300">{improved.text}</pre>
          </section>
        </div>
      )}
    </div>
  )
}

function ReviewList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className={`text-xs font-semibold uppercase tracking-[0.06em] ${tone}`}>{title}</h3>
      <ul className="flex flex-col gap-1.5 text-sm text-slate-300">
        {items.length ? items.map((it, i) => <li key={i}>• {it}</li>) : <li className="text-gf-muted">—</li>}
      </ul>
    </div>
  )
}

function CvPanel({ title, text }: { title: string; text: string }) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-gf-line bg-gf-surface">
      <div className="border-b border-gf-line px-[18px] py-4">
        <h2 className="font-display text-base font-semibold">{title}</h2>
      </div>
      <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap p-[18px] font-plex text-sm leading-relaxed text-gf-muted">{text}</pre>
    </section>
  )
}
