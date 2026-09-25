'use client'

import { useEffect, useState } from 'react'

export type DeviceStatusState = 'connected' | 'disconnected' | 'unknown'

interface DeviceInfo {
  hostname: string
  platformLabel: string
  arch: string
}

const stateStyles: Record<DeviceStatusState, string> = {
  connected: 'bg-emerald-500',
  disconnected: 'bg-rose-500',
  unknown: 'bg-gray-500',
}

const stateLabels: Record<DeviceStatusState, string> = {
  connected: 'Device online',
  disconnected: 'Device offline',
  unknown: 'Bridge unknown',
}

/**
 * Device-neutral status pill. Shows the host's platform (macOS / Windows /
 * Linux) and connection state instead of the old Mac-specific label.
 */
export function DeviceStatus({ status }: { status: DeviceStatusState }) {
  const [device, setDevice] = useState<DeviceInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/bridge-status')
      .then(res => (res.ok ? res.json() : null))
      .then((data: { device?: DeviceInfo } | null) => {
        if (!cancelled && data?.device) setDevice(data.device)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <div
      className="flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900/80 px-3 py-1 text-xs text-gray-400"
      title={device ? `${device.platformLabel} host · ${device.hostname} · ${device.arch}` : 'Host device status'}
    >
      <span className={`h-2 w-2 rounded-full ${stateStyles[status]}`} />
      <span>{device ? `${device.platformLabel} ${stateLabels[status]}` : stateLabels[status]}</span>
    </div>
  )
}
