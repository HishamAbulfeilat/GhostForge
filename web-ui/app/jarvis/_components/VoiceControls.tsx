import type { GeminiVoiceMode, Mode, ToastFn } from './types'

interface VoiceControlsProps {
  mc: { ring: string; glow: string }
  mode: Mode
  toast: ToastFn
  voiceSupported: boolean
  geminiConnectionState: string
  geminiVoiceMode: GeminiVoiceMode
  geminiPlayActive: boolean
  geminiTranscript: Array<{ text: string; isFinal: boolean; ts: number }>
  geminiListening: boolean
  hotwordEnabled: boolean
  wakeWordActive: boolean
  startListening: () => Promise<void>
  stopListening: () => void
  toggleWakeWord: () => Promise<void>
  stopSpeaking: () => void
}

/** Voice status line, Gemini Live transcript and the speak / wake-word buttons. */
export default function VoiceControls({
  mc, mode, toast, voiceSupported, geminiConnectionState, geminiVoiceMode, geminiPlayActive, geminiTranscript,
  geminiListening, hotwordEnabled, wakeWordActive, startListening, stopListening, toggleWakeWord, stopSpeaking,
}: VoiceControlsProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Connection status + voice mode indicator */}
      <div className="flex items-center gap-2 font-mono" style={{ fontSize: 9 }}>
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full" style={{
            background: geminiConnectionState === 'connected' ? '#00ff88'
              : geminiConnectionState === 'connecting' ? '#ffaa00'
              : geminiConnectionState === 'error' ? '#ff4444' : '#555',
          }} />
          <span style={{
            color: geminiConnectionState === 'connected' ? '#00ff88'
              : geminiConnectionState === 'connecting' ? '#ffaa00'
              : geminiConnectionState === 'error' ? '#ff4444' : '#555',
          }}>
            {geminiConnectionState === 'connected' ? 'GEMINI LIVE'
              : geminiConnectionState === 'connecting' ? 'CONNECTING'
              : geminiConnectionState === 'error' ? 'ERROR'
              : 'OFFLINE'}
          </span>
        </span>
        <span style={{ color: `${mc.ring}44` }}>|</span>
        <span style={{ color: `${mc.ring}88` }}>
          {geminiVoiceMode === 'gemini-live' ? '🔴 LIVE'
            : geminiVoiceMode === 'browser' ? '🎤 BROWSER'
            : '🔇 OFFLINE'}
        </span>
        {geminiPlayActive && (
          <span style={{ color: '#aa44ff' }}>🔊 PLAYING</span>
        )}
      </div>

      {/* Live transcript display */}
      {geminiTranscript.length > 0 && geminiVoiceMode === 'gemini-live' && (
        <div className="max-h-16 overflow-y-auto rounded border px-2 py-1 font-mono"
          style={{ fontSize: 9, borderColor: `${mc.ring}33`, background: 'rgba(0,0,0,0.3)', width: '100%', maxWidth: 400 }}>
          {geminiTranscript.slice(-5).map((t, i) => (
            <div key={i} style={{ color: t.isFinal ? mc.ring : `${mc.ring}88` }}>
              <span style={{ color: `${mc.ring}44`, marginRight: 4 }}>
                {new Date(t.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              {t.text}
              {!t.isFinal && <span className="animate-pulse"> …</span>}
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Gemini Live connect/disconnect */}
        {geminiVoiceMode === 'gemini-live' && (
          <button type="button"
            onClick={async () => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const gl = (window as any).electron?.geminiLive
              if (!gl) { toast('error', 'Gemini Live requires Electron'); return }
              if (geminiConnectionState === 'connected') {
                await gl.disconnect()
              } else {
                await gl.connect()
              }
            }}
            className="font-mono text-[10px] rounded px-3 py-1.5 border transition active:scale-95"
            style={{
              borderColor: geminiConnectionState === 'connected' ? '#00ff88' : `${mc.ring}66`,
              color: geminiConnectionState === 'connected' ? '#00ff88' : mc.ring,
              background: geminiConnectionState === 'connected' ? 'rgba(0,255,136,0.12)' : `${mc.ring}11`,
            }}>
            {geminiConnectionState === 'connected' ? '⚡ DISCONNECT' : '⚡ CONNECT'}
          </button>
        )}

        {/* Gemini Live push-to-talk / continuous mic */}
        {geminiVoiceMode === 'gemini-live' && geminiConnectionState === 'connected' && (
          <button type="button"
            onClick={async () => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const gl = (window as any).electron?.geminiLive
              if (!gl) return
              if (geminiListening) {
                await gl.stopListening()
              } else {
                await gl.startListening()
              }
            }}
            className="font-mono text-[10px] rounded px-3 py-1.5 border transition disabled:opacity-30 active:scale-95"
            style={{
              borderColor: geminiListening ? '#00ff88' : `${mc.ring}66`,
              color: geminiListening ? '#00ff88' : mc.ring,
              background: geminiListening ? 'rgba(0,255,136,0.12)' : `${mc.ring}11`,
              boxShadow: geminiListening ? '0 0 12px rgba(0,255,136,0.3)' : 'none',
              animation: geminiListening ? 'gfai-pulse 1.5s ease-in-out infinite' : 'none',
            }}>
            {geminiListening ? '■ STOP MIC' : '🎤 LIVE MIC'}
          </button>
        )}

        {/* Browser voice controls (fallback) */}
        {geminiVoiceMode !== 'gemini-live' && voiceSupported && (
          <>
            <button type="button"
              onClick={mode === 'listening' ? () => stopListening() : () => void startListening()}
              disabled={mode === 'thinking'}
              className="font-mono text-[10px] rounded px-3 py-1.5 border transition disabled:opacity-30 active:scale-95"
              style={{
                borderColor: mode === 'listening' ? '#00ff88' : `${mc.ring}66`,
                color: mode === 'listening' ? '#00ff88' : mc.ring,
                background: mode === 'listening' ? 'rgba(0,255,136,0.12)' : `${mc.ring}11`,
                boxShadow: mode === 'listening' ? '0 0 12px rgba(0,255,136,0.3)' : 'none',
                animation: mode === 'listening' ? 'gfai-pulse 1.5s ease-in-out infinite' : 'none',
              }}>
              {mode === 'listening' ? '■ STOP' : '🎤 SPEAK'}
            </button>
            <button type="button" onClick={() => void toggleWakeWord()}
              className="font-mono text-[10px] rounded px-3 py-1.5 border transition"
              style={{
                borderColor: hotwordEnabled ? '#00ff88' : `${mc.ring}44`,
                color: hotwordEnabled ? '#00ff88' : `${mc.ring}88`,
                background: hotwordEnabled ? 'rgba(0,255,136,0.08)' : 'transparent',
              }}
              title='Say "Hey GhostForge" or "Hey JARVIS" to activate'>
              {hotwordEnabled ? (wakeWordActive ? '🔊 WAKE ON' : '⏳ WAKE READY') : '😴 WAKE OFF'}
            </button>
          </>
        )}

        {/* Stop speaking */}
        {mode === 'speaking' && (
          <button type="button" onClick={stopSpeaking}
            className="font-mono text-[10px] rounded px-2 py-1.5 border border-red-700/50 text-red-400 hover:bg-red-950/30 transition">
            ■ STOP
          </button>
        )}
      </div>
    </div>
  )
}
