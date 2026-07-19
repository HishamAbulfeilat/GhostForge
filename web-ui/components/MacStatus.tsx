import type { BridgeStatus } from '@/lib/ws-client'

const statusStyles: Record<BridgeStatus, string> = {
  connected: 'bg-emerald-500',
  disconnected: 'bg-rose-500',
  unknown: 'bg-gray-500',
}

const statusLabels: Record<BridgeStatus, string> = {
  connected: 'Mac online',
  disconnected: 'Mac offline',
  unknown: 'Bridge unknown',
}

export function MacStatus({ status }: { status: BridgeStatus }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900/80 px-3 py-1 text-xs text-gray-400">
      <span className={`h-2 w-2 rounded-full ${statusStyles[status]}`} />
      <span>{statusLabels[status]}</span>
    </div>
  )
}
