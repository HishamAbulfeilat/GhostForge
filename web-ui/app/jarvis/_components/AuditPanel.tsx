'use client'

import { useEffect, useState } from 'react'

// ── Audit Log Panel ───────────────────────────────────────────────────────────

interface AuditEntry { ts: string; level: string; event: string; tool?: string; result?: string; risk?: number; blocked?: boolean }

export default function AuditPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/jarvis/audit?limit=30')
      .then(r => r.json())
      .then((d: { entries?: AuditEntry[] }) => { setEntries(d.entries || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const levelColor = (l: string) => ({ danger: '#ef4444', security: '#f97316', warn: '#f59e0b', info: '#22c55e', access: '#60a5fa' })[l] || '#60a5fa'

  return (
    <div className="relative z-20 border-b font-mono text-[10px]" style={{ borderColor: '#f59e0b22', background: 'rgba(0,5,20,0.98)', maxHeight: '220px' }}>
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: '#f59e0b22' }}>
        <span className="text-amber-400/80 tracking-widest">📋 AUDIT LOG — LAST 30 EVENTS</span>
        <button type="button" onClick={onClose} className="text-blue-400/50 hover:text-blue-300">✕ CLOSE</button>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: '170px' }}>
        {loading ? (
          <div className="px-4 py-3 text-blue-400/40">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-3 text-blue-400/40">No audit entries yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-blue-400/30 text-[9px]">
                <th className="px-3 py-1 text-start">TIME</th>
                <th className="px-3 py-1 text-start">LEVEL</th>
                <th className="px-3 py-1 text-start">EVENT</th>
                <th className="px-3 py-1 text-start">TOOL</th>
                <th className="px-3 py-1 text-start">RISK</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} className="border-b" style={{ borderColor: '#ffffff05' }}>
                  <td className="px-3 py-1 text-blue-400/40">{new Date(e.ts).toLocaleTimeString()}</td>
                  <td className="px-3 py-1" style={{ color: levelColor(e.level) }}>{e.level.toUpperCase()}</td>
                  <td className="px-3 py-1 text-blue-200/70">{e.event}</td>
                  <td className="px-3 py-1 text-blue-400/60">{e.tool || '—'}</td>
                  <td className="px-3 py-1">
                    {e.risk != null && (
                      <span style={{ color: e.risk > 70 ? '#ef4444' : e.risk > 40 ? '#f59e0b' : '#22c55e' }}>
                        {e.blocked ? '🚫 ' : ''}{e.risk}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
