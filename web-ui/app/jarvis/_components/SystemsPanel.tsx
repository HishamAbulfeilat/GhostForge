import type { Platform } from '@/lib/platform'
import type { GeminiVoiceMode, HostCapabilities, Memory, VoiceEngine } from './types'

interface SystemsPanelProps {
  mc: { ring: string; glow: string }
  liveModel: { provider: string; model: string } | null
  hostCapabilities: HostCapabilities
  platform: Platform
  memory: Memory
  geminiVoiceMode: GeminiVoiceMode
  geminiConnectionState: string
  voiceEngine: VoiceEngine
  voiceSupported: boolean
  hotwordEnabled: boolean
  wakeWordActive: boolean
  integrations: { github: boolean; discord: boolean; googleSearch: boolean }
  bridgeStatus: string
  n8nConnected: boolean
  n8nWorkflowCount: number
  agentStatus: string
}

/** Left HUD column: subsystem status and the tool list. */
export default function SystemsPanel({
  mc, liveModel, hostCapabilities, platform, memory, geminiVoiceMode, geminiConnectionState, voiceEngine,
  voiceSupported, hotwordEnabled, wakeWordActive, integrations, bridgeStatus, n8nConnected, n8nWorkflowCount, agentStatus,
}: SystemsPanelProps) {
  return (
    <div className="hidden md:flex w-44 shrink-0 flex-col gap-3 border-e p-3 font-mono text-[10px]"
      style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.6)' }}>
      <div>
        <p className="text-blue-400/40 tracking-widest mb-2">SYSTEMS</p>
        {[
          { label: 'AI ENGINE', val: liveModel ? liveModel.model?.split('/').pop()?.split(':')[0]?.slice(0, 14) || 'ONLINE' : 'ONLINE', ok: true },
          { label: 'MAC CTRL', val: hostCapabilities.macControl ? (platform.isMac ? 'LOCAL' : 'REMOTE') : 'N/A', ok: hostCapabilities.macControl },
          { label: 'MEMORY', val: memory.conversationCount > 0 ? `${memory.conversationCount} SES` : 'INIT', ok: true },
          { label: 'VOICE', val: geminiVoiceMode === 'gemini-live' ? (geminiConnectionState === 'connected' ? 'GEMINI LIVE' : 'GEMINI OFF') : voiceEngine === 'fish-audio' ? 'JARVIS' : voiceEngine === 'elevenlabs' ? 'ELEVENLABS' : voiceSupported ? 'BROWSER' : 'N/A', ok: geminiConnectionState === 'connected' || voiceSupported || voiceEngine !== 'browser' },
          { label: 'WAKE WORD', val: hotwordEnabled || wakeWordActive ? 'ACTIVE' : 'OFF', ok: hotwordEnabled || wakeWordActive },
          { label: 'GITHUB', val: integrations.github ? 'LINKED' : 'N/A', ok: integrations.github },
          { label: 'DISCORD', val: integrations.discord ? 'LINKED' : 'N/A', ok: integrations.discord },
          { label: 'BRIDGE', val: bridgeStatus === 'running' ? 'ONLINE' : bridgeStatus === 'starting' ? 'STARTING' : bridgeStatus === 'error' ? 'ERROR' : 'OFF', ok: bridgeStatus === 'running' },
          { label: 'N8N', val: n8nConnected ? `${n8nWorkflowCount} WF` : 'OFF', ok: n8nConnected },
          { label: 'AGENT', val: agentStatus === 'IDLE' ? 'IDLE' : agentStatus === 'ERROR' ? 'ERROR' : agentStatus, ok: agentStatus !== 'ERROR' },
        ].map(s => (
          <div key={s.label} className="flex justify-between py-0.5">
            <span className="text-blue-400/40">{s.label}</span>
            <span style={{ color: s.ok ? mc.ring : '#ff444488' }}>{s.val}</span>
          </div>
        ))}
      </div>

      <div className="border-t pt-2" style={{ borderColor: `${mc.ring}22` }}>
        <p className="text-blue-400/40 tracking-widest mb-1.5">TOOLS</p>
        {['TIME', 'WEATHER', 'SEARCH', 'MESSAGES', 'MUSIC', 'REMINDER', 'APPS', 'TERMINAL', 'SCREENSHOT', 'VOLUME', 'CLIPBOARD', 'GITHUB', 'DISCORD'].map(t => (
          <div key={t} className="flex items-center gap-1.5 py-0.5">
            <span className="h-[3px] w-[3px] rounded-full" style={{ background: mc.ring }} />
            <span className="text-blue-300/40">{t}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
