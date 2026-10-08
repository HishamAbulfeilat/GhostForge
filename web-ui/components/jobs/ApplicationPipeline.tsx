'use client'

import { useEffect, useState } from 'react'
import type { JobRecord, PipelineStage } from '@/lib/job-hunter/store'

export const STAGE_VIEW: Record<PipelineStage, { label: string; style: string }> = {
  applied:   { label: 'Applied',   style: 'bg-gf-ok-soft text-gf-ok' },
  screening: { label: 'Screening', style: 'bg-gf-accent-soft text-gf-accent-ink' },
  interview: { label: 'Interview', style: 'bg-gf-accent-soft text-gf-accent-ink' },
  offer:     { label: 'Offer',     style: 'bg-gf-ok-soft text-gf-ok' },
  rejected:  { label: 'Rejected',  style: 'bg-[#1A1F2B] text-gf-muted' },
}
const STAGES = Object.keys(STAGE_VIEW) as PipelineStage[]

/** Today's date (YYYY-MM-DD) on this device */
export function today(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

/** Open application whose follow-up day has come */
export function followUpDue(job: JobRecord): boolean {
  const p = job.pipeline
  return job.status === 'submitted' && Boolean(p?.followUpAt && p.followUpAt <= today() && p.stage !== 'rejected' && p.stage !== 'offer')
}

/** Stage and follow-up pills for a job card in the Applied list */
export function PipelineBadges({ job }: { job: JobRecord }) {
  if (job.status !== 'submitted') return null
  const stage = job.pipeline?.stage || 'applied'
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STAGE_VIEW[stage].style}`}>{STAGE_VIEW[stage].label}</span>
      {job.pipeline?.followUpAt && stage !== 'rejected' && stage !== 'offer' && (
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${followUpDue(job) ? 'bg-gf-warn-soft text-gf-warn' : 'bg-[#1A1F2B] text-gf-muted'}`}>
          {followUpDue(job) ? 'Follow up now' : `Follow up ${job.pipeline.followUpAt}`}
        </span>
      )}
    </span>
  )
}

/**
 * Track what happened after applying: stage, follow-up day and notes. Manual
 * input only; GhostForge never reads your mailbox.
 */
export function ApplicationPipeline({ job, disabled, onSaved }: { job: JobRecord; disabled?: boolean; onSaved?: (job: JobRecord) => void }) {
  const [stage, setStage] = useState<PipelineStage>(job.pipeline?.stage || 'applied')
  const [followUpAt, setFollowUpAt] = useState(job.pipeline?.followUpAt || '')
  const [notes, setNotes] = useState(job.pipeline?.notes || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Follow server changes (another device, the 10 s refresh) unless there are unsaved edits
  const saved = job.pipeline
  const dirty = stage !== (saved?.stage || 'applied') || followUpAt !== (saved?.followUpAt || '') || notes !== (saved?.notes || '')
  useEffect(() => {
    if (saving || dirty) return
    setStage(saved?.stage || 'applied')
    setFollowUpAt(saved?.followUpAt || '')
    setNotes(saved?.notes || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.stage, saved?.followUpAt, saved?.notes])

  const save = async (patch: Record<string, unknown>, done: string) => {
    setSaving(true); setError(''); setMessage('')
    try {
      const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pipeline', id: job.id, ...patch }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      const next = data.job as JobRecord
      setStage(next.pipeline?.stage || 'applied')
      setFollowUpAt(next.pipeline?.followUpAt || '')
      setNotes(next.pipeline?.notes || '')
      setMessage(done)
      onSaved?.(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }
  const busy = saving || Boolean(disabled)

  return (
    <section aria-label="Application pipeline" className="flex flex-col gap-4 rounded-2xl border border-gf-line bg-gf-surface p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-base font-semibold">After applying</h2>
        <p className="text-sm text-gf-muted">Track replies yourself: GhostForge never reads your email. A reminder is sent on the follow-up day.</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-gf-muted">Stage</legend>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {STAGES.map(s => (
            <label key={s} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${stage === s ? 'border-gf-accent bg-gf-raised font-semibold' : 'border-gf-line2'}`}>
              <input type="radio" name={`stage-${job.id}`} value={s} checked={stage === s} onChange={() => setStage(s)} disabled={busy} className="size-4 accent-sky-300" />
              {STAGE_VIEW[s].label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor={`follow-up-${job.id}`} className="text-sm text-gf-muted">Follow up on</label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input id={`follow-up-${job.id}`} type="date" value={followUpAt} onChange={e => setFollowUpAt(e.target.value)} disabled={busy}
            className="min-h-11 w-full rounded-xl border border-gf-line2 bg-gf-bg px-3 text-sm sm:w-auto" />
          <button type="button" disabled={busy} onClick={() => void save({ followUpInDays: 7 }, 'Reminder set for 7 days from today.')}
            className="min-h-11 rounded-xl border border-gf-line2 px-4 text-sm disabled:opacity-60">Follow up in 7 days</button>
          {followUpAt && (
            <button type="button" disabled={busy} onClick={() => void save({ followUpAt: null }, 'Follow-up cleared.')}
              className="min-h-11 px-3 text-sm text-gf-muted disabled:opacity-60">Clear follow-up</button>
          )}
        </div>
        {followUpDue(job) && <p className="text-sm text-gf-warn">Follow-up due: check in with {job.company}, then update the stage.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`notes-${job.id}`} className="text-sm text-gf-muted">Notes</label>
        <textarea id={`notes-${job.id}`} value={notes} onChange={e => setNotes(e.target.value)} disabled={busy} rows={4} maxLength={4000}
          placeholder="Recruiter name, interview times, what to prepare…"
          className="w-full rounded-xl border border-gf-line2 bg-gf-bg px-3 py-2 text-sm" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button type="button" disabled={busy || !dirty} onClick={() => void save({ stage, followUpAt: followUpAt || null, notes }, 'Saved.')}
          className="min-h-11 rounded-xl bg-gf-accent px-5 text-sm font-semibold text-gf-bg disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
        {message && <p role="status" className="text-sm text-sky-200">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      </div>

      {(job.pipeline?.history?.length ?? 0) > 0 && (
        <ol aria-label="Stage history" className="flex flex-col gap-1 text-sm text-gf-muted">
          {job.pipeline!.history!.map(h => <li key={`${h.at}-${h.stage}`}>{h.at.slice(0, 10)}: {STAGE_VIEW[h.stage]?.label || h.stage}</li>)}
        </ol>
      )}
    </section>
  )
}
