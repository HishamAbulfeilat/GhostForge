import type { Dispatch, SetStateAction } from 'react'
import type { QuickAction } from '@/lib/quick-actions'
import type { Mode } from './types'

interface QuickCommandsPanelProps {
  mc: { ring: string; glow: string }
  mode: Mode
  QUICK_COMMANDS: QuickAction[]
  sendToJarvis: (text: string, quickAction?: string) => Promise<void>
  showAgent: boolean
  setShowAgent: Dispatch<SetStateAction<boolean>>
  agentStatus: string
  agentCurrentTask: string
  agentIssueCount: number
}

/** Right HUD column: quick commands and the autonomous agent status. */
export default function QuickCommandsPanel({
  mc, mode, QUICK_COMMANDS, sendToJarvis, showAgent, setShowAgent, agentStatus, agentCurrentTask, agentIssueCount,
}: QuickCommandsPanelProps) {
  return (
    <div className="hidden lg:flex w-48 shrink-0 flex-col gap-1.5 border-s p-3"
      style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.6)' }}>
      <p className="font-mono text-[10px] text-blue-400/40 tracking-widest mb-1">QUICK COMMANDS</p>
      <div className="flex-1 overflow-y-auto gfai-scroll space-y-1">
        {QUICK_COMMANDS.map(q => (
          <button type="button" key={q.id}
            onClick={() => void sendToJarvis(q.prompt, q.id)}
            disabled={mode === 'thinking' || mode === 'listening'}
            className="w-full text-start rounded px-2 py-1.5 font-mono text-[10px] border transition disabled:opacity-30 hover:border-blue-600/60"
            style={{ borderColor: `${mc.ring}22`, color: 'rgba(200,210,255,0.7)', background: `${mc.ring}08` }}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="border-t pt-2 mt-1" style={{ borderColor: `${mc.ring}22` }}>
        <p className="font-mono text-[9px] text-blue-400/30 leading-relaxed">
          Say <span style={{ color: mc.ring }}>&ldquo;Hey GhostForge&rdquo;</span> to activate wake word.
        </p>
      </div>

      {/* Agent quick actions */}
      <div className="border-t pt-2 mt-1" style={{ borderColor: `${mc.ring}22` }}>
        <p className="font-mono text-[10px] text-blue-400/40 tracking-widest mb-1.5">🤖 AGENT</p>
        <button type="button"
          onClick={() => setShowAgent(s => !s)}
          className="w-full text-start rounded px-2 py-1.5 font-mono text-[10px] border transition hover:border-blue-600/60 mb-1"
          style={{
            borderColor: showAgent ? '#3b82f666' : `${mc.ring}22`,
            color: showAgent ? '#3b82f6' : 'rgba(200,210,255,0.7)',
            background: showAgent ? 'rgba(59,130,246,0.08)' : `${mc.ring}08`,
          }}>
          📊 {showAgent ? 'CLOSE DASHBOARD' : 'OPEN DASHBOARD'}
        </button>
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="h-[3px] w-[3px] rounded-full" style={{
            background: agentStatus === 'IDLE' ? '#71717a'
              : agentStatus === 'ERROR' ? '#ef4444'
              : agentStatus === 'CODING' ? '#f97316'
              : '#22c55e',
          }} />
          <span className="text-blue-300/40">AGENT: {agentStatus}</span>
        </div>
        {agentCurrentTask && (
          <div className="text-[8px] mt-0.5 truncate" style={{ color: '#52525b' }}>
            → {agentCurrentTask}
          </div>
        )}
        {agentIssueCount > 0 && (
          <div className="text-[8px] mt-0.5" style={{ color: '#52525b' }}>
            {agentIssueCount} issues tracked
          </div>
        )}
      </div>
    </div>
  )
}
