'use client'

import { useState } from 'react'

/** "Since you were away" digest for the dashboard (see lib/dashboard-digest.ts). */
export interface AwayDigestData {
  since: string | null
  firstVisit: boolean
  failingRuns: Array<{ id: string; name: string; branch: string; updated: string }>
  prsAwaitingReview: Array<{ number: string; title: string; author: string }>
  newTags: Array<{ tag: string; date: string }>
  total: number
}

export default function AwayDigest({ digest, onDismissed }: { digest: AwayDigestData | null | undefined; onDismissed: () => void }) {
  const [busy, setBusy] = useState(false)
  if (!digest || digest.total === 0) return null

  const dismiss = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seen' }),
      })
      if (res.ok) onDismissed()
    } catch { /* keep showing it */ }
    setBusy(false)
  }

  const since = digest.since ? new Date(digest.since).toLocaleString() : ''
  return (
    <section className="rounded-lg border border-sky-800/40 bg-sky-950/20 px-4 py-3 text-xs text-sky-100" aria-label="Since you were away" data-testid="away-digest">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          👋 Since you were away{since && <span className="font-normal text-sky-300/70"> (since {since})</span>}
        </p>
        <button type="button" onClick={() => void dismiss()} disabled={busy}
          className="rounded border border-sky-700/50 bg-sky-900/40 px-2 py-1 text-[10px] font-medium text-sky-200 transition hover:bg-sky-800/50 disabled:opacity-40">
          {busy ? '…' : 'Got it'}
        </button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {digest.failingRuns.length > 0 && (
          <div>
            <p className="text-red-300">❌ {digest.failingRuns.length} new failing run{digest.failingRuns.length === 1 ? '' : 's'}</p>
            <ul className="mt-1 space-y-0.5 text-sky-200/80">
              {digest.failingRuns.slice(0, 5).map(run => <li key={run.id} className="truncate">{run.name} · {run.branch}</li>)}
            </ul>
          </div>
        )}
        {digest.prsAwaitingReview.length > 0 && (
          <div>
            <p className="text-amber-300">🔀 {digest.prsAwaitingReview.length} PR{digest.prsAwaitingReview.length === 1 ? '' : 's'} awaiting review</p>
            <ul className="mt-1 space-y-0.5 text-sky-200/80">
              {digest.prsAwaitingReview.slice(0, 5).map(pr => <li key={pr.number} className="truncate">{pr.number} {pr.title}</li>)}
            </ul>
          </div>
        )}
        {digest.newTags.length > 0 && (
          <div>
            <p className="text-violet-300">🚀 {digest.newTags.length} new tag{digest.newTags.length === 1 ? '' : 's'}</p>
            <ul className="mt-1 space-y-0.5 text-sky-200/80">
              {digest.newTags.slice(0, 5).map(tag => <li key={tag.tag}>{tag.tag} <span className="text-sky-300/50">{tag.date}</span></li>)}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
