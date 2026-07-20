'use client'

import { useEffect, useState } from 'react'

interface Metrics {
  cpu: number
  ram: { usedGB: number; totalGB: number; pct: number }
  disk: { usedGB: number; totalGB: number; pct: number }
  battery: { pct: number; charging: boolean } | null
}

function Bar({ pct, color }: { pct: number; color: string }) {
  const bg = pct > 85 ? 'bg-red-500' : pct > 65 ? 'bg-yellow-500' : color
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full transition-all duration-700 ${bg}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

function Stat({ icon, label, value, sub, pct, color }: {
  icon: string; label: string; value: string; sub?: string; pct: number; color: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-white/50">
          <span>{icon}</span><span>{label}</span>
        </span>
        <span className="font-mono text-white/80">{value}</span>
      </div>
      <Bar pct={pct} color={color} />
      {sub && <p className="text-[10px] text-white/30">{sub}</p>}
    </div>
  )
}

export function MacMetricsWidget() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const es = new EventSource('/api/metrics')
    es.onmessage = (e) => {
      try { setMetrics(JSON.parse(e.data as string) as Metrics) } catch {}
    }
    es.onerror = () => { setError(true); es.close() }
    return () => es.close()
  }, [])

  if (error) return (
    <div className="rounded-xl border border-white/5 bg-gray-900/60 p-3 text-xs text-white/30">
      📊 Mac metrics unavailable
    </div>
  )

  if (!metrics) return (
    <div className="space-y-3 rounded-xl border border-white/5 bg-gray-900/60 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/30">Mac Metrics</p>
      {[1, 2, 3].map(i => (
        <div key={i} className="space-y-1.5">
          <div className="h-2.5 w-24 animate-pulse rounded bg-white/10" />
          <div className="h-1.5 w-full animate-pulse rounded bg-white/10" />
        </div>
      ))}
    </div>
  )

  return (
    <div className="rounded-xl border border-white/5 bg-gray-900/60 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-white/30">📊 Mac Metrics</p>
      <div className="space-y-3">
        <Stat
          icon="⚡" label="CPU"
          value={`${metrics.cpu}%`}
          pct={metrics.cpu}
          color="bg-sky-500"
        />
        <Stat
          icon="🧠" label="RAM"
          value={`${metrics.ram.pct}%`}
          sub={`${metrics.ram.usedGB}GB / ${metrics.ram.totalGB}GB`}
          pct={metrics.ram.pct}
          color="bg-violet-500"
        />
        <Stat
          icon="💾" label="Disk"
          value={`${metrics.disk.pct}%`}
          sub={`${metrics.disk.usedGB}GB / ${metrics.disk.totalGB}GB`}
          pct={metrics.disk.pct}
          color="bg-emerald-500"
        />
        {metrics.battery && (
          <Stat
            icon={metrics.battery.charging ? '⚡' : '🔋'} label="Battery"
            value={`${metrics.battery.pct}%${metrics.battery.charging ? ' ↑' : ''}`}
            pct={metrics.battery.pct}
            color="bg-yellow-500"
          />
        )}
      </div>
    </div>
  )
}
