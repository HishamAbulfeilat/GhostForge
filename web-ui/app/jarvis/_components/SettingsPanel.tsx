'use client'

import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import N8nSettings from './N8nSettings'
import VoiceEnrollPanel from './VoiceEnrollPanel'
import type { N8nConnection } from './useN8nConnection'
import { PERSONA_OPTIONS, type ModelInfo, type ToastFn, type TtsInfo, type VoiceEngine } from './types'

interface SettingsPanelProps {
  mc: { ring: string; glow: string }
  toast: ToastFn
  models: ModelInfo[]
  liveModel: { provider: string; model: string } | null
  offlineMode: boolean
  setOfflineMode: Dispatch<SetStateAction<boolean>>
  selectedProvider: string
  setSelectedProvider: Dispatch<SetStateAction<string>>
  selectedModel: string
  setSelectedModel: Dispatch<SetStateAction<string>>
  persona: string
  setPersona: Dispatch<SetStateAction<string>>
  hotwordEnabled: boolean
  toggleWakeWord: () => Promise<void>
  handsFreeEnabled: boolean
  setHandsFreeEnabled: Dispatch<SetStateAction<boolean>>
  handsFreeEnabledRef: MutableRefObject<boolean>
  listeningRequestedRef: MutableRefObject<boolean>
  ttsInfo: TtsInfo | null
  voiceEngine: VoiceEngine
  persistVoiceEngine: (engine: VoiceEngine) => void
  ttsFailCountRef: MutableRefObject<number>
  integrations: { github: boolean; discord: boolean; googleSearch: boolean }
  n8n: N8nConnection
}

/** Collapsible settings: model, persona, voice, integrations, n8n and voice biometrics. */
export default function SettingsPanel({
  mc, toast, models, liveModel, offlineMode, setOfflineMode, selectedProvider, setSelectedProvider,
  selectedModel, setSelectedModel, persona, setPersona, hotwordEnabled, toggleWakeWord,
  handsFreeEnabled, setHandsFreeEnabled, handsFreeEnabledRef, listeningRequestedRef,
  ttsInfo, voiceEngine, persistVoiceEngine, ttsFailCountRef, integrations, n8n,
}: SettingsPanelProps) {
  return (
    <div className="relative z-20 border-b px-4 py-3 gfai-fade"
      style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,25,0.97)' }}>
      <div className="flex flex-wrap gap-6 font-mono text-[10px]">

        {/* Model selector */}
        <div className="flex-1 min-w-[280px]">
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-blue-400/40 tracking-widest">AI MODEL</p>
            {offlineMode && (
              <span className="rounded border border-emerald-500/40 bg-emerald-950/40 px-1.5 py-0.5 text-[9px] text-emerald-300">
                OFFLINE · LOCAL ONLY
              </span>
            )}
            {selectedProvider && (
              <span className="rounded px-1.5 py-0.5 text-[9px]"
                style={{ background: `${mc.ring}22`, color: mc.ring }}>
                ✓ OVERRIDE ACTIVE — {selectedModel?.split('/').pop()?.split(':')[0]}
              </span>
            )}
            {liveModel && (
              <span className="rounded px-1.5 py-0.5 text-[9px] text-blue-400/40">
                last used: {liveModel.model?.split('/').pop()?.split(':')[0]}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button"
              onClick={() => { setSelectedProvider(''); setSelectedModel(''); toast('info', 'Auto mode — will use best available model') }}
              className="rounded px-2 py-1 border transition"
              style={{
                borderColor: !selectedProvider ? mc.ring : `${mc.ring}33`,
                color: !selectedProvider ? mc.ring : 'rgba(150,170,220,0.5)',
                background: !selectedProvider ? `${mc.ring}18` : 'transparent',
              }}>
              AUTO (CHAIN)
            </button>
            {models.filter(m => m.available && (!offlineMode || m.provider === 'ollama' || m.provider === 'llamacpp')).map(m => {
              const isActive = selectedProvider === m.provider && selectedModel === m.id
              const isLast = liveModel?.provider === m.provider && liveModel?.model === m.id
              return (
                <button type="button" key={`${m.provider}/${m.id}`}
                  onClick={() => {
                    setSelectedProvider(m.provider)
                    setSelectedModel(m.id)
                    toast('success', `Model set to ${m.label} — will use next message`)
                  }}
                  className="rounded px-2 py-1 border transition relative"
                  style={{
                    borderColor: isActive ? mc.ring : isLast ? `${mc.ring}66` : `${mc.ring}22`,
                    color: isActive ? mc.ring : isLast ? `${mc.ring}cc` : 'rgba(150,170,220,0.5)',
                    background: isActive ? `${mc.ring}18` : 'transparent',
                  }}
                  title={m.free ? 'Free tier' : 'Paid tier'}>
                  {isActive && <span className="me-1">✓</span>}
                  {isLast && !isActive && <span className="me-1" style={{ color: mc.ring }}>◉</span>}
                  {m.label}
                  {m.free && <span className="ms-1 opacity-40">free</span>}
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-950/10 px-3 py-2">
            <div>
              <p className="text-[11px] text-emerald-300">Offline mode</p>
              <p className="text-[9px] text-emerald-200/50">Ollama first, llama.cpp fallback; cloud providers are blocked</p>
            </div>
            <button
              type="button"
              aria-label="Toggle offline mode"
              onClick={() => {
                const next = !offlineMode
                setOfflineMode(next)
                localStorage.setItem('gf_offline', String(next))
                if (next && selectedProvider && selectedProvider !== 'ollama' && selectedProvider !== 'llamacpp') {
                  setSelectedProvider('')
                  setSelectedModel('')
                }
                toast(next ? 'success' : 'info', next ? 'Offline mode enabled — local models only' : 'Cloud fallback enabled')
              }}
              className={`relative h-6 w-12 rounded-full transition-colors ${offlineMode ? 'bg-emerald-600' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${offlineMode ? 'start-7' : 'start-1'}`} />
            </button>
          </div>
        </div>

        <div className="min-w-[280px]">
          <p className="mb-1.5 text-blue-400/40 tracking-widest">PERSONA</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {PERSONA_OPTIONS.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setPersona(option.id)
                  localStorage.setItem('gf_persona', option.id)
                }}
                className={`rounded-lg border p-2 text-start transition-colors ${persona === option.id ? 'border-blue-500 bg-blue-900/40 text-blue-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'}`}
              >
                <div className="text-sm font-medium">{option.label}</div>
                <div className="text-xs text-zinc-500">{option.desc}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-300">🎙️ Hotword Detection</p>
              <p className="text-xs text-zinc-500">&ldquo;Hey GhostForge&rdquo; / &ldquo;Hey JARVIS&rdquo;</p>
            </div>
            <button
              type="button"
              aria-label="Toggle hotword detection"
              onClick={() => void toggleWakeWord()}
              className={`relative h-6 w-12 rounded-full transition-colors ${hotwordEnabled ? 'bg-blue-600' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${hotwordEnabled ? 'start-7' : 'start-1'}`} />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-300">🎧 Hands-free Conversation</p>
              <p className="text-xs text-zinc-500">Resume listening after each JARVIS response</p>
            </div>
            <button
              type="button"
              aria-label="Toggle hands-free conversation"
              onClick={() => {
                const next = !handsFreeEnabled
                setHandsFreeEnabled(next)
                handsFreeEnabledRef.current = next
                localStorage.setItem('gf_handsfree', String(next))
                if (!next) listeningRequestedRef.current = false
              }}
              className={`relative h-6 w-12 rounded-full transition-colors ${handsFreeEnabled ? 'bg-emerald-600' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${handsFreeEnabled ? 'start-7' : 'start-1'}`} />
            </button>
          </div>
        </div>

        {/* Voice selector */}
        <div>
          <p className="text-blue-400/40 tracking-widest mb-1.5">VOICE ENGINE</p>
          <div className="flex flex-wrap gap-1.5">
            {/* Fish Audio — JARVIS movie voice */}
            <button type="button"
              disabled={!ttsInfo?.fishAudio}
              onClick={() => { persistVoiceEngine('fish-audio'); ttsFailCountRef.current = 0; toast('success', '🎙 Fish Audio JARVIS voice active (movie-accurate)') }}
              className="rounded px-2 py-1 border transition disabled:opacity-30"
              style={{
                borderColor: voiceEngine === 'fish-audio' ? '#00ff88' : `${mc.ring}33`,
                color: voiceEngine === 'fish-audio' ? '#00ff88' : 'rgba(150,170,220,0.5)',
                background: voiceEngine === 'fish-audio' ? 'rgba(0,255,136,0.1)' : 'transparent',
              }}
              title={!ttsInfo?.fishAudio ? 'Add FISH_AUDIO_API_KEY to .env.local — free tier available' : 'Fish Audio JARVIS voice from Iron Man movies'}>
              {voiceEngine === 'fish-audio' && '✓ '}🎙 JARVIS VOICE {!ttsInfo?.fishAudio ? '(NO KEY)' : 'free'}
            </button>

            {/* ElevenLabs */}
            <button type="button"
              disabled={!ttsInfo?.elevenLabs}
              onClick={() => { persistVoiceEngine('elevenlabs'); ttsFailCountRef.current = 0; toast('success', 'ElevenLabs active — Adam voice') }}
              className="rounded px-2 py-1 border transition disabled:opacity-30"
              style={{
                borderColor: voiceEngine === 'elevenlabs' ? '#ff9922' : `${mc.ring}33`,
                color: voiceEngine === 'elevenlabs' ? '#ff9922' : 'rgba(150,170,220,0.5)',
                background: voiceEngine === 'elevenlabs' ? 'rgba(255,153,34,0.1)' : 'transparent',
              }}>
              {voiceEngine === 'elevenlabs' && '✓ '}⚡ ELEVENLABS {!ttsInfo?.elevenLabs && '(NO KEY)'}
            </button>

            {/* Browser fallback */}
            <button type="button"
              onClick={() => { persistVoiceEngine('browser'); ttsFailCountRef.current = 0; toast('info', 'Browser TTS active (Daniel/Alex voice)') }}
              className="rounded px-2 py-1 border transition"
              style={{
                borderColor: voiceEngine === 'browser' ? mc.ring : `${mc.ring}33`,
                color: voiceEngine === 'browser' ? mc.ring : 'rgba(150,170,220,0.5)',
                background: voiceEngine === 'browser' ? `${mc.ring}18` : 'transparent',
              }}>
              {voiceEngine === 'browser' && '✓ '}BROWSER TTS
            </button>
          </div>
          <p className="mt-1.5 text-[9px] text-blue-400/25 leading-relaxed">
            {!ttsInfo?.fishAudio && !ttsInfo?.elevenLabs
              ? '⚠ Get free JARVIS voice: fish.audio/app/api-keys → add FISH_AUDIO_API_KEY to .env.local'
              : ttsInfo?.fishAudio
                ? '🎙 Fish Audio model ID: 36b6f66cfecf466caac7fcba1f8b59c8 (JARVIS)'
                : ''}
          </p>
        </div>

        {/* Integrations status */}
        <div>
          <p className="text-blue-400/40 tracking-widest mb-1.5">INTEGRATIONS</p>
          <div className="flex flex-col gap-1">
            {[
              { label: 'GitHub', ok: integrations.github, hint: 'Set GITHUB_TOKEN' },
              { label: 'Discord', ok: integrations.discord, hint: 'Set DISCORD_WEBHOOK_URL' },
              { label: 'Google Search', ok: integrations.googleSearch, hint: 'Set GOOGLE_SEARCH_API_KEY + CX' },
              { label: 'Fish Audio (JARVIS)', ok: !!ttsInfo?.fishAudio, hint: 'Set FISH_AUDIO_API_KEY (free)' },
              { label: 'ElevenLabs TTS', ok: !!ttsInfo?.elevenLabs, hint: 'Set ELEVENLABS_API_KEY' },
            ].map(i => (
              <div key={i.label} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: i.ok ? '#00ff88' : '#ff444466' }} />
                <span style={{ color: i.ok ? '#00ff88' : 'rgba(255,100,100,0.5)' }}>{i.label}</span>
                {!i.ok && <span className="text-blue-400/25">{i.hint}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* n8n Workflows */}
        <N8nSettings mc={mc} toast={toast} n8n={n8n} />

        {/* Voice Biometrics Enrollment */}
        <VoiceEnrollPanel mc={mc} />
      </div>
    </div>
  )
}
