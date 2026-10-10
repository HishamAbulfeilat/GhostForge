import type { Dispatch, SetStateAction } from 'react'
import type { ToastFn } from './types'

/** Shown while Copilot CLI mode routes every message to `gh copilot`. */
export default function CopilotBanner({ setCopilotMode, toast }: { setCopilotMode: Dispatch<SetStateAction<boolean>>; toast: ToastFn }) {
  return (
    <div className="gfai-fade relative z-20 flex items-center justify-between border-b px-4 py-1.5 font-mono text-[10px]"
      style={{ borderColor: '#00ff8844', background: 'rgba(0,255,136,0.05)' }}>
      <div className="flex items-center gap-2">
        <span className="gfai-blink h-1.5 w-1.5 rounded-full bg-green-400" />
        <span style={{ color: '#00ff88' }}>COPILOT CLI MODE ACTIVE</span>
        <span className="text-blue-400/40">— messages route directly to <code className="text-green-400/70">gh copilot -p</code></span>
      </div>
      <button type="button" aria-label="Exit Copilot CLI mode" onClick={() => { setCopilotMode(false); toast('info', 'Copilot CLI mode OFF') }}
        className="text-green-400/50 hover:text-green-300 transition">✕ EXIT</button>
    </div>
  )
}
