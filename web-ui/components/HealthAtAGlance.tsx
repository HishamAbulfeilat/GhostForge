'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * "Health at a glance" — renders GET /api/health (lib/health-core.mjs).
 *
 * Shared by the dashboard and any other surface that wants the same answer
 * (the JARVIS HUD can mount it with `compact`). Hidden when the route is not
 * available to this viewer (signed out, or hosted mode where it is blocked).
 */

type HealthStatus = 'ready' | 'missing' | 'offline' | 'error'

interface HealthCheck {
  id: string
  label: string
  status: HealthStatus
  detail: string
  fix?: string
  optional: boolean
}

interface HealthReport {
  ok: boolean
  checkedAt: string
  summary: Record<HealthStatus, number>
  checks: HealthCheck[]
}

const STATUS_STYLE: Record<HealthStatus, { label: string; cls: string; dot: string }> = {
  ready: { label: 'ready', cls: 'bg-emerald-950/60 text-emerald-300', dot: 'bg-emerald-400' },
  missing: { label: 'missing', cls: 'bg-slate-800/80 text-slate-300', dot: 'bg-slate-400' },
  offline: { label: 'offline', cls: 'bg-amber-950/60 text-amber-300', dot: 'bg-amber-400' },
  error: { label: 'error', cls: 'bg-red-950/60 text-red-300', dot: 'bg-red-400' },
}

export default function HealthAtAGlance({ compact = false }: { compact?: boolean }) {
  const [report, setReport] = useState<HealthReport | null>(null)
  const [hidden, setHidden] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    try {
      const res = await fetch(fresh ? '/api/health?fresh=1' : '/api/health', { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) { setHidden(true); return }
      if (res.ok) setReport(await res.json() as HealthReport)
    } catch { /* keep the previous report */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 60_000)
    return () => clearInterval(id)
  }, [load])

  if (hidden) return null

  const notReady = report?.checks.filter(c => c.status !== 'ready') ?? []

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-1.5" data-testid="health-at-a-glance" aria-label="Health at a glance">
        {report?.checks.map(check => (
          <span key={check.id} title={`${check.label}: ${check.status}${check.fix ? ` — ${check.fix}` : ''}`}
            className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] px-2 py-0.5 text-[10px] text-gray-400">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_STYLE[check.status].dot}`} />
            {check.id}
          </span>
        ))}
      </div>
    )
  }

  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#080d18]" data-testid="health-at-a-glance">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-200">🩺 Health at a glance</span>
          {report && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${report.ok ? STATUS_STYLE.ready.cls : STATUS_STYLE.offline.cls}`}>
              {report.ok ? 'core ready' : 'needs attention'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {report && (
            <span className="hidden font-mono text-[10px] text-gray-600 sm:inline">
              {report.summary.ready}/{report.checks.length} ready
            </span>
          )}
          <button type="button" onClick={() => void load(true)} disabled={loading}
            className="rounded border border-white/[0.06] px-2 py-0.5 text-[10px] text-gray-400 transition hover:text-[#00A3E0] disabled:opacity-40"
            aria-label="Re-check health">
            <span className={loading ? 'inline-block animate-spin' : ''}>⟳</span>
          </button>
        </div>
      </div>
      {!report ? (
        <p className="px-3 py-3 text-xs text-gray-600">Checking…</p>
      ) : (
        <ul className="divide-y divide-white/[0.04]">
          {report.checks.map(check => (
            <li key={check.id} className="flex flex-col gap-0.5 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-gray-200">
                  {check.label}
                  {check.optional && <span className="ms-1.5 text-[10px] text-gray-600">optional</span>}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${STATUS_STYLE[check.status].cls}`}>
                  {STATUS_STYLE[check.status].label}
                </span>
              </div>
              <span className="text-gray-500">{check.detail}</span>
              {check.status !== 'ready' && check.fix && (
                <span className="text-[#00A3E0]">Fix: {check.fix}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {notReady.length === 0 && report && (
        <p className="border-t border-white/[0.04] px-3 py-2 text-[10px] text-gray-600">Everything is ready.</p>
      )}
    </section>
  )
}
