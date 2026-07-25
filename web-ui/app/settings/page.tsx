'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'

const VoiceboxPanel = dynamic(() => import('@/components/VoiceboxPanel'), { ssr: false })

interface ModelEntry {
  id: string
  name: string
  provider: string
  providerName: string
  description: string
  free: boolean
  requiresKey: string
  category: string
  context: string
}

interface ModelsData {
  models: ModelEntry[]
  activeModel: string
  activeProvider: string
  keysAvailable: Record<string, boolean>
}

const PROVIDER_COLORS: Record<string, string> = {
  google:      'border-blue-800/50 bg-blue-950/20 text-blue-300',
  openrouter:  'border-violet-800/50 bg-violet-950/20 text-violet-300',
  groq:        'border-orange-800/50 bg-orange-950/20 text-orange-300',
  nvidia:      'border-green-800/50 bg-green-950/20 text-green-300',
}

const PROVIDER_ICONS: Record<string, string> = {
  google: '🔵', openrouter: '🔀', groq: '⚡', nvidia: '🟢',
}

const CATEGORY_BADGE: Record<string, string> = {
  premium:     'bg-amber-900/60 text-amber-300',
  recommended: 'bg-emerald-900/60 text-emerald-300',
  free:        'bg-sky-900/60 text-sky-300',
}

interface VoiceSettingsData {
  apiKey: string
  voiceName: string
  model: string
  pushToTalk: boolean
  volume: number
  mode: 'gemini-live' | 'browser' | 'offline' | 'voicebox'
  voiceboxProfile?: string
  voiceboxEngine?: string
}

const VOICE_MODES = [
  { id: 'gemini-live' as const, label: 'Gemini Live', icon: '⚡', desc: 'Real-time streaming voice via Google AI', color: '#1a6fff' },
  { id: 'voicebox' as const, label: 'Voicebox', icon: '🎙', desc: 'Local neural TTS/STT — Kokoro, Chatterbox, etc.', color: '#aa44ff' },
  { id: 'browser' as const, label: 'Browser', icon: '🎤', desc: 'Web Speech API — always available', color: '#00ff88' },
  { id: 'offline' as const, label: 'Offline', icon: '🔇', desc: 'No voice — text only', color: '#666' },
] as const

const GEMINI_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'] as const
const GEMINI_MODELS = [
  { id: 'models/gemini-2.0-flash-live-001', label: 'Gemini 2.0 Flash Live' },
  { id: 'models/gemini-2.0-flash-live-002', label: 'Gemini 2.0 Flash Live v2' },
] as const

const VOICE_SETTINGS_KEY = 'gf_voice_settings'

function loadVoiceSettings(): VoiceSettingsData {
  if (typeof window === 'undefined') {
    return { apiKey: '', voiceName: 'Aoede', model: 'models/gemini-2.0-flash-live-001', pushToTalk: false, volume: 0.8, mode: 'browser' }
  }
  try {
    const raw = localStorage.getItem(VOICE_SETTINGS_KEY)
    if (raw) return { apiKey: '', voiceName: 'Aoede', model: 'models/gemini-2.0-flash-live-001', pushToTalk: false, volume: 0.8, mode: 'browser', ...JSON.parse(raw) as Partial<VoiceSettingsData> }
  } catch { /* corrupted */ }
  return { apiKey: '', voiceName: 'Aoede', model: 'models/gemini-2.0-flash-live-001', pushToTalk: false, volume: 0.8, mode: 'browser' }
}

export default function SettingsPage() {
  const router = useRouter()
  const [data, setData] = useState<ModelsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsData>(loadVoiceSettings)
  const [voiceSaved, setVoiceSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/models')
      if (res.status === 401) { router.push('/login'); return }
      setData(await res.json() as ModelsData)
    } catch { /* ignore */ }
    setLoading(false)
  }, [router])

  useEffect(() => { void load() }, [load])

  const switchModel = useCallback(async (modelId: string, provider: string) => {
    setSwitching(modelId)
    try {
      await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, provider }),
      })
      setData(prev => prev ? { ...prev, activeModel: modelId, activeProvider: provider } : prev)
      setToast(`✓ Switched to ${modelId}`)
      setTimeout(() => setToast(null), 3000)
    } catch { /* ignore */ }
    setSwitching(null)
  }, [])

  const updateVoiceSetting = useCallback(<K extends keyof VoiceSettingsData>(key: K, value: VoiceSettingsData[K]) => {
    setVoiceSettings(prev => ({ ...prev, [key]: value }))
    setVoiceSaved(false)
  }, [])

  const saveVoiceSettings = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(voiceSettings))
    }
    setVoiceSaved(true)
    setTimeout(() => setVoiceSaved(false), 2000)
  }, [voiceSettings])

  const grouped = data?.models.reduce<Record<string, ModelEntry[]>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = []
    acc[m.provider].push(m)
    return acc
  }, {}) ?? {}

  return (
    <div className="min-h-[100dvh] bg-[#030712]" style={{ backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -5%, #1a0a0050, transparent)' }}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg border border-emerald-700/50 bg-emerald-950/90 px-4 py-2 text-sm text-emerald-300 shadow-lg backdrop-blur">
          {toast}
        </div>
      )}

      {/* ── Header ── */}
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/[0.06] bg-[#030712]/90 px-4 py-2.5 backdrop-blur">
        <Link href="/dashboard" className="text-gray-500 hover:text-white transition text-lg leading-none">‹</Link>
        <span className="text-sm font-bold text-white">👻 GhostForge</span>
        <span className="text-[10px] font-mono text-gray-600 hidden sm:block">SETTINGS · AI MODELS</span>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/marketplace" className="rounded border border-sky-800/50 bg-sky-950/30 px-2 py-1 text-xs text-sky-300 hover:bg-sky-900/40 transition">
            🛒 Marketplace
          </Link>
          <Link href="/chat" className="rounded border border-violet-800/50 bg-violet-950/30 px-2 py-1 text-xs text-violet-300 hover:bg-violet-900/40 transition">
            💬 Chat
          </Link>
        </div>
      </header>

      <main className="p-4 max-w-4xl mx-auto space-y-6">
        {/* Active model banner */}
        {data && (
          <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 mb-1">Currently Active</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-lg">{PROVIDER_ICONS[data.activeProvider] ?? '🤖'}</span>
              <div>
                <p className="text-sm font-bold text-emerald-300">{data.activeModel}</p>
                <p className="text-[11px] text-gray-500">via {data.activeProvider} · changes apply to next chat message</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Voice Engine Section ── */}
        <div className="rounded-lg border border-white/[0.06] bg-[#080d18] p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Voice Engine</p>
              <p className="text-[11px] text-gray-600 mt-0.5">Choose how JARVIS speaks to you</p>
            </div>
            <span className="text-xs font-mono px-2 py-1 rounded border" style={{
              borderColor: VOICE_MODES.find(m => m.id === voiceSettings.mode)?.color + '55',
              color: VOICE_MODES.find(m => m.id === voiceSettings.mode)?.color,
              background: VOICE_MODES.find(m => m.id === voiceSettings.mode)?.color + '15',
            }}>
              {VOICE_MODES.find(m => m.id === voiceSettings.mode)?.label}
            </span>
          </div>

          {/* Mode selector cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {VOICE_MODES.map(mode => (
              <button
                key={mode.id}
                type="button"
                onClick={() => updateVoiceSetting('mode', mode.id)}
                className="relative flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition active:scale-[0.98]"
                style={{
                  borderColor: voiceSettings.mode === mode.id ? mode.color + '88' : 'rgba(255,255,255,0.06)',
                  background: voiceSettings.mode === mode.id ? mode.color + '15' : 'rgba(0,0,0,0.3)',
                  boxShadow: voiceSettings.mode === mode.id ? `0 0 12px ${mode.color}22` : 'none',
                }}
              >
                {voiceSettings.mode === mode.id && (
                  <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white font-bold"
                    style={{ background: mode.color }}>✓</span>
                )}
                <span className="text-base">{mode.icon}</span>
                <span className="text-xs font-semibold" style={{ color: voiceSettings.mode === mode.id ? mode.color : '#999' }}>
                  {mode.label}
                </span>
                <span className="text-[10px] text-gray-600 leading-snug">{mode.desc}</span>
              </button>
            ))}
          </div>

          {/* ── Gemini Live sub-settings ── */}
          {voiceSettings.mode === 'gemini-live' && (
            <div className="space-y-3 rounded-lg border border-blue-800/30 bg-blue-950/10 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400/60">Gemini Live Settings</p>
              <div>
                <label className="mb-1 block text-[11px] text-gray-500">API Key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={voiceSettings.apiKey}
                    onChange={e => updateVoiceSetting('apiKey', e.target.value)}
                    placeholder="AIza..."
                    className="flex-1 rounded border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-sm text-gray-200 outline-none focus:border-blue-500/50"
                  />
                </div>
                <p className="mt-1 text-[10px] text-gray-600">Get your key at aistudio.google.com — free tier available</p>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-gray-500">Voice</label>
                <div className="flex flex-wrap gap-1.5">
                  {GEMINI_VOICES.map(voice => (
                    <button key={voice} type="button" onClick={() => updateVoiceSetting('voiceName', voice)}
                      className="rounded border px-2.5 py-1 text-[11px] font-mono transition"
                      style={{
                        borderColor: voiceSettings.voiceName === voice ? '#1a6fff88' : 'rgba(255,255,255,0.08)',
                        color: voiceSettings.voiceName === voice ? '#60a5fa' : '#666',
                        background: voiceSettings.voiceName === voice ? 'rgba(26,111,255,0.15)' : 'transparent',
                      }}>
                      {voice}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-gray-500">Model</label>
                <div className="flex flex-wrap gap-1.5">
                  {GEMINI_MODELS.map(model => (
                    <button key={model.id} type="button" onClick={() => updateVoiceSetting('model', model.id)}
                      className="rounded border px-2.5 py-1 text-[11px] font-mono transition"
                      style={{
                        borderColor: voiceSettings.model === model.id ? '#1a6fff88' : 'rgba(255,255,255,0.08)',
                        color: voiceSettings.model === model.id ? '#60a5fa' : '#666',
                        background: voiceSettings.model === model.id ? 'rgba(26,111,255,0.15)' : 'transparent',
                      }}>
                      {model.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Voicebox sub-settings (uses VoiceboxPanel) ── */}
          {voiceSettings.mode === 'voicebox' && (
            <div className="rounded-lg border border-violet-800/30 bg-violet-950/10 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-400/60 mb-2">Voicebox Configuration</p>
              <VoiceboxPanel ringColor="#aa44ff" />
            </div>
          )}

          {/* ── Browser sub-settings ── */}
          {voiceSettings.mode === 'browser' && (
            <div className="rounded-lg border border-emerald-800/30 bg-emerald-950/10 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/60 mb-2">Browser TTS</p>
              <p className="text-[11px] text-gray-500">Uses your browser&apos;s built-in speech synthesis. Works everywhere, no API key needed.</p>
              <p className="text-[10px] text-gray-600 mt-1">Best voices: Daniel (British male), Alex (macOS). JARVIS will auto-select the deepest available voice.</p>
            </div>
          )}

          {/* ── Offline sub-settings ── */}
          {voiceSettings.mode === 'offline' && (
            <div className="rounded-lg border border-gray-700/30 bg-gray-900/10 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500/60 mb-2">Offline Mode</p>
              <p className="text-[11px] text-gray-500">Voice is disabled. JARVIS will respond with text only.</p>
            </div>
          )}

          {/* Shared settings */}
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="mb-1 block text-[11px] text-gray-500">Volume</label>
              <div className="flex items-center gap-2">
                <input type="range" min={0} max={1} step={0.05} value={voiceSettings.volume}
                  onChange={e => updateVoiceSetting('volume', parseFloat(e.target.value))}
                  className="flex-1 accent-blue-500" />
                <span className="text-[11px] font-mono text-gray-400 w-8 text-right">{Math.round(voiceSettings.volume * 100)}%</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-gray-500">Push-to-Talk</label>
              <button type="button" onClick={() => updateVoiceSetting('pushToTalk', !voiceSettings.pushToTalk)}
                className={`relative h-5 w-10 rounded-full transition-colors ${voiceSettings.pushToTalk ? 'bg-emerald-600' : 'bg-zinc-700'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${voiceSettings.pushToTalk ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            <button type="button" onClick={saveVoiceSettings}
              className="rounded border px-4 py-1.5 text-[11px] font-mono transition"
              style={{
                borderColor: voiceSaved ? '#00ff88' : 'rgba(255,255,255,0.12)',
                color: voiceSaved ? '#00ff88' : '#999',
                background: voiceSaved ? 'rgba(0,255,136,0.1)' : 'transparent',
              }}>
              {voiceSaved ? '✓ Saved' : 'Save Voice Settings'}
            </button>
          </div>
        </div>

        {/* Key status */}
        {data && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-600">API Keys Detected</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.keysAvailable).map(([provider, hasKey]) => (
                <div key={provider} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${hasKey ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300' : 'border-gray-800 bg-gray-900/30 text-gray-600'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${hasKey ? 'bg-emerald-400' : 'bg-gray-700'}`} />
                  {provider}
                  {!hasKey && <span className="text-[10px]">— add key in .env.local</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-transparent border-t-sky-400" />
          </div>
        ) : (
          Object.entries(grouped).map(([provider, models]) => (
            <div key={provider}>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-base">{PROVIDER_ICONS[provider] ?? '🤖'}</span>
                <span className="text-sm font-bold text-gray-200">{models[0]?.providerName ?? provider}</span>
                {!data?.keysAvailable[provider] && (
                  <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-[10px] text-red-400">no key</span>
                )}
                <div className="flex-1 border-t border-white/[0.04]" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {models.map(model => {
                  const isActive = data?.activeModel === model.id
                  const isSwitching = switching === model.id
                  const hasKey = data?.keysAvailable[model.provider] ?? false
                  return (
                    <button type="button"
                      key={model.id}
                      onClick={() => switchModel(model.id, model.provider)}
                      disabled={isSwitching || isActive}
                      className={`
                        relative flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition
                        disabled:cursor-default
                        ${isActive
                          ? 'border-emerald-700/60 bg-emerald-950/20 ring-1 ring-emerald-700/30'
                          : `${PROVIDER_COLORS[model.provider] ?? 'border-gray-800 bg-gray-900/30 text-gray-300'} hover:brightness-110 active:scale-[0.99]`
                        }
                      `}
                    >
                      {isActive && (
                        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[9px] text-white font-bold">✓</span>
                      )}
                      {isSwitching && (
                        <div className="absolute right-2 top-2 h-4 w-4 animate-spin rounded-full border-2 border-transparent border-t-current opacity-60" />
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold">{model.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_BADGE[model.category] ?? CATEGORY_BADGE.free}`}>
                          {model.category}
                        </span>
                        {!hasKey && <span className="text-[10px] text-red-500">⚠ no key</span>}
                      </div>
                      <p className="text-[11px] text-gray-500 leading-snug">{model.description}</p>
                      <div className="flex items-center gap-3 text-[10px] text-gray-600">
                        <span>📐 {model.context}</span>
                        <code className="text-gray-700 truncate max-w-[140px]">{model.requiresKey}</code>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}

        {/* Add key instructions */}
        <div className="rounded-lg border border-white/[0.05] bg-[#080d18] p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Add API Keys</p>
          <p className="text-xs text-gray-500">Edit <code className="text-gray-400">~/GhostForge/web-ui/.env.local</code> and add:</p>
          <div className="space-y-1 font-mono text-xs">
            {[
              { key: 'GOOGLE_GENERATIVE_AI_API_KEY', url: 'aistudio.google.com', hint: 'Free with Google AI Plus' },
              { key: 'OPENROUTER_API_KEY', url: 'openrouter.ai/keys', hint: 'Free tier available' },
              { key: 'GROQ_API_KEY', url: 'console.groq.com', hint: 'Free, ultra-fast inference' },
              { key: 'NVIDIA_API_KEY', url: 'build.nvidia.com', hint: 'Free tier, Llama 3.3 70B' },
            ].map(item => (
              <div key={item.key} className="flex flex-col gap-0.5 rounded bg-black/30 px-3 py-2">
                <code className="text-emerald-400">{item.key}=your_key_here</code>
                <span className="text-gray-600 text-[10px]">{item.hint} · {item.url}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-600">Then restart the web UI for new keys to take effect.</p>
        </div>
      </main>
    </div>
  )
}
