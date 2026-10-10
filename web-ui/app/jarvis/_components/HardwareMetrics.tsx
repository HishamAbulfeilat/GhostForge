'use client'

import { useEffect, useState } from 'react'

function metricColor(percent: number) {
  if (percent >= 80) return '#ff5c5c'
  if (percent >= 60) return '#ffb347'
  return '#00ff88'
}

export default function HardwareMetrics({ isMobile }: { isMobile: boolean }) {
  const [metrics, setMetrics] = useState({
    cpu: 0, ram: 0, ramLabel: '—', batteryPct: null as number | null, batteryCharging: false,
    diskPct: 0, diskLabel: '—',
  })

  useEffect(() => {
    if (isMobile) return
    let mounted = true

    const loadMetrics = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).electron?.hardware
        if (api) {
          const report = await api.fullReport() as {
            cpu: { usagePercent: number }
            ram: { percent: number; usedGB: number; totalGB: number }
            battery: { percent: number | null; charging: boolean }
            disks: Array<{ percent: number; usedGB: number; totalGB: number; mount: string }>
          }
          if (!mounted) return
          const primaryDisk = report.disks?.find(d => d.mount === '/' || d.mount === '/System/Volumes/Data') || report.disks?.[0]
          setMetrics({
            cpu: Math.max(0, Math.min(100, Math.round(report.cpu.usagePercent || 0))),
            ram: Math.max(0, Math.min(100, Math.round(report.ram.percent || 0))),
            ramLabel: `${report.ram.usedGB}/${report.ram.totalGB} GB`,
            batteryPct: report.battery.percent,
            batteryCharging: report.battery.charging,
            diskPct: primaryDisk?.percent ?? 0,
            diskLabel: primaryDisk ? `${primaryDisk.usedGB}/${primaryDisk.totalGB} GB` : '—',
          })
          return
        }

        const res = await fetch('/api/dashboard?scope=system', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as { system?: { cpu?: number; ram?: { pct?: number; usedGB?: number; totalGB?: number }; disk?: { pct?: number; usedGB?: number; totalGB?: number }; battery?: { pct?: number | null; charging?: boolean } } }
        if (!mounted) return
        setMetrics({
          cpu: Math.max(0, Math.min(100, Math.round(data.system?.cpu || 0))),
          ram: Math.max(0, Math.min(100, Math.round(data.system?.ram?.pct || 0))),
          ramLabel: data.system?.ram?.usedGB && data.system?.ram?.totalGB ? `${data.system.ram.usedGB}/${data.system.ram.totalGB} GB` : '—',
          batteryPct: data.system?.battery?.pct ?? null,
          batteryCharging: data.system?.battery?.charging ?? false,
          diskPct: data.system?.disk?.pct ?? 0,
          diskLabel: data.system?.disk?.usedGB && data.system?.disk?.totalGB ? `${data.system.disk.usedGB}/${data.system.disk.totalGB} GB` : '—',
        })
      } catch {
        if (mounted) setMetrics(prev => ({ ...prev }))
      }
    }

    void loadMetrics()
    const timer = setInterval(() => { void loadMetrics() }, 5000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [isMobile])

  if (isMobile) return null

  const cpuColor = metricColor(metrics.cpu)
  const ramColor = metricColor(metrics.ram)
  const diskColor = metricColor(metrics.diskPct)

  const rows = [
    { label: 'CPU', pct: metrics.cpu, color: cpuColor, sub: `${metrics.cpu}%` },
    { label: 'RAM', pct: metrics.ram, color: ramColor, sub: `${metrics.ram}% · ${metrics.ramLabel}` },
    { label: 'DISK', pct: metrics.diskPct, color: diskColor, sub: `${metrics.diskPct}% · ${metrics.diskLabel}` },
  ]
  if (metrics.batteryPct !== null) {
    rows.push({
      label: 'BAT',
      pct: metrics.batteryPct,
      color: metrics.batteryPct <= 20 ? '#ff4444' : metrics.batteryPct <= 50 ? '#ffb347' : '#00ff88',
      sub: `${metrics.batteryPct}%${metrics.batteryCharging ? ' ⚡' : ''}`,
    })
  }

  return (
    <div className="w-full max-w-[220px] rounded-xl border px-3 py-2 font-mono text-[10px]"
      style={{ borderColor: 'rgba(26,111,255,0.18)', background: 'rgba(0,7,20,0.78)' }}>
      <div className="mb-2 text-center text-[9px] tracking-[0.28em] text-blue-300/55">LIVE METRICS</div>
      {rows.map(metric => (
        <div key={metric.label} className="mb-2 last:mb-0">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-blue-300/45">{metric.label}</span>
            <span style={{ color: metric.color }}>{metric.sub}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${metric.pct}%`, background: metric.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}
