import type { Toast } from './types'

// ── Toast notifications ───────────────────────────────────────────────────────

export default function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (!toasts.length) return null
  const colors: Record<Toast['type'], string> = {
    info:    '#1a6fff',
    warn:    '#ffaa00',
    error:   '#ff4444',
    success: '#00ff88',
  }
  return (
    <div className="fixed top-14 end-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          className="gfai-fade pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 font-mono text-[10px] max-w-xs"
          style={{ borderColor: `${colors[t.type]}66`, background: 'rgba(0,5,20,0.95)', color: colors[t.type], boxShadow: `0 0 12px ${colors[t.type]}22` }}>
          <span className="shrink-0 mt-0.5">{t.type === 'warn' ? '⚠' : t.type === 'error' ? '✗' : t.type === 'success' ? '✓' : 'ℹ'}</span>
          <span className="leading-relaxed" style={{ color: 'rgba(200,210,255,0.9)' }}>{t.msg}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => onRemove(t.id)}
            className="shrink-0 ms-1 opacity-40 hover:opacity-100 transition">✕</button>
        </div>
      ))}
    </div>
  )
}
