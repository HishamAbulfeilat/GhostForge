'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePlatform, detectLanguage, getSpeechLang, platformLabel } from '@/lib/platform'

// Web Speech API type shims
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const getSR = (): (new () => Any) | null => {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as Any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

// ── Types ──────────────────────────────────────────────────────────────────────

type Mode = 'idle' | 'listening' | 'thinking' | 'speaking'
type Emotion = 'neutral' | 'happy' | 'thinking' | 'alert' | 'processing' | 'done'
type VoiceEngine = 'browser' | 'elevenlabs' | 'fish-audio'

interface Message {
  id: string
  role: 'user' | 'ai'
  text: string
  tool?: string | null
  toolResult?: string | null
  emotion?: Emotion
  usedModel?: string
  domain?: string
  confidence?: number
  risk?: { risk: number; level: string; reason: string; requires_confirmation: boolean } | null
  requiresConfirmation?: boolean
  ts: number
}

interface Memory {
  userName: string
  preferences: { city: string; music: string }
  facts: string[]
  conversationCount: number
}

interface ModelInfo {
  provider: string; id: string; label: string; free: boolean; available: boolean
}

interface TtsInfo {
  engine: VoiceEngine; fishAudio: boolean; elevenLabs: boolean; jarvisVoice: boolean; jarvisModelId: string
}

interface Toast {
  id: string; type: 'info' | 'warn' | 'error' | 'success'; msg: string
}

// ── Orb colors ────────────────────────────────────────────────────────────────

const MODE_COLORS: Record<Mode, { ring: string; glow: string }> = {
  idle:      { ring: '#1a6fff', glow: 'rgba(26,111,255,0.25)' },
  listening: { ring: '#00ff88', glow: 'rgba(0,255,136,0.30)' },
  thinking:  { ring: '#ffaa00', glow: 'rgba(255,170,0,0.28)'  },
  speaking:  { ring: '#aa44ff', glow: 'rgba(170,68,255,0.28)' },
}

const GREETINGS = [
  'All systems operational.',
  'Systems fully operational.',
  "Ready for your command.",
  'Initialized. Standing by.',
]

// ── Orb SVG ───────────────────────────────────────────────────────────────────

function OrbSVG({ mode }: { mode: Mode }) {
  const c = MODE_COLORS[mode]
  const isThinking = mode === 'thinking'
  const isListening = mode === 'listening'
  return (
    <svg width="220" height="220" viewBox="0 0 240 240" className="select-none">
      {isThinking && (
        <circle cx="120" cy="120" r="112" fill="none" stroke={c.ring} strokeWidth="1.5"
          strokeDasharray="60 300" strokeLinecap="round" opacity="0.7">
          <animateTransform attributeName="transform" type="rotate"
            from="0 120 120" to="360 120 120" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx="120" cy="120" r="108" fill="none" stroke={c.ring} strokeWidth="0.8" opacity="0.3">
        {isListening && <animate attributeName="r" values="108;116;108" dur="0.8s" repeatCount="indefinite" />}
      </circle>
      <circle cx="120" cy="120" r="90" fill="none" stroke={c.ring} strokeWidth="1" opacity="0.45">
        {isListening && <animate attributeName="r" values="90;96;90" dur="0.7s" repeatCount="indefinite" />}
      </circle>
      <circle cx="120" cy="120" r="78" fill="none" stroke={c.ring} strokeWidth="1.2"
        strokeDasharray="30 180" strokeLinecap="round" opacity="0.5">
        <animateTransform attributeName="transform" type="rotate"
          from="0 120 120" to={isThinking ? '-360 120 120' : '360 120 120'}
          dur={isThinking ? '2s' : '8s'} repeatCount="indefinite" />
      </circle>
      <circle cx="120" cy="120" r="64" fill={c.glow}>
        <animate attributeName="opacity"
          values={mode === 'idle' ? '0.6;0.9;0.6' : mode === 'listening' ? '0.8;1;0.8' : '1;0.8;1'}
          dur={mode === 'idle' ? '3s' : '0.6s'} repeatCount="indefinite" />
      </circle>
      <circle cx="120" cy="120" r="64" fill="none" stroke={c.ring} strokeWidth="1.5" opacity="0.7" />
      <circle cx="120" cy="120" r="44" fill="#050510" />
      <circle cx="120" cy="120" r="44" fill="none" stroke={c.ring} strokeWidth="2" opacity="0.8">
        <animate attributeName="stroke-width"
          values={mode === 'speaking' ? '2;3.5;2' : '2;2;2'} dur="0.4s" repeatCount="indefinite" />
      </circle>
      <text x="120" y="115" textAnchor="middle" dominantBaseline="middle"
        fontSize="11" fontFamily="monospace" fontWeight="bold" fill={c.ring} opacity="0.9" letterSpacing="2">
        G.F.A.I
      </text>
      <text x="120" y="130" textAnchor="middle" dominantBaseline="middle"
        fontSize="7" fontFamily="monospace" fill={c.ring} opacity="0.6" letterSpacing="1">
        {mode.toUpperCase()}
      </text>
      {mode === 'speaking' && [-3, -1.5, 0, 1.5, 3].map((offset, i) => (
        <rect key={i} x={120 + offset * 6 - 2} y="108" width="3" rx="1.5" fill={c.ring} opacity="0.8">
          <animate attributeName="height" values={`${4 + i * 3};${14 + i * 2};${4 + i * 3}`}
            dur={`${0.3 + i * 0.08}s`} repeatCount="indefinite" />
          <animate attributeName="y" values={`${120 - 2 - i};${120 - 7 - i};${120 - 2 - i}`}
            dur={`${0.3 + i * 0.08}s`} repeatCount="indefinite" />
        </rect>
      ))}
      {mode === 'listening' && (
        <circle cx="120" cy="120" r="20" fill="none" stroke={c.ring} strokeWidth="1" opacity="0.5">
          <animate attributeName="r" values="20;36;20" dur="1s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="1s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  )
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function Clock() {
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
      setDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="text-right font-mono">
      <div className="text-xl font-bold text-blue-300 tracking-widest">{time}</div>
      <div className="text-[9px] text-blue-400/60 tracking-widest uppercase">{date}</div>
    </div>
  )
}

// ── Toast notifications ───────────────────────────────────────────────────────

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (!toasts.length) return null
  const colors: Record<Toast['type'], string> = {
    info:    '#1a6fff',
    warn:    '#ffaa00',
    error:   '#ff4444',
    success: '#00ff88',
  }
  return (
    <div className="fixed top-14 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          className="gfai-fade pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 font-mono text-[10px] max-w-xs"
          style={{ borderColor: `${colors[t.type]}66`, background: 'rgba(0,5,20,0.95)', color: colors[t.type], boxShadow: `0 0 12px ${colors[t.type]}22` }}>
          <span className="shrink-0 mt-0.5">{t.type === 'warn' ? '⚠' : t.type === 'error' ? '✗' : t.type === 'success' ? '✓' : 'ℹ'}</span>
          <span className="leading-relaxed" style={{ color: 'rgba(200,210,255,0.9)' }}>{t.msg}</span>
          <button type="button" onClick={() => onRemove(t.id)}
            className="shrink-0 ml-1 opacity-40 hover:opacity-100 transition">✕</button>
        </div>
      ))}
    </div>
  )
}

// ── Tool result card ──────────────────────────────────────────────────────────

function ToolCard({ tool, result, ringColor }: { tool: string; result: string; ringColor: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = result.length > 120
  const display = isLong && !expanded ? result.slice(0, 120) + '…' : result
  return (
    <div className="mt-1.5 rounded border text-[10px] font-mono"
      style={{ borderColor: `${ringColor}33`, background: `${ringColor}08` }}>
      <div className="flex items-center justify-between px-2 py-1 border-b"
        style={{ borderColor: `${ringColor}22` }}>
        <span style={{ color: ringColor }}>⚡ {tool.replace(/_/g, ' ').toUpperCase()}</span>
        {isLong && (
          <button type="button" onClick={() => setExpanded(e => !e)}
            className="text-blue-400/50 hover:text-blue-300 transition text-[9px]">
            {expanded ? '▲ less' : '▼ more'}
          </button>
        )}
      </div>
      <pre className="px-2 py-1.5 whitespace-pre-wrap text-blue-200/60 leading-relaxed max-h-40 overflow-y-auto">
        {display}
      </pre>
    </div>
  )
}

// ── Audit Log Panel ───────────────────────────────────────────────────────────

interface AuditEntry { ts: string; level: string; event: string; tool?: string; result?: string; risk?: number; blocked?: boolean }

function AuditPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/jarvis/audit?limit=30')
      .then(r => r.json())
      .then((d: { entries?: AuditEntry[] }) => { setEntries(d.entries || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const levelColor = (l: string) => ({ danger: '#ef4444', security: '#f97316', warn: '#f59e0b', info: '#22c55e', access: '#60a5fa' })[l] || '#60a5fa'

  return (
    <div className="relative z-20 border-b font-mono text-[10px]" style={{ borderColor: '#f59e0b22', background: 'rgba(0,5,20,0.98)', maxHeight: '220px' }}>
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: '#f59e0b22' }}>
        <span className="text-amber-400/80 tracking-widest">📋 AUDIT LOG — LAST 30 EVENTS</span>
        <button type="button" onClick={onClose} className="text-blue-400/50 hover:text-blue-300">✕ CLOSE</button>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: '170px' }}>
        {loading ? (
          <div className="px-4 py-3 text-blue-400/40">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-3 text-blue-400/40">No audit entries yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-blue-400/30 text-[9px]">
                <th className="px-3 py-1 text-left">TIME</th>
                <th className="px-3 py-1 text-left">LEVEL</th>
                <th className="px-3 py-1 text-left">EVENT</th>
                <th className="px-3 py-1 text-left">TOOL</th>
                <th className="px-3 py-1 text-left">RISK</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} className="border-b" style={{ borderColor: '#ffffff05' }}>
                  <td className="px-3 py-1 text-blue-400/40">{new Date(e.ts).toLocaleTimeString()}</td>
                  <td className="px-3 py-1" style={{ color: levelColor(e.level) }}>{e.level.toUpperCase()}</td>
                  <td className="px-3 py-1 text-blue-200/70">{e.event}</td>
                  <td className="px-3 py-1 text-blue-400/60">{e.tool || '—'}</td>
                  <td className="px-3 py-1">
                    {e.risk != null && (
                      <span style={{ color: e.risk > 70 ? '#ef4444' : e.risk > 40 ? '#f59e0b' : '#22c55e' }}>
                        {e.blocked ? '🚫 ' : ''}{e.risk}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Voice Enrollment Panel ────────────────────────────────────────────────────

function VoiceEnrollPanel({ mc }: { mc: { ring: string } }) {
  const [status, setStatus]   = useState<'idle' | 'recording' | 'uploading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startEnroll = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      mediaRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        setStatus('uploading')
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const fd = new FormData()
        fd.append('audio', blob, 'voice-sample.webm')
        fd.append('action', 'enroll-voice')
        try {
          const res = await fetch('/api/jarvis/biometrics', { method: 'POST', body: fd })
          const data = await res.json()
          setStatus(data.success ? 'done' : 'error')
          setMessage(data.success ? '✓ Voice profile saved — JARVIS will recognize you' : data.error || 'Enrollment failed')
        } catch {
          setStatus('error')
          setMessage('Upload failed — try again')
        }
      }
      rec.start()
      setStatus('recording')
      setMessage('Recording... speak naturally for 10 seconds')
      setTimeout(() => { if (mediaRef.current?.state === 'recording') mediaRef.current.stop() }, 10_000)
    } catch {
      setStatus('error')
      setMessage('Microphone access denied')
    }
  }

  const stopEarly = () => { if (mediaRef.current?.state === 'recording') mediaRef.current.stop() }

  return (
    <div className="min-w-[220px]">
      <p className="text-blue-400/40 tracking-widest mb-1.5">VOICE BIOMETRICS</p>
      <p className="text-[9px] text-blue-400/30 mb-2 leading-relaxed">
        Enroll your voice so JARVIS can verify your identity and lock out imposters.
      </p>
      <div className="flex gap-1.5 items-center flex-wrap">
        {status !== 'recording' ? (
          <button type="button" onClick={() => void startEnroll()}
            disabled={status === 'uploading'}
            className="rounded px-2 py-1 border transition text-[10px] disabled:opacity-40"
            style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}12` }}>
            🎙 {status === 'uploading' ? 'PROCESSING...' : status === 'done' ? 'RE-ENROLL VOICE' : 'ENROLL VOICE'}
          </button>
        ) : (
          <button type="button" onClick={stopEarly}
            className="rounded px-2 py-1 border transition text-[10px] animate-pulse"
            style={{ borderColor: '#ff4444', color: '#ff4444', background: 'rgba(255,68,68,0.1)' }}>
            ⏹ STOP RECORDING
          </button>
        )}
        {status === 'recording' && (
          <span className="text-[9px] text-red-400/60 animate-pulse">● REC</span>
        )}
      </div>
      {message && (
        <p className="mt-1 text-[9px] leading-relaxed" style={{ color: status === 'done' ? '#00ff88' : status === 'error' ? '#ff6666' : `${mc.ring}99` }}>
          {message}
        </p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function JarvisPage() {
  const platform = usePlatform()
  const [mode, setMode]                     = useState<Mode>('idle')
  const [messages, setMessages]             = useState<Message[]>([])
  const [input, setInput]                   = useState('')
  const [memory, setMemory]                 = useState<Memory>({ userName: '', preferences: { city: 'Riyadh', music: 'spotify' }, facts: [], conversationCount: 0 })
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [wakeWordActive, setWakeWordActive] = useState(false)
  const [voiceEngine, setVoiceEngine]       = useState<VoiceEngine>('browser')
  const [ttsInfo, setTtsInfo]               = useState<TtsInfo | null>(null)
  const [showSettings, setShowSettings]     = useState(false)
  const [showAudit, setShowAudit]           = useState(false)
  const [models, setModels]                 = useState<ModelInfo[]>([])
  const [activeModel, setActiveModel]       = useState<{ provider: string; model: string } | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [selectedModel, setSelectedModel]       = useState<string>('')
  const [integrations, setIntegrations]     = useState({ github: false, discord: false, googleSearch: false })
  const [lastToolUsed, setLastToolUsed]     = useState<string | null>(null)
  const [liveModel, setLiveModel]           = useState<{ provider: string; model: string } | null>(null)
  const [toasts, setToasts]                 = useState<Toast[]>([])
  const [copilotMode, setCopilotMode]       = useState(false)
  const [copilotThinking, setCopilotThinking] = useState(false)
  const [pendingRiskMsg, setPendingRiskMsg] = useState<{ message: string; tool: string } | null>(null)
  const [speechLang, setSpeechLang]         = useState('en-US')
  const [detectedLang, setDetectedLang]     = useState('en')

  const recognitionRef     = useRef<Any>(null)
  const wakeRecognitionRef = useRef<Any>(null)
  const voicesRef          = useRef<Any[]>([])
  const messagesEndRef     = useRef<HTMLDivElement>(null)
  const inputRef           = useRef<HTMLInputElement>(null)
  const wakeWordActiveRef  = useRef(false)
  const modeRef            = useRef<Mode>('idle')
  const ttsFailCountRef    = useRef(0)

  useEffect(() => { wakeWordActiveRef.current = wakeWordActive }, [wakeWordActive])
  useEffect(() => { modeRef.current = mode }, [mode])

  // ── Toast helpers ─────────────────────────────────────────────────────────

  const toast = useCallback((type: Toast['type'], msg: string, duration = 4000) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, type, msg }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const SR = getSR()
    setVoiceSupported(!!SR)

    const loadVoices = () => { voicesRef.current = window.speechSynthesis?.getVoices() ?? [] }
    loadVoices()
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices)

    // Load models + integrations + TTS info
    fetch('/api/jarvis/models').then(r => r.json()).then(data => {
      setModels(data.models || [])
      setActiveModel(data.active || null)
      setIntegrations({ github: !!data.integrations?.github, discord: !!data.integrations?.discord, googleSearch: !!data.integrations?.googleSearch })
      if (data.tts) {
        setTtsInfo(data.tts)
        // Auto-select best voice engine
        setVoiceEngine(data.tts.engine || 'browser')
        if (data.tts.fishAudio) toast('success', '🎙 JARVIS voice ready — Fish Audio active', 5000)
        else if (data.tts.elevenLabs) toast('info', '🎙 ElevenLabs voice active')
      }
    }).catch(() => {})

    let greetTimer: ReturnType<typeof setTimeout>
    fetch('/api/jarvis/memory').then(r => r.json()).then((m: Memory) => {
      setMemory(m)
      const name = m.userName || ''
      const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
      const welcome = name ? `Welcome back, ${name}. ${greeting}` : `G.F.A.I. online. ${greeting}`
      addAIMessage(welcome, 'neutral', null, null)
      greetTimer = setTimeout(() => speak(welcome), 600)
    }).catch(() => {
      const welcome = 'G.F.A.I. online. Systems operational.'
      addAIMessage(welcome, 'neutral', null, null)
      greetTimer = setTimeout(() => speak(welcome), 600)
    })

    return () => {
      clearTimeout(greetTimer)
      window.speechSynthesis?.cancel()
      window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices)
      recognitionRef.current?.stop()
      wakeRecognitionRef.current?.stop()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const addAIMessage = useCallback((text: string, emotion: Emotion, tool: string | null, toolResult: string | null, usedModel?: string, domain?: string, confidence?: number, risk?: Message['risk'], requiresConfirmation?: boolean) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', text, emotion, tool, toolResult, usedModel, domain, confidence, risk, requiresConfirmation, ts: Date.now() }])
  }, [])

  const addUserMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text, ts: Date.now() }])
  }, [])

  // ── External TTS (Fish Audio / ElevenLabs) with auto-fallback chain ───────

  const speakExternal = useCallback(async (text: string, preferEngine?: VoiceEngine): Promise<{ ok: boolean; usedEngine: string }> => {
    const engine = preferEngine || voiceEngine
    try {
      const res = await fetch('/api/jarvis/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, engine: engine === 'browser' ? 'browser' : engine }),
      })
      const ct = res.headers.get('content-type') || ''
      const actualEngine = res.headers.get('X-TTS-Engine') || engine

      if (!res.ok || ct.includes('application/json')) {
        const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : {}
        ttsFailCountRef.current += 1
        if (ttsFailCountRef.current >= 2) {
          setVoiceEngine('browser')
          toast('warn', `${engine === 'fish-audio' ? 'Fish Audio' : 'TTS'} unavailable (${data.reason || 'error'}) — switched to browser voice`)
        }
        return { ok: false, usedEngine: '' }
      }

      ttsFailCountRef.current = 0
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      setMode('speaking')
      audio.onended = () => { setMode('idle'); URL.revokeObjectURL(url) }
      audio.onerror = () => { setMode('idle'); URL.revokeObjectURL(url) }
      await audio.play()
      return { ok: true, usedEngine: actualEngine }
    } catch {
      ttsFailCountRef.current += 1
      return { ok: false, usedEngine: '' }
    }
  }, [voiceEngine, toast])

  // ── Browser TTS (fallback, always available) ──────────────────────────────

  const speakBrowser = useCallback((text: string) => {
    window.speechSynthesis?.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    const voices = voicesRef.current
    // Best JARVIS-like browser voices (deep British male)
    const preferred =
      voices.find(v => v.name === 'Daniel') ||
      voices.find(v => v.name === 'Alex') ||
      voices.find(v => v.name === 'Google UK Male') ||
      voices.find(v => v.lang === 'en-GB' && !v.name.toLowerCase().includes('female')) ||
      voices.find(v => v.name === 'Samantha') ||
      voices.find(v => v.lang.startsWith('en') && v.localService) ||
      voices[0]
    if (preferred) utt.voice = preferred
    utt.rate   = 0.92
    utt.pitch  = 0.82   // Low pitch = JARVIS gravitas
    utt.volume = 1.0
    utt.onstart = () => setMode('speaking')
    utt.onend   = () => setMode('idle')
    utt.onerror = () => setMode('idle')
    window.speechSynthesis?.speak(utt)
  }, [])

  // ── Unified speak: external engines → browser fallback ───────────────────

  const speak = useCallback(async (text: string) => {
    if (voiceEngine !== 'browser') {
      const { ok } = await speakExternal(text)
      if (ok) return
      // Auto-fallback to browser if external failed
    }
    speakBrowser(text)
  }, [voiceEngine, speakExternal, speakBrowser])

  // ── Send directly to Copilot CLI ─────────────────────────────────────────

  const sendToCopilot = useCallback(async (text: string) => {
    if (!text.trim()) return
    addUserMessage(`[Copilot CLI] ${text}`)
    setMode('thinking')
    setCopilotThinking(true)
    try {
      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Use the copilot_ask tool to answer this for the user: ${text}`,
          memory,
        }),
      })
      const data = await res.json() as { speech: string; tool: string | null; toolResult: string | null; emotion: string }
      const answer = data.toolResult || data.speech || 'No response from Copilot CLI'
      addAIMessage(`🤖 ${answer}`, 'done', 'copilot_ask', data.toolResult)
      await speak(data.speech || 'Here is what Copilot CLI says.')
    } catch {
      const err = 'Copilot CLI unreachable.'
      addAIMessage(err, 'alert', null, null)
    } finally {
      setCopilotThinking(false)
      setMode('idle')
    }
  }, [memory, addUserMessage, addAIMessage, speak])

  // ── Send to G.F.A.I. ─────────────────────────────────────────
  const sendToJarvis = useCallback(async (text: string) => {
    if (!text.trim()) return
    // If Copilot Mode is ON, route directly to Copilot CLI
    if (copilotMode) { void sendToCopilot(text); return }
    // Re-route "Ask Copilot: ..." quick commands
    const copilotMatch = text.match(/^Ask Copilot:\s*(.+)/i)
    if (copilotMatch) {
      text = `Ask GitHub Copilot CLI: ${copilotMatch[1]}`
    }
    addUserMessage(text)
    setMode('thinking')
    setLastToolUsed(null)

    // Detect language and auto-update speech recognition language
    const msgLang = detectLanguage(text)
    if (msgLang !== detectedLang) {
      setDetectedLang(msgLang)
      setSpeechLang(getSpeechLang(msgLang))
    }

    // Extract name
    const nameMatch = text.match(/my name is (\w+)|اسمي (\w+)/i)
    if (nameMatch) {
      const name = nameMatch[1] || nameMatch[2]
      setMemory(prev => ({ ...prev, userName: name }))
      fetch('/api/jarvis/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: name }),
      }).catch(() => {})
    }

    try {
      const historySlice = messages.slice(-8).map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user', content: m.text,
      }))
      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: historySlice,
          memory,
          selectedProvider: selectedProvider || undefined,
          selectedModel: selectedModel || undefined,
          confirmRisk: /^(confirm|yes|proceed|do it|تأكيد|نعم)$/i.test(text.trim()) && pendingRiskMsg != null,
          lang: msgLang,
          platform: platform.type,
        }),
      })
      const data = await res.json() as {
        speech: string; tool: string | null; toolResult: string | null
        emotion: Emotion; usedModel?: string; usedProvider?: string
        domain?: string; confidence?: number; detectedLang?: string
        risk?: { risk: number; level: string; reason: string; requires_confirmation: boolean }
        requiresConfirmation?: boolean
      }
      const { speech, tool, toolResult, emotion, usedModel, usedProvider, domain, confidence, risk, requiresConfirmation, detectedLang: serverLang } = data

      if (tool) setLastToolUsed(tool)
      if (serverLang && serverLang !== detectedLang) {
        setDetectedLang(serverLang)
        setSpeechLang(getSpeechLang(serverLang))
      }

      // Update live model display
      if (usedModel) {
        const live = { provider: usedProvider || '', model: usedModel }
        setLiveModel(live)

        // Show toast if fallback occurred (selected model ≠ actually used model)
        if (selectedModel && selectedModel !== usedModel) {
          toast('warn', `Selected "${selectedModel}" unavailable — used "${usedModel}" instead`)
        }
      }

      addAIMessage(speech, emotion || 'neutral', tool, toolResult, usedModel, domain, confidence, risk, requiresConfirmation)
      await speak(speech)

      if (requiresConfirmation) {
        toast('warn', `⚠️ High-risk action detected. Reply "confirm" to proceed or "cancel" to abort.`, 10000)
        setPendingRiskMsg({ message: text, tool: tool || '' })
      } else {
        setPendingRiskMsg(null)
      }

      fetch('/api/jarvis/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationCount: (memory.conversationCount || 0) + 1 }),
      }).catch(() => {})
    } catch (e) {
      const err = 'Systems error. Please try again.'
      addAIMessage(err, 'alert', null, null)
      toast('error', `Request failed: ${String(e).slice(0, 60)}`)
      await speak(err)
      setMode('idle')
      console.error(e)
    }
  }, [messages, memory, selectedProvider, selectedModel, copilotMode, detectedLang, platform.type, sendToCopilot, addUserMessage, addAIMessage, speak, toast])

  // ── Voice recognition ─────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    const SR = getSR()
    if (!SR) return
    window.speechSynthesis?.cancel()
    // Stop wake listener while actively listening
    wakeRecognitionRef.current?.stop()
    setMode('listening')

    const rec = new SR()
    // Use detected language or browser language for multilingual support
    rec.lang = speechLang
    rec.continuous = false
    rec.interimResults = true
    recognitionRef.current = rec

    let finalTranscript = ''
    rec.onresult = (e: Any) => {
      finalTranscript = ''
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript
      }
    }
    rec.onerror = (ev: Any) => {
      if (ev?.error !== 'aborted') setMode('idle')
    }
    rec.onend = () => {
      if (finalTranscript.trim()) {
        setInput('')
        void sendToJarvis(finalTranscript.trim())
      } else if (modeRef.current === 'listening') {
        setMode('idle')
      }
    }
    try { rec.start() } catch { setMode('idle') }
  }, [sendToJarvis])

  // ── Wake word ─────────────────────────────────────────────────────────────

  const toggleWakeWord = useCallback(() => {
    const SR = getSR()
    if (!SR) return

    if (wakeWordActiveRef.current) {
      wakeRecognitionRef.current?.stop()
      wakeRecognitionRef.current = null
      setWakeWordActive(false)
      return
    }

    setWakeWordActive(true)
    let isRestarting = false

    const WAKE_PHRASES = ['hey jarvis', 'jarvis', 'hey ghostforge', 'ghost forge', 'hey forge', 'gfai', 'g f a i', 'hey gfai']

    const startWake = () => {
      if (!wakeWordActiveRef.current || isRestarting) return
      const rec = new SR()
      // Wake word always uses English (jarvis / hey jarvis) — don't change this
      rec.lang = 'en-US'
      rec.continuous = true
      rec.interimResults = true
      wakeRecognitionRef.current = rec

      rec.onresult = (e: Any) => {
        if (modeRef.current !== 'idle') return // Don't trigger while busy
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transcript = Array.from(e.results as any[])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((r: any) => r[0].transcript).join(' ').toLowerCase().trim()
        const triggered = WAKE_PHRASES.some(phrase => transcript.includes(phrase))
        if (triggered) {
          rec.abort?.() ?? rec.stop()
          void speak("Yes, I'm listening.")
          setTimeout(startListening, 1000)
        }
      }
      rec.onend = () => {
        if (wakeWordActiveRef.current && !isRestarting) {
          isRestarting = true
          setTimeout(() => { isRestarting = false; startWake() }, 400)
        }
      }
      rec.onerror = (ev: Any) => {
        if (ev?.error === 'not-allowed') {
          setWakeWordActive(false)
          toast('error', 'Microphone permission denied. Enable in browser settings.')
          return
        }
        if (wakeWordActiveRef.current && !isRestarting) {
          isRestarting = true
          setTimeout(() => { isRestarting = false; startWake() }, 600)
        }
      }
      try { rec.start() } catch { /* ignore */ }
    }

    startWake()
  }, [speak, startListening, toast])

  // ── Form submit ───────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    void sendToJarvis(input)
    setInput('')
  }

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel()
    setMode('idle')
  }

  const mc = MODE_COLORS[mode]

  // ── Quick commands ────────────────────────────────────────────────────────

  const QUICK_COMMANDS = [
    { label: '⏰ Time',       cmd: "What's the current time and date?" },
    { label: '🌤 Weather',   cmd: 'What\'s the weather like right now?' },
    { label: '🔍 Search',    cmd: 'Search for the latest AI news' },
    { label: '💻 System',    cmd: 'Give me a system status report' },
    { label: '📸 Screenshot',cmd: 'Take a screenshot' },
    { label: '🔒 Lock',      cmd: 'Lock the screen' },
    { label: '🎵 Play',      cmd: 'Play music on Spotify' },
    { label: '🔔 Remind',    cmd: 'Remind me to check my tasks in 1 hour' },
    { label: '📋 Clipboard', cmd: 'What\'s in my clipboard?' },
    { label: '📝 Note',      cmd: 'Save note: reviewed code today' },
    { label: '🤖 Copilot',   cmd: 'Ask Copilot: how do I list all running processes on Mac?' },
    ...(integrations.github ? [{ label: '🐙 GitHub', cmd: 'Show my GitHub repositories' }] : []),
    ...(integrations.discord ? [{ label: '💬 Discord', cmd: 'Send a Discord message: GhostForge AI is online' }] : []),
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes scanline {
          0%   { transform: translateY(-100%); opacity: 0; }
          10%  { opacity: 0.05; }
          90%  { opacity: 0.05; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        @keyframes hudFadeIn { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
        @keyframes statusBlink { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .gfai-scan   { animation: scanline 6s linear infinite; }
        .gfai-fade   { animation: hudFadeIn 0.35s ease both; }
        .gfai-blink  { animation: statusBlink 2s ease-in-out infinite; }
        .gfai-grid   {
          background-image:
            linear-gradient(rgba(26,111,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(26,111,255,0.04) 1px, transparent 1px);
          background-size: 40px 40px;
        }
        .gfai-msg-user { background: rgba(26,111,255,0.10); border-left: 2px solid #1a6fff; }
        .gfai-msg-ai   { background: rgba(0,5,20,0.65); border-left: 2px solid; }
        .gfai-scroll::-webkit-scrollbar { width: 4px; }
        .gfai-scroll::-webkit-scrollbar-track { background: transparent; }
        .gfai-scroll::-webkit-scrollbar-thumb { background: rgba(26,111,255,0.2); border-radius: 2px; }
        .gfai-input:focus { outline: none; box-shadow: 0 0 0 1px ${mc.ring}55; }
        .settings-slide { transition: max-height 0.3s ease, opacity 0.3s ease; }
      `}</style>

      <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#000208] text-white gfai-grid">

        {/* Scanline */}
        <div className="pointer-events-none absolute inset-0 z-0 gfai-scan"
          style={{ background: 'linear-gradient(transparent 50%, rgba(26,111,255,0.03) 50%)', backgroundSize: '100% 4px' }} />

        {/* ── Top HUD bar ── */}
        <div className="relative z-10 flex shrink-0 items-center justify-between border-b px-4 py-2"
          style={{ borderColor: `${mc.ring}33`, background: 'rgba(0,5,20,0.92)' }}>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-xs font-mono text-blue-400/60 hover:text-blue-300 transition">← DASHBOARD</Link>
            <span className="text-[10px] text-blue-400/30 font-mono">|</span>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full gfai-blink" style={{ background: mc.ring }} />
              <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: mc.ring }}>
                G.F.A.I. — {mode}
              </span>
            </div>
            {lastToolUsed && (
              <span className="font-mono text-[10px] text-blue-400/40 hidden sm:block">
                ⚡ {lastToolUsed.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {memory.userName && (
              <span className="font-mono text-[10px] text-blue-300/50 hidden sm:block">
                {memory.userName.toUpperCase()}
              </span>
            )}
            {/* Platform + language indicator */}
            <span className="font-mono text-[10px] text-blue-400/40 hidden sm:block" title={`Device: ${platform.type} | Lang: ${detectedLang}`}>
              {platformLabel(platform)} {detectedLang !== 'en' ? `| ${detectedLang.toUpperCase()}` : ''}
            </span>
            <button type="button" onClick={() => setShowSettings(s => !s)}
              className="font-mono text-[10px] rounded px-2 py-1 border transition"
              style={{ borderColor: `${mc.ring}44`, color: `${mc.ring}99`, background: showSettings ? `${mc.ring}18` : 'transparent' }}>
              ⚙ SETTINGS
            </button>
            <button type="button" onClick={() => setShowAudit(s => !s)}
              className="font-mono text-[10px] rounded px-2 py-1 border transition"
              style={{ borderColor: `${mc.ring}44`, color: '#f59e0b99', background: showAudit ? 'rgba(245,158,11,0.08)' : 'transparent' }}
              title="View audit log of all tool actions">
              📋 AUDIT
            </button>
            {/* ── Copilot CLI Mode Toggle ── */}
            <button type="button"
              onClick={() => {
                const next = !copilotMode
                setCopilotMode(next)
                toast(next ? 'success' : 'info',
                  next ? '🤖 Copilot CLI mode ON — all messages go to gh copilot' : '🤖 Copilot CLI mode OFF — back to G.F.A.I.')
              }}
              className="font-mono text-[10px] rounded px-2 py-1 border transition"
              style={{
                borderColor: copilotMode ? '#00ff88' : `${mc.ring}44`,
                color:       copilotMode ? '#00ff88' : `${mc.ring}88`,
                background:  copilotMode ? 'rgba(0,255,136,0.08)' : 'transparent',
                boxShadow:   copilotMode ? '0 0 8px rgba(0,255,136,0.2)' : 'none',
              }}
              title="Toggle GitHub Copilot CLI mode — routes messages directly to gh copilot">
              {copilotMode ? '🤖 COPILOT ON' : '🤖 COPILOT'}
            </button>
            <Clock />
          </div>
        </div>

        {/* ── Copilot CLI mode banner ── */}
        {copilotMode && (
          <div className="gfai-fade relative z-20 flex items-center justify-between border-b px-4 py-1.5 font-mono text-[10px]"
            style={{ borderColor: '#00ff8844', background: 'rgba(0,255,136,0.05)' }}>
            <div className="flex items-center gap-2">
              <span className="gfai-blink h-1.5 w-1.5 rounded-full bg-green-400" />
              <span style={{ color: '#00ff88' }}>COPILOT CLI MODE ACTIVE</span>
              <span className="text-blue-400/40">— messages route directly to <code className="text-green-400/70">gh copilot -p</code></span>
            </div>
            <button type="button" onClick={() => { setCopilotMode(false); toast('info', 'Copilot CLI mode OFF') }}
              className="text-green-400/50 hover:text-green-300 transition">✕ EXIT</button>
          </div>
        )}

        {/* ── Settings panel (collapsible) ── */}
        {showSettings && (          <div className="relative z-20 border-b px-4 py-3 gfai-fade"
            style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,25,0.97)' }}>
            <div className="flex flex-wrap gap-6 font-mono text-[10px]">

              {/* Model selector */}
              <div className="flex-1 min-w-[280px]">
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="text-blue-400/40 tracking-widest">AI MODEL</p>
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
                  {models.filter(m => m.available).map(m => {
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
                        {isActive && <span className="mr-1">✓</span>}
                        {isLast && !isActive && <span className="mr-1" style={{ color: mc.ring }}>◉</span>}
                        {m.label}
                        {m.free && <span className="ml-1 opacity-40">free</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Voice selector */}
              <div>
                <p className="text-blue-400/40 tracking-widest mb-1.5">VOICE ENGINE</p>
                <div className="flex flex-wrap gap-1.5">
                  {/* Fish Audio — JARVIS movie voice */}
                  <button type="button"
                    disabled={!ttsInfo?.fishAudio}
                    onClick={() => { setVoiceEngine('fish-audio'); ttsFailCountRef.current = 0; toast('success', '🎙 Fish Audio JARVIS voice active (movie-accurate)') }}
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
                    onClick={() => { setVoiceEngine('elevenlabs'); ttsFailCountRef.current = 0; toast('success', 'ElevenLabs active — Adam voice') }}
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
                    onClick={() => { setVoiceEngine('browser'); ttsFailCountRef.current = 0; toast('info', 'Browser TTS active (Daniel/Alex voice)') }}
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
                      ? '🎙 Fish Audio model ID: 612b878b113047d9a770c069c8b4fdfe (Iron Man JARVIS)'
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

              {/* Voice Biometrics Enrollment */}
              <VoiceEnrollPanel mc={mc} />
            </div>
          </div>
        )}

        {/* ── Audit Log Panel ── */}
        {showAudit && (
          <AuditPanel onClose={() => setShowAudit(false)} />
        )}

        {/* ── Main body ── */}
        <div className="relative z-10 flex flex-1 overflow-hidden">

          {/* ── Left panel ── */}
          <div className="hidden md:flex w-44 shrink-0 flex-col gap-3 border-r p-3 font-mono text-[10px]"
            style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.6)' }}>
            <div>
              <p className="text-blue-400/40 tracking-widest mb-2">SYSTEMS</p>
              {[
                { label: 'AI ENGINE', val: liveModel ? liveModel.model?.split('/').pop()?.split(':')[0]?.slice(0, 14) || 'ONLINE' : 'ONLINE', ok: true },
                { label: 'MAC CTRL', val: 'READY', ok: true },
                { label: 'MEMORY', val: memory.conversationCount > 0 ? `${memory.conversationCount} SES` : 'INIT', ok: true },
                { label: 'VOICE', val: voiceEngine === 'fish-audio' ? 'JARVIS' : voiceEngine === 'elevenlabs' ? 'ELEVENLABS' : voiceSupported ? 'BROWSER' : 'N/A', ok: voiceSupported || voiceEngine !== 'browser' },
                { label: 'WAKE WORD', val: wakeWordActive ? 'ACTIVE' : 'OFF', ok: wakeWordActive },
                { label: 'GITHUB', val: integrations.github ? 'LINKED' : 'N/A', ok: integrations.github },
                { label: 'DISCORD', val: integrations.discord ? 'LINKED' : 'N/A', ok: integrations.discord },
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

          {/* ── Center ── */}
          <div className="flex flex-1 flex-col items-center overflow-hidden">

            {/* Messages */}
            <div className="gfai-scroll flex-1 w-full max-w-2xl overflow-y-auto px-4 py-3 space-y-2">
              {messages.map(m => {
                const borderColor = m.role === 'user' ? '#1a6fff' : (m.emotion === 'alert' ? '#ff4444' : mc.ring)
                return (
                  <div key={m.id}
                    className={`gfai-fade rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'gfai-msg-user ml-8' : 'gfai-msg-ai mr-8'}`}
                    style={{ borderLeftColor: borderColor }}>
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="font-mono text-[10px] opacity-60" style={{ color: borderColor }}>
                        {m.role === 'user' ? 'YOU' : 'G.F.A.I.'}
                      </span>
                      {m.tool && (
                        <span className="font-mono text-[9px] rounded px-1 py-0.5"
                          style={{ background: `${mc.ring}22`, color: mc.ring }}>
                          ⚙ {m.tool.replace(/_/g, ' ')}
                        </span>
                      )}
                      {m.domain && m.domain !== 'general' && m.role === 'ai' && (
                        <span className="font-mono text-[9px] rounded px-1 py-0.5 uppercase tracking-wide"
                          style={{ background: 'rgba(170,68,255,0.12)', color: 'rgba(170,68,255,0.8)', border: '1px solid rgba(170,68,255,0.2)' }}>
                          {m.domain}
                        </span>
                      )}
                      {m.confidence !== undefined && m.role === 'ai' && (
                        <span className="flex items-center gap-1" title={`Confidence: ${m.confidence}%`}>
                          <span className="font-mono text-[9px]" style={{ color: m.confidence >= 80 ? '#00ff88' : m.confidence >= 50 ? '#ffaa00' : '#ff4444' }}>
                            {m.confidence}%
                          </span>
                          <span className="h-1 w-12 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            <span className="h-full block rounded-full transition-all" style={{
                              width: `${m.confidence}%`,
                              background: m.confidence >= 80 ? '#00ff88' : m.confidence >= 50 ? '#ffaa00' : '#ff4444',
                            }} />
                          </span>
                        </span>
                      )}
                    </div>
                    <p className="text-gray-100 leading-relaxed">{m.text}</p>
                    {m.tool && m.toolResult && m.toolResult !== 'Done' && (
                      <ToolCard tool={m.tool} result={m.toolResult} ringColor={mc.ring} />
                    )}
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Orb */}
            <div className="shrink-0 py-3 flex flex-col items-center gap-2">
              <button type="button"
                onClick={
                  mode === 'speaking' ? stopSpeaking :
                  mode === 'listening' ? () => recognitionRef.current?.stop() :
                  mode === 'idle' ? startListening : undefined
                }
                disabled={mode === 'thinking'}
                className="relative cursor-pointer disabled:cursor-wait transition-transform active:scale-95"
                style={{ filter: `drop-shadow(0 0 24px ${mc.glow})` }}
                title={
                  mode === 'idle' ? 'Click to speak' :
                  mode === 'listening' ? 'Listening… click to stop' :
                  mode === 'speaking' ? 'Click to stop speaking' : 'Processing…'
                }
              >
                <OrbSVG mode={mode} />
              </button>

              {/* Voice controls */}
              <div className="flex items-center gap-2">
                {voiceSupported && (
                  <>
                    <button type="button" onClick={startListening}
                      disabled={mode !== 'idle' && mode !== 'speaking'}
                      className="font-mono text-[10px] rounded px-3 py-1.5 border transition disabled:opacity-30"
                      style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}11` }}>
                      🎤 SPEAK
                    </button>
                    <button type="button" onClick={toggleWakeWord}
                      className="font-mono text-[10px] rounded px-3 py-1.5 border transition"
                      style={{
                        borderColor: wakeWordActive ? '#00ff88' : `${mc.ring}44`,
                        color: wakeWordActive ? '#00ff88' : `${mc.ring}88`,
                        background: wakeWordActive ? 'rgba(0,255,136,0.08)' : 'transparent',
                      }}
                      title='Say "Hey GhostForge" to activate'>
                      {wakeWordActive ? '🔊 WAKE ON' : '😴 WAKE OFF'}
                    </button>
                  </>
                )}
                {mode === 'speaking' && (
                  <button type="button" onClick={stopSpeaking}
                    className="font-mono text-[10px] rounded px-2 py-1.5 border border-red-700/50 text-red-400 hover:bg-red-950/30 transition">
                    ■ STOP
                  </button>
                )}
              </div>
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="shrink-0 w-full max-w-2xl px-4 pb-4 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={
                  mode === 'listening' ? 'Listening…'
                  : mode === 'thinking' ? 'Processing…'
                  : mode === 'speaking' ? 'Speaking…'
                  : 'Type a command or question…'
                }
                disabled={mode === 'thinking'}
                className="gfai-input flex-1 rounded-lg border bg-transparent px-4 py-2.5 font-mono text-sm text-gray-100 placeholder-gray-600 transition disabled:opacity-40"
                style={{ borderColor: `${mc.ring}44` }}
              />
              <button type="submit"
                disabled={!input.trim() || mode === 'thinking'}
                className="shrink-0 rounded-lg border px-4 py-2.5 font-mono text-xs font-bold transition disabled:opacity-30 active:scale-95"
                style={{ borderColor: mc.ring, color: mc.ring, background: `${mc.ring}18` }}>
                SEND
              </button>
            </form>
          </div>

          {/* ── Right panel: quick commands ── */}
          <div className="hidden lg:flex w-48 shrink-0 flex-col gap-1.5 border-l p-3"
            style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.6)' }}>
            <p className="font-mono text-[10px] text-blue-400/40 tracking-widest mb-1">QUICK COMMANDS</p>
            <div className="flex-1 overflow-y-auto gfai-scroll space-y-1">
              {QUICK_COMMANDS.map(q => (
                <button type="button" key={q.label}
                  onClick={() => void sendToJarvis(q.cmd)}
                  disabled={mode === 'thinking' || mode === 'listening'}
                  className="w-full text-left rounded px-2 py-1.5 font-mono text-[10px] border transition disabled:opacity-30 hover:border-blue-600/60"
                  style={{ borderColor: `${mc.ring}22`, color: 'rgba(200,210,255,0.7)', background: `${mc.ring}08` }}>
                  {q.label}
                </button>
              ))}
            </div>
            <div className="border-t pt-2 mt-1" style={{ borderColor: `${mc.ring}22` }}>
              <p className="font-mono text-[9px] text-blue-400/30 leading-relaxed">
                Say <span style={{ color: mc.ring }}>"Hey GhostForge"</span> to activate wake word.
              </p>
            </div>
          </div>
        </div>

        {/* ── Bottom HUD bar ── */}
        <div className="relative z-10 flex shrink-0 items-center justify-between border-t px-4 py-1 font-mono text-[9px]"
          style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.92)', color: `${mc.ring}55` }}>
          <span>G.F.A.I. v4.7 — GHOSTFORGE AI SYSTEM</span>
          <span style={{ color: liveModel ? mc.ring : `${mc.ring}44` }}>
            {liveModel
              ? `⚡ ${liveModel.provider}/${liveModel.model?.split('/').pop()?.split(':')[0]}`
              : selectedProvider
                ? `→ ${selectedModel?.split('/').pop()?.split(':')[0]} (pending)`
                : activeModel
                  ? `${activeModel.provider}/${activeModel.model}`
                  : 'AI ENGINE STANDBY'}
          </span>
          <span>PRIVATE · LOCAL · SECURE</span>
        </div>

        {/* Toast container */}
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </>
  )
}
