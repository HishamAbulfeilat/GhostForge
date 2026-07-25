'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface VoiceboxStatus {
  connected: boolean
  version: string | null
}

interface VoiceProfile {
  id: string
  name: string
  description?: string
  language?: string
}

interface Engine {
  id: string
  name: string
  description?: string
}

interface VoiceboxPanelProps {
  ringColor?: string
  onVoiceSelected?: (profileId: string) => void
}

const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'sv', label: 'Swedish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'fi', label: 'Finnish' },
  { code: 'el', label: 'Greek' },
  { code: 'he', label: 'Hebrew' },
  { code: 'th', label: 'Thai' },
]

const WHISPER_MODELS = [
  { id: 'base', label: 'Base', desc: 'Fast, lower accuracy' },
  { id: 'small', label: 'Small', desc: 'Balanced' },
  { id: 'medium', label: 'Medium', desc: 'High accuracy' },
  { id: 'large', label: 'Large', desc: 'Best accuracy' },
  { id: 'turbo', label: 'Turbo', desc: 'Fast + accurate' },
] as const

// ── Component ─────────────────────────────────────────────────────────────────

export default function VoiceboxPanel({ ringColor = '#1a6fff', onVoiceSelected }: VoiceboxPanelProps) {
  const [status, setStatus] = useState<VoiceboxStatus>({ connected: false, version: null })
  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [engines, setEngines] = useState<Engine[]>([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [selectedEngine, setSelectedEngine] = useState('kokoro')
  const [selectedLanguage, setSelectedLanguage] = useState('en')
  const [whisperModel, setWhisperModel] = useState<string>('medium')
  const [testText, setTestText] = useState('Hello, I am JARVIS. How can I help you today?')
  const [testing, setTesting] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [cloneName, setCloneName] = useState('')
  const [cloneError, setCloneError] = useState('')
  const [effects, setEffects] = useState({
    pitchShift: 0,
    reverb: 0,
    delay: 0,
    chorus: 0,
  })
  const [jarvisVoice, setJarvisVoice] = useState('')
  const [connecting, setConnecting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('gf_voicebox_config')
    if (saved) {
      try {
        const data = JSON.parse(saved) as { jarvisVoice?: string; selectedEngine?: string; selectedLanguage?: string }
        if (data.jarvisVoice) setJarvisVoice(data.jarvisVoice)
        if (data.selectedEngine) setSelectedEngine(data.selectedEngine)
        if (data.selectedLanguage) setSelectedLanguage(data.selectedLanguage)
      } catch { /* corrupted */ }
    }
    void refreshStatus()
  }, [])

  const refreshStatus = useCallback(async () => {
    setConnecting(true)
    try {
      const win = window as unknown as { electron?: { voicebox?: { checkConnection: () => Promise<VoiceboxStatus>; profiles: () => Promise<VoiceProfile[]>; engines: () => Promise<Engine[]> } } }
      if (win.electron?.voicebox) {
        const result = await win.electron.voicebox.checkConnection()
        setStatus(result)
        if (result.connected) {
          const [profilesResult, enginesResult] = await Promise.all([
            win.electron.voicebox.profiles(),
            win.electron.voicebox.engines(),
          ])
          setProfiles(profilesResult)
          setEngines(enginesResult)
        }
      } else {
        const res = await fetch('http://127.0.0.1:17493/profiles', { signal: AbortSignal.timeout(5000) })
        if (res.ok) {
          setStatus({ connected: true, version: null })
          const data = await res.json() as { profiles?: VoiceProfile[] }
          setProfiles(data.profiles || [])

          const engRes = await fetch('http://127.0.0.1:17493/engines', { signal: AbortSignal.timeout(5000) })
          if (engRes.ok) {
            const engData = await engRes.json() as { engines?: Engine[] }
            setEngines(engData.engines || [])
          }
        } else {
          setStatus({ connected: false, version: null })
        }
      }
    } catch {
      setStatus({ connected: false, version: null })
    }
    setConnecting(false)
  }, [])

  const testVoice = useCallback(async () => {
    if (!testText.trim()) return
    setTesting(true)
    try {
      const win = window as unknown as { electron?: { voicebox?: { generateSpeech: (text: string, opts: Record<string, unknown>) => Promise<{ audio: ArrayBuffer; duration: number }> } } }
      if (win.electron?.voicebox) {
        const result = await win.electron.voicebox.generateSpeech(testText, {
          engine: selectedEngine,
          language: selectedLanguage,
          profileId: selectedProfile || undefined,
          effects,
        })
        const blob = new Blob([result.audio], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.onended = () => URL.revokeObjectURL(url)
        await audio.play()
      } else {
        const res = await fetch('http://127.0.0.1:17493/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: testText, engine: selectedEngine, language: selectedLanguage, profile_id: selectedProfile || undefined, effects }),
          signal: AbortSignal.timeout(60000),
        })
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audio.onended = () => URL.revokeObjectURL(url)
          await audio.play()
        }
      }
    } catch { /* playback failed */ }
    setTesting(false)
  }, [testText, selectedEngine, selectedLanguage, selectedProfile, effects])

  const handleCloneVoice = useCallback(async () => {
    if (!cloneName.trim() || !fileInputRef.current?.files?.length) return
    setCloning(true)
    setCloneError('')
    try {
      const file = fileInputRef.current.files[0]
      const arrayBuffer = await file.arrayBuffer()
      const win = window as unknown as { electron?: { voicebox?: { cloneVoice: (opts: { name: string; referenceAudio: ArrayBuffer }) => Promise<VoiceProfile> } } }
      if (win.electron?.voicebox) {
        const profile = await win.electron.voicebox.cloneVoice({
          name: cloneName.trim(),
          referenceAudio: arrayBuffer,
        })
        setProfiles(prev => [...prev, profile])
        setCloneName('')
      } else {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            const result = typeof reader.result === 'string' ? reader.result.split(',')[1] || '' : ''
            resolve(result)
          }
          reader.onerror = () => reject(new Error('Failed to read file'))
          reader.readAsDataURL(file)
        })
        const res = await fetch('http://127.0.0.1:17493/profiles/clone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: cloneName.trim(), reference_audio: base64 }),
          signal: AbortSignal.timeout(60000),
        })
        if (!res.ok) throw new Error('Clone failed')
        const profile = await res.json() as VoiceProfile
        setProfiles(prev => [...prev, profile])
        setCloneName('')
      }
    } catch (e) {
      setCloneError((e as Error).message || 'Clone failed')
    }
    setCloning(false)
  }, [cloneName])

  const setJarvisDefault = useCallback(() => {
    const profileId = selectedProfile || 'default'
    setJarvisVoice(profileId)
    localStorage.setItem('gf_voicebox_config', JSON.stringify({
      jarvisVoice: profileId,
      selectedEngine,
      selectedLanguage,
    }))
    onVoiceSelected?.(profileId)
  }, [selectedProfile, selectedEngine, selectedLanguage, onVoiceSelected])

  const updateEffect = useCallback((key: keyof typeof effects, value: number) => {
    setEffects(prev => ({ ...prev, [key]: value }))
  }, [])

  const statusColor = status.connected ? '#00ff88' : connecting ? '#ffaa00' : '#ff4444'
  const statusText = status.connected ? 'CONNECTED' : connecting ? 'CHECKING...' : 'DISCONNECTED'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="tracking-widest text-blue-400/40" style={{ fontSize: 10 }}>VOICEBOX</p>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
          <span className="font-mono" style={{ fontSize: 9, color: statusColor }}>
            {statusText}
          </span>
          {status.version && (
            <span className="font-mono" style={{ fontSize: 8, color: `${ringColor}44` }}>
              v{status.version}
            </span>
          )}
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={connecting}
            className="ml-1 rounded border px-1.5 py-0.5 transition disabled:opacity-40"
            style={{ borderColor: `${ringColor}33`, color: `${ringColor}88`, fontSize: 8 }}
          >
            {connecting ? '...' : 'REFRESH'}
          </button>
        </div>
      </div>

      {!status.connected && (
        <div className="rounded border p-3" style={{ borderColor: '#ff444433', background: 'rgba(255,68,68,0.05)' }}>
          <p style={{ fontSize: 10, color: '#ff6666' }}>
            Voicebox is not running. Start Voicebox on port 17493.
          </p>
          <p style={{ fontSize: 8, color: '#ff666666', marginTop: 4 }}>
            Run: <code className="font-mono" style={{ color: '#ff8888' }}>voicebox serve --port 17493</code>
          </p>
        </div>
      )}

      {status.connected && (
        <>
          {/* Engine selector */}
          <div>
            <label className="mb-1 block" style={{ fontSize: 9, color: `${ringColor}aa` }}>TTS ENGINE</label>
            <div className="flex flex-wrap gap-1.5">
              {(engines.length > 0 ? engines : [
                { id: 'kokoro', name: 'Kokoro', description: 'Fast neural TTS' },
                { id: 'chatterbox', name: 'Chatterbox', description: 'Conversational' },
                { id: 'luxtts', name: 'LuxTTS', description: 'High quality' },
                { id: 'qwen3-tts', name: 'Qwen3-TTS', description: 'Multilingual' },
                { id: 'hume-tada', name: 'HumeAI TADA', description: 'Expressive' },
                { id: 'piper', name: 'Piper', description: 'Lightweight local' },
                { id: 'edge-tts', name: 'Edge TTS', description: 'Microsoft cloud' },
              ]).map(engine => (
                <button
                  key={engine.id}
                  type="button"
                  onClick={() => setSelectedEngine(engine.id)}
                  className="rounded border px-2 py-1 transition"
                  style={{
                    borderColor: selectedEngine === engine.id ? ringColor : `${ringColor}33`,
                    color: selectedEngine === engine.id ? ringColor : `${ringColor}88`,
                    background: selectedEngine === engine.id ? `${ringColor}18` : 'transparent',
                    fontSize: 10,
                  }}
                >
                  <div className="font-mono">{engine.name}</div>
                  {engine.description && <div style={{ fontSize: 8, opacity: 0.5 }}>{engine.description}</div>}
                </button>
              ))}
            </div>
          </div>

          {/* Voice profile selector */}
          <div>
            <label className="mb-1 block" style={{ fontSize: 9, color: `${ringColor}aa` }}>VOICE PROFILE</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedProfile('')}
                className="rounded border px-2 py-1 transition"
                style={{
                  borderColor: !selectedProfile ? ringColor : `${ringColor}33`,
                  color: !selectedProfile ? ringColor : `${ringColor}88`,
                  background: !selectedProfile ? `${ringColor}18` : 'transparent',
                  fontSize: 10,
                }}
              >
                Default
              </button>
              {profiles.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProfile(p.id)}
                  className="rounded border px-2 py-1 transition"
                  style={{
                    borderColor: selectedProfile === p.id ? ringColor : `${ringColor}33`,
                    color: selectedProfile === p.id ? ringColor : `${ringColor}88`,
                    background: selectedProfile === p.id ? `${ringColor}18` : 'transparent',
                    fontSize: 10,
                  }}
                >
                  {p.name}
                  {jarvisVoice === p.id && (
                    <span className="ml-1" style={{ color: '#00ff88', fontSize: 8 }}>JARVIS</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Clone voice */}
          <div className="rounded border p-2" style={{ borderColor: `${ringColor}22`, background: 'rgba(0,0,0,0.12)' }}>
            <p className="mb-1.5" style={{ fontSize: 10, color: `${ringColor}aa` }}>CLONE VOICE</p>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={cloneName}
                onChange={e => setCloneName(e.target.value)}
                placeholder="Profile name"
                className="flex-1 rounded border bg-black/40 px-2 py-1 font-mono outline-none"
                style={{ borderColor: `${ringColor}44`, color: ringColor, fontSize: 10 }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                id="voicebox-clone-input"
              />
              <label
                htmlFor="voicebox-clone-input"
                className="cursor-pointer rounded border px-2 py-1 transition"
                style={{ borderColor: `${ringColor}66`, color: ringColor, fontSize: 10 }}
              >
                AUDIO
              </label>
              <button
                type="button"
                onClick={() => void handleCloneVoice()}
                disabled={cloning || !cloneName.trim()}
                className="rounded border px-2 py-1 transition disabled:opacity-40"
                style={{ borderColor: '#00ff8866', color: '#00ff88', fontSize: 10 }}
              >
                {cloning ? 'CLONING...' : 'CLONE'}
              </button>
            </div>
            {cloneError && (
              <p className="mt-1" style={{ fontSize: 8, color: '#ff6666' }}>{cloneError}</p>
            )}
            <p className="mt-1" style={{ fontSize: 8, color: `${ringColor}44` }}>
              Upload 3-30 seconds of clean speech audio
            </p>
          </div>

          {/* Set as JARVIS voice */}
          <button
            type="button"
            onClick={setJarvisDefault}
            className="w-full rounded border py-2 font-mono transition"
            style={{
              borderColor: '#00ff88',
              color: '#00ff88',
              background: 'rgba(0,255,136,0.08)',
              fontSize: 10,
            }}
          >
            SET AS JARVIS VOICE
          </button>

          {/* Voice effects */}
          <div className="rounded border p-2" style={{ borderColor: `${ringColor}22`, background: 'rgba(0,0,0,0.12)' }}>
            <p className="mb-2" style={{ fontSize: 10, color: `${ringColor}aa` }}>VOICE EFFECTS</p>
            {([
              { key: 'pitchShift' as const, label: 'Pitch', min: -12, max: 12, step: 1 },
              { key: 'reverb' as const, label: 'Reverb', min: 0, max: 100, step: 1 },
              { key: 'delay' as const, label: 'Delay', min: 0, max: 100, step: 1 },
              { key: 'chorus' as const, label: 'Chorus', min: 0, max: 100, step: 1 },
            ]).map(effect => (
              <div key={effect.key} className="mb-1.5 last:mb-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span style={{ fontSize: 9, color: `${ringColor}88` }}>{effect.label}</span>
                  <span style={{ fontSize: 9, color: ringColor }}>{effects[effect.key]}</span>
                </div>
                <input
                  type="range"
                  min={effect.min}
                  max={effect.max}
                  step={effect.step}
                  value={effects[effect.key]}
                  onChange={e => updateEffect(effect.key, parseFloat(e.target.value))}
                  className="w-full accent-current"
                  style={{ color: ringColor, height: 3 }}
                />
              </div>
            ))}
          </div>

          {/* Language selector */}
          <div>
            <label className="mb-1 block" style={{ fontSize: 9, color: `${ringColor}aa` }}>LANGUAGE</label>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setSelectedLanguage(lang.code)}
                  className="rounded border px-2 py-1 transition"
                  style={{
                    borderColor: selectedLanguage === lang.code ? ringColor : `${ringColor}33`,
                    color: selectedLanguage === lang.code ? ringColor : `${ringColor}88`,
                    background: selectedLanguage === lang.code ? `${ringColor}18` : 'transparent',
                    fontSize: 10,
                  }}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* STT Model */}
          <div>
            <label className="mb-1 block" style={{ fontSize: 9, color: `${ringColor}aa` }}>STT MODEL (WHISPER)</label>
            <div className="flex gap-1.5">
              {WHISPER_MODELS.map(model => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setWhisperModel(model.id)}
                  className="rounded border px-2 py-1 transition"
                  style={{
                    borderColor: whisperModel === model.id ? ringColor : `${ringColor}33`,
                    color: whisperModel === model.id ? ringColor : `${ringColor}88`,
                    background: whisperModel === model.id ? `${ringColor}18` : 'transparent',
                    fontSize: 10,
                  }}
                >
                  <div className="font-mono">{model.label}</div>
                  <div style={{ fontSize: 8, opacity: 0.5 }}>{model.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Test voice */}
          <div>
            <label className="mb-1 block" style={{ fontSize: 9, color: `${ringColor}aa` }}>TEST VOICE</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={testText}
                onChange={e => setTestText(e.target.value)}
                placeholder="Enter text to test..."
                className="flex-1 rounded border bg-black/40 px-2 py-1 font-mono outline-none"
                style={{ borderColor: `${ringColor}44`, color: ringColor, fontSize: 10 }}
              />
              <button
                type="button"
                onClick={() => void testVoice()}
                disabled={testing}
                className="rounded border px-2 py-1 transition disabled:opacity-40"
                style={{ borderColor: `${ringColor}66`, color: ringColor, fontSize: 10 }}
              >
                {testing ? '...' : 'TEST'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
