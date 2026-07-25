'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface VoiceSettingsData {
  apiKey: string
  voiceName: string
  language: string
  model: string
  pushToTalk: boolean
  volume: number
  mode: 'gemini-live' | 'browser' | 'offline'
}

interface VoiceSettingsProps {
  ringColor: string
  onSave?: (settings: VoiceSettingsData) => void
  connectionState?: string
}

const VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'] as const
const MODELS = [
  { id: 'models/gemini-2.0-flash-live-001', label: 'Gemini 2.0 Flash Live' },
  { id: 'models/gemini-2.0-flash-live-002', label: 'Gemini 2.0 Flash Live v2' },
] as const
const LANGUAGES = [
  { code: 'en-US', label: 'English' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'ja-JP', label: 'Japanese' },
] as const

const STORAGE_KEY = 'gf_voice_settings'

function loadSettings(): VoiceSettingsData {
  if (typeof window === 'undefined') {
    return {
      apiKey: '', voiceName: 'Aoede', language: 'en-US',
      model: 'models/gemini-2.0-flash-live-001',
      pushToTalk: false, volume: 0.8, mode: 'browser',
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...getDefaultSettings(), ...JSON.parse(raw) as Partial<VoiceSettingsData> }
  } catch { /* corrupted */ }
  return getDefaultSettings()
}

function getDefaultSettings(): VoiceSettingsData {
  return {
    apiKey: '',
    voiceName: 'Aoede',
    language: 'en-US',
    model: 'models/gemini-2.0-flash-live-001',
    pushToTalk: false,
    volume: 0.8,
    mode: 'browser',
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VoiceSettings({ ringColor, onSave, connectionState }: VoiceSettingsProps) {
  const [settings, setSettings] = useState<VoiceSettingsData>(loadSettings)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testingKey, setTestingKey] = useState(false)

  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  const update = useCallback(<K extends keyof VoiceSettingsData>(key: K, value: VoiceSettingsData[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }, [])

  const handleSave = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    }
    setSaved(true)
    onSave?.(settings)
    setTimeout(() => setSaved(false), 2000)
  }, [settings, onSave])

  const testApiKey = useCallback(async () => {
    if (!settings.apiKey.trim()) return
    setTestingKey(true)
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${settings.apiKey}`
      )
      if (res.ok) {
        onSave?.({ ...settings, mode: 'gemini-live' })
        update('mode', 'gemini-live')
      }
    } catch { /* network error */ }
    setTestingKey(false)
  }, [settings, onSave, update])

  const connectionLabel = connectionState === 'connected'
    ? { text: 'CONNECTED', color: '#00ff88' }
    : connectionState === 'connecting'
      ? { text: 'CONNECTING…', color: '#ffaa00' }
      : connectionState === 'error'
        ? { text: 'ERROR', color: '#ff4444' }
        : { text: 'DISCONNECTED', color: '#666' }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="tracking-widest text-blue-400/40" style={{ fontSize: 10 }}>VOICE SETTINGS</p>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: connectionLabel.color }} />
          <span className="font-mono" style={{ fontSize: 9, color: connectionLabel.color }}>
            {connectionLabel.text}
          </span>
        </div>
      </div>

      {/* Mode selector */}
      <div>
        <label className="mb-1 block" style={{ fontSize: 9, color: `${ringColor}aa` }}>
          VOICE MODE
        </label>
        <div className="flex gap-1.5">
          {([
            { id: 'gemini-live' as const, label: 'GEMINI LIVE', desc: 'Real-time streaming' },
            { id: 'browser' as const, label: 'BROWSER', desc: 'Web Speech API' },
            { id: 'offline' as const, label: 'OFFLINE', desc: 'No voice' },
          ]).map(mode => (
            <button
              key={mode.id}
              type="button"
              onClick={() => update('mode', mode.id)}
              className="rounded border px-2 py-1.5 transition"
              style={{
                borderColor: settings.mode === mode.id ? ringColor : `${ringColor}33`,
                color: settings.mode === mode.id ? ringColor : `${ringColor}88`,
                background: settings.mode === mode.id ? `${ringColor}18` : 'transparent',
                fontSize: 10,
              }}
            >
              <div className="font-mono">{mode.label}</div>
              <div style={{ fontSize: 8, opacity: 0.5 }}>{mode.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* API Key */}
      {settings.mode === 'gemini-live' && (
        <div>
          <label className="mb-1 block" style={{ fontSize: 9, color: `${ringColor}aa` }}>
            GEMINI API KEY
          </label>
          <div className="flex gap-1.5">
            <input
              type={showKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={e => update('apiKey', e.target.value)}
              placeholder="AIza..."
              className="flex-1 rounded border bg-black/40 px-2 py-1 font-mono outline-none"
              style={{ borderColor: `${ringColor}44`, color: ringColor, fontSize: 10 }}
            />
            <button
              type="button"
              onClick={() => setShowKey(s => !s)}
              className="rounded border px-2 transition"
              style={{ borderColor: `${ringColor}33`, color: `${ringColor}88`, fontSize: 10 }}
            >
              {showKey ? 'HIDE' : 'SHOW'}
            </button>
            <button
              type="button"
              onClick={() => void testApiKey()}
              disabled={testingKey || !settings.apiKey.trim()}
              className="rounded border px-2 transition disabled:opacity-40"
              style={{ borderColor: `${ringColor}66`, color: ringColor, fontSize: 10 }}
            >
              {testingKey ? '…' : 'TEST'}
            </button>
          </div>
          <p style={{ fontSize: 8, color: `${ringColor}44`, marginTop: 4 }}>
            Get your key at aistudio.google.com — free tier available
          </p>
        </div>
      )}

      {/* Voice selection */}
      {settings.mode === 'gemini-live' && (
        <div>
          <label className="mb-1 block" style={{ fontSize: 9, color: `${ringColor}aa` }}>
            VOICE
          </label>
          <div className="flex gap-1.5">
            {VOICES.map(voice => (
              <button
                key={voice}
                type="button"
                onClick={() => update('voiceName', voice)}
                className="rounded border px-2 py-1 transition"
                style={{
                  borderColor: settings.voiceName === voice ? ringColor : `${ringColor}33`,
                  color: settings.voiceName === voice ? ringColor : `${ringColor}88`,
                  background: settings.voiceName === voice ? `${ringColor}18` : 'transparent',
                  fontSize: 10,
                }}
              >
                {voice}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Model */}
      {settings.mode === 'gemini-live' && (
        <div>
          <label className="mb-1 block" style={{ fontSize: 9, color: `${ringColor}aa` }}>
            MODEL
          </label>
          <div className="flex gap-1.5">
            {MODELS.map(model => (
              <button
                key={model.id}
                type="button"
                onClick={() => update('model', model.id)}
                className="rounded border px-2 py-1 transition"
                style={{
                  borderColor: settings.model === model.id ? ringColor : `${ringColor}33`,
                  color: settings.model === model.id ? ringColor : `${ringColor}88`,
                  background: settings.model === model.id ? `${ringColor}18` : 'transparent',
                  fontSize: 10,
                }}
              >
                {model.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Language */}
      <div>
        <label className="mb-1 block" style={{ fontSize: 9, color: `${ringColor}aa` }}>
          LANGUAGE
        </label>
        <div className="flex gap-1.5 flex-wrap">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              type="button"
              onClick={() => update('language', lang.code)}
              className="rounded border px-2 py-1 transition"
              style={{
                borderColor: settings.language === lang.code ? ringColor : `${ringColor}33`,
                color: settings.language === lang.code ? ringColor : `${ringColor}88`,
                background: settings.language === lang.code ? `${ringColor}18` : 'transparent',
                fontSize: 10,
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* Push-to-talk toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p style={{ fontSize: 10, color: ringColor }}>Push-to-Talk Mode</p>
          <p style={{ fontSize: 8, color: `${ringColor}66` }}>Hold button to speak instead of continuous listening</p>
        </div>
        <button
          type="button"
          onClick={() => update('pushToTalk', !settings.pushToTalk)}
          className="relative h-6 w-12 rounded-full transition-colors"
          style={{ background: settings.pushToTalk ? '#00ff88' : '#333' }}
        >
          <span
            className="absolute top-1 h-4 w-4 rounded-full bg-white transition-all"
            style={{ left: settings.pushToTalk ? 28 : 4 }}
          />
        </button>
      </div>

      {/* Volume slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label style={{ fontSize: 9, color: `${ringColor}aa` }}>VOLUME</label>
          <span style={{ fontSize: 9, color: ringColor }}>{Math.round(settings.volume * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.volume}
          onChange={e => update('volume', parseFloat(e.target.value))}
          className="w-full accent-current"
          style={{ color: ringColor }}
        />
      </div>

      {/* Save */}
      <button
        type="button"
        onClick={handleSave}
        className="w-full rounded border py-2 font-mono transition"
        style={{
          borderColor: saved ? '#00ff88' : ringColor,
          color: saved ? '#00ff88' : ringColor,
          background: saved ? 'rgba(0,255,136,0.1)' : `${ringColor}12`,
          fontSize: 10,
        }}
      >
        {saved ? '✓ SAVED' : 'SAVE SETTINGS'}
      </button>
    </div>
  )
}
