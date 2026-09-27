'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { AutopilotSettings, JobRecord, ModelChoice } from '@/lib/job-hunter/store'

interface JobsSummary {
  jobs: JobRecord[]
  ready: { hasCv: boolean; missing: string[] }
  model: ModelChoice | null
  autopilot: AutopilotSettings & { submittedToday: number }
}

/** Dashboard card for Job Hunter. Hidden for users without the job_hunter permission. */
export function JobHunterWidget() {
  const [data, setData] = useState<JobsSummary | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    fetch('/api/jobs').then(async res => {
      if (res.status === 401 || res.status === 403) { setHidden(true); return }
      if (res.ok) setData(await res.json())
    }).catch(() => setHidden(true))
  }, [])

  if (hidden) return null

  const jobs = data?.jobs || []
  const count = (status: string) => jobs.filter(j => j.status === status).length
  const stats = [
    { label: 'Waiting for you', value: count('ready'), tone: 'text-sky-300' },
    { label: 'Needs you', value: count('needs_user'), tone: 'text-amber-400' },
    { label: 'Applied', value: count('submitted'), tone: 'text-emerald-400' },
    { label: 'Matches', value: jobs.filter(j => j.fit !== 'Skip').length, tone: 'text-gray-200' },
  ]
  const ready = jobs.filter(j => j.status === 'ready').sort((a, b) => b.score - a.score).slice(0, 3)
  const ap = data?.autopilot

  return (
    <div className="rounded-lg border border-sky-900/40 bg-[#080d18]">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-sm">🧭</span>
        <span className="flex-1 text-xs font-bold uppercase tracking-widest text-gray-400">Job Hunter</span>
        {ap && (
          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${ap.enabled ? 'bg-emerald-950 text-emerald-400' : 'bg-gray-900 text-gray-500'}`}>
            Autopilot {ap.enabled ? `on · ${ap.submittedToday}/${ap.dailyLimit} today` : 'off'}
          </span>
        )}
        <Link href="/jobs" className="text-xs text-sky-400 hover:text-sky-300">Open →</Link>
      </div>

      {!data ? (
        <p className="px-4 pb-4 text-xs text-gray-600">Loading…</p>
      ) : !data.ready.hasCv ? (
        <p className="px-4 pb-4 text-xs text-gray-500">
          Upload your CV on the <Link href="/jobs" className="text-sky-400">Jobs</Link> page to start finding matching jobs.
        </p>
      ) : (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="grid grid-cols-4 gap-2">
            {stats.map(s => (
              <div key={s.label} className="rounded bg-[#0b1322] px-2 py-2">
                <div className={`text-lg font-bold tabular-nums ${s.tone}`}>{s.value}</div>
                <div className="text-[10px] text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
          {ready.length > 0 && (
            <ul className="flex flex-col gap-1">
              {ready.map(j => (
                <li key={j.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-gray-300">{j.title} <span className="text-gray-600">@ {j.company}</span></span>
                  <span className="shrink-0 tabular-nums text-emerald-400">{j.score}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap justify-between gap-2 text-[10px] text-gray-600">
            <span>Model: {data.model ? data.model.model : 'Settings default'}</span>
            {ap?.lastRunAt && <span>Autopilot last ran {new Date(ap.lastRunAt).toLocaleString()}</span>}
            {data.ready.missing.length > 0 && <span className="text-amber-500">Missing: {data.ready.missing.join(', ')}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
