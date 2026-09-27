'use client'

import { useCallback, useEffect, useState } from 'react'

interface BridgeStatusResponse {
  status: 'connected' | 'unconfigured' | 'disconnected'
  url: string
  tokenConfigured: boolean
  device: {
    hostname: string
    platformLabel: string
    arch: string
  }
}

const STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  connected: { label: 'Bridge online', dot: 'bg-emerald-400 shadow-[0_0_6px_#34d399]', text: 'text-emerald-300' },
  unconfigured: { label: 'Bridge not started', dot: 'bg-gray-500', text: 'text-gray-400' },
  disconnected: { label: 'Bridge unreachable', dot: 'bg-rose-500', text: 'text-rose-300' },
}

export function BridgeControl() {
  const [status, setStatus] = useState<BridgeStatusResponse | null>(null)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/bridge-status')
      if (res.ok) setStatus(await res.json())
    } catch { /* keep last status */ }
    setBusy(false)
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(id)
  }, [refresh])

  const control = useCallback(async (action: 'start' | 'stop') => {
    if (action === 'start') setStarting(true)
    else setStopping(true)
    setMessage(action === 'start' ? 'Starting bridge…' : 'Stopping bridge…')
    try {
      const res = await fetch('/api/bridge-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      // Poll for up to ~15s for the bridge state to settle
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 2500))
        const s = await fetch('/api/bridge-status').then(r => (r.ok ? r.json() : null)).catch(() => null)
        if (s) setStatus(s)
        if (action === 'start' && s?.status === 'connected') {
          setMessage('✅ Bridge is online')
          setStarting(false)
          return
        }
        if (action === 'stop' && s?.status !== 'connected') {
          setMessage('🛑 Bridge stopped')
          setStopping(false)
          return
        }
      }
      setMessage(typeof data.message === 'string' && data.message
        ? data.message
        : '⏳ Bridge state did not change yet — check the host machine logs.')
    } catch {
      setMessage('❌ Failed to reach the bridge control API')
    }
    setStarting(false)
    setStopping(false)
  }, [])

  const meta = STATUS_META[status?.status ?? 'unconfigured']
  const online = status?.status === 'connected'

  return (
    <div className="rounded-lg border border-white/[0.06] bg-[#080d18] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">🔌</span>
        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Bridge Control</span>
        <span className={`flex items-center gap-1.5 text-xs ${meta.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${busy ? 'animate-pulse' : ''}`} />
          {meta.label}
        </span>
        {status?.device && (
          <span className="text-[10px] text-gray-600">
            host: {status.device.platformLabel} · {status.device.hostname} · {status.device.arch}
          </span>
        )}

        <div className="ms-auto flex items-center gap-2">
          <button type="button"
            onClick={() => void refresh()}
            disabled={busy || starting || stopping}
            className="rounded border border-white/[0.06] px-2 py-1 text-[10px] text-gray-400 transition hover:text-gray-200 disabled:opacity-40"
            title="Refresh bridge status"
          >
            <span className={busy ? 'inline-block animate-spin' : ''}>⟳</span> refresh
          </button>
          {online ? (
            <button type="button"
              onClick={() => void control('stop')}
              disabled={stopping}
              className="rounded border border-rose-800/50 bg-rose-950/40 px-3 py-1 text-[10px] font-medium text-rose-300 transition hover:bg-rose-900/50 disabled:opacity-40"
              title="Stop the bridge on this machine"
            >
              {stopping ? '⏳ stopping…' : '■ Stop bridge'}
            </button>
          ) : (
            <button type="button"
              onClick={() => void control('start')}
              disabled={starting}
              className="rounded border border-emerald-800/50 bg-emerald-950/40 px-3 py-1 text-[10px] font-medium text-emerald-300 transition hover:bg-emerald-900/50 disabled:opacity-40"
              title="Start the bridge on this machine"
            >
              {starting ? '⏳ starting…' : '▶ Start bridge'}
            </button>
          )}
        </div>
        {message && <p className="w-full text-[10px] text-gray-500">{message}</p>}
      </div>
    </div>
  )
}
