export default function ClipboardPanel({ text, onAction, onClose }: { text: string; onAction: (action: 'EXPLAIN' | 'SUMMARISE' | 'TRANSLATE' | 'FIX') => void; onClose: () => void }) {
  const actions: Array<{ label: 'EXPLAIN' | 'SUMMARISE' | 'TRANSLATE' | 'FIX'; icon: string }> = [
    { label: 'EXPLAIN', icon: '📋' },
    { label: 'SUMMARISE', icon: '📝' },
    { label: 'TRANSLATE', icon: '🔄' },
    { label: 'FIX', icon: '🐛' },
  ]

  return (
    <div className="gfai-fade fixed top-20 end-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border p-3 shadow-2xl"
      style={{ borderColor: 'rgba(34,211,238,0.65)', background: 'rgba(2,12,22,0.96)', boxShadow: '0 0 28px rgba(34,211,238,0.12)' }}>
      <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[10px]">
        <span className="tracking-[0.24em] text-cyan-300/80">CLIPBOARD INTELLIGENCE</span>
        <button type="button" aria-label="Close clipboard intelligence panel" onClick={onClose} className="text-cyan-300/50 transition hover:text-cyan-200">✕</button>
      </div>
      <p className="mb-3 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-cyan-400/10 bg-black/20 px-2.5 py-2 text-xs leading-relaxed text-slate-200">
        {text}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {actions.map(action => (
          <button
            key={action.label}
            type="button"
            onClick={() => onAction(action.label)}
            className="rounded-lg border px-2 py-2 text-start font-mono text-[10px] tracking-wide text-cyan-200 transition hover:bg-cyan-400/10"
            style={{ borderColor: 'rgba(34,211,238,0.28)' }}
          >
            {action.icon} {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
