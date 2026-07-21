'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

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
type VoiceEngine = 'browser' | 'elevenlabs'

interface Message {
  id: string
  role: 'user' | 'ai'
  text: string
  tool?: string | null
  toolResult?: string | null
  emotion?: Emotion
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function JarvisPage() {
  const [mode, setMode]                     = useState<Mode>('idle')
  const [messages, setMessages]             = useState<Message[]>([])
  const [input, setInput]                   = useState('')
  const [memory, setMemory]                 = useState<Memory>({ userName: '', preferences: { city: 'Riyadh', music: 'spotify' }, facts: [], conversationCount: 0 })
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [wakeWordActive, setWakeWordActive] = useState(false)
  const [voiceEngine, setVoiceEngine]       = useState<VoiceEngine>('browser')
  const [hasElevenLabs, setHasElevenLabs]   = useState(false)
  const [showSettings, setShowSettings]     = useState(false)
  const [models, setModels]                 = useState<ModelInfo[]>([])
  const [activeModel, setActiveModel]       = useState<{ provider: string; model: string } | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [selectedModel, setSelectedModel]       = useState<string>('')
  const [integrations, setIntegrations]     = useState({ github: false, discord: false, googleSearch: false })
  const [lastToolUsed, setLastToolUsed]     = useState<string | null>(null)
  const [responseModel, setResponseModel]   = useState<string>('')

  const recognitionRef    = useRef<Any>(null)
  const wakeRecognitionRef = useRef<Any>(null)
  const voicesRef         = useRef<Any[]>([])
  const messagesEndRef    = useRef<HTMLDivElement>(null)
  const inputRef          = useRef<HTMLInputElement>(null)
  // Refs for stale-closure-safe values
  const wakeWordActiveRef = useRef(false)
  const modeRef           = useRef<Mode>('idle')

  // Keep refs in sync
  useEffect(() => { wakeWordActiveRef.current = wakeWordActive }, [wakeWordActive])
  useEffect(() => { modeRef.current = mode }, [mode])

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const SR = getSR()
    setVoiceSupported(!!SR)

    const loadVoices = () => { voicesRef.current = window.speechSynthesis?.getVoices() ?? [] }
    loadVoices()
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices)

    // Load models + integrations
    fetch('/api/jarvis/models').then(r => r.json()).then(data => {
      setModels(data.models || [])
      setActiveModel(data.active || null)
      setHasElevenLabs(!!data.integrations?.elevenlabs)
      setIntegrations({ github: !!data.integrations?.github, discord: !!data.integrations?.discord, googleSearch: !!data.integrations?.googleSearch })
      if (data.integrations?.elevenlabs) setVoiceEngine('elevenlabs')
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

  const addAIMessage = useCallback((text: string, emotion: Emotion, tool: string | null, toolResult: string | null) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', text, emotion, tool, toolResult, ts: Date.now() }])
  }, [])

  const addUserMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text, ts: Date.now() }])
  }, [])

  // ── ElevenLabs TTS ────────────────────────────────────────────────────────

  const speakElevenLabs = useCallback(async (text: string) => {
    try {
      const res = await fetch('/api/jarvis/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'adam' }),
      })
      if (!res.ok) throw new Error('non-ok')
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        // Fallback signal from server
        return false
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      setMode('speaking')
      audio.onended = () => { setMode('idle'); URL.revokeObjectURL(url) }
      audio.onerror = () => { setMode('idle'); URL.revokeObjectURL(url) }
      await audio.play()
      return true
    } catch {
      return false
    }
  }, [])

  // ── Browser TTS ───────────────────────────────────────────────────────────

  const speakBrowser = useCallback((text: string) => {
    window.speechSynthesis?.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    const voices = voicesRef.current
    // Prefer British/deep male voices for JARVIS feel
    const preferred =
      voices.find(v => v.name === 'Daniel') ||        // macOS British male
      voices.find(v => v.name === 'Alex') ||           // macOS male
      voices.find(v => v.name === 'Google UK Male') ||
      voices.find(v => v.lang === 'en-GB' && !v.name.toLowerCase().includes('female')) ||
      voices.find(v => v.name === 'Samantha') ||
      voices.find(v => v.lang.startsWith('en') && v.localService) ||
      voices[0]
    if (preferred) utt.voice = preferred
    utt.rate  = 0.95
    utt.pitch = 0.85  // Lower pitch = more JARVIS-like
    utt.volume = 1.0
    utt.onstart = () => setMode('speaking')
    utt.onend   = () => setMode('idle')
    utt.onerror = () => setMode('idle')
    window.speechSynthesis?.speak(utt)
  }, [])

  const speak = useCallback(async (text: string) => {
    if (voiceEngine === 'elevenlabs' && hasElevenLabs) {
      const ok = await speakElevenLabs(text)
      if (!ok) speakBrowser(text)
    } else {
      speakBrowser(text)
    }
  }, [voiceEngine, hasElevenLabs, speakElevenLabs, speakBrowser])

  // ── Send to G.F.A.I. ─────────────────────────────────────────────────────

  const sendToJarvis = useCallback(async (text: string) => {
    if (!text.trim()) return
    addUserMessage(text)
    setMode('thinking')
    setLastToolUsed(null)

    // Extract name
    const nameMatch = text.match(/my name is (\w+)/i)
    if (nameMatch) {
      const name = nameMatch[1]
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
        }),
      })
      const data = await res.json() as {
        speech: string; tool: string | null; toolResult: string | null
        emotion: Emotion; activeModel?: string; activeProvider?: string
      }
      const { speech, tool, toolResult, emotion } = data

      if (tool) setLastToolUsed(tool)
      if (data.activeModel) setResponseModel(`${data.activeProvider || ''}/${data.activeModel}`)
      addAIMessage(speech, emotion || 'neutral', tool, toolResult)
      await speak(speech)

      // Update conversation count
      fetch('/api/jarvis/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationCount: (memory.conversationCount || 0) + 1 }),
      }).catch(() => {})
    } catch (e) {
      const err = 'Systems error. Please try again.'
      addAIMessage(err, 'alert', null, null)
      await speak(err)
      setMode('idle')
      console.error(e)
    }
  }, [messages, memory, selectedProvider, selectedModel, addUserMessage, addAIMessage, speak])

  // ── Voice recognition ─────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    const SR = getSR()
    if (!SR) return
    window.speechSynthesis?.cancel()
    setMode('listening')

    const rec = new SR()
    rec.lang = 'en-US'
    rec.continuous = false
    rec.interimResults = false
    recognitionRef.current = rec

    rec.onresult = (e: Any) => {
      const transcript = e.results[0][0].transcript
      setInput('')
      void sendToJarvis(transcript)
    }
    rec.onerror = () => setMode('idle')
    rec.onend   = () => { if (modeRef.current === 'listening') setMode('idle') }
    rec.start()
  }, [sendToJarvis])

  // ── Wake word ─────────────────────────────────────────────────────────────

  const toggleWakeWord = useCallback(() => {
    const SR = getSR()
    if (!SR) return

    if (wakeWordActiveRef.current) {
      wakeRecognitionRef.current?.stop()
      setWakeWordActive(false)
      return
    }

    setWakeWordActive(true)

    const startWake = () => {
      const rec = new SR()
      rec.lang = 'en-US'
      rec.continuous = true
      rec.interimResults = true
      wakeRecognitionRef.current = rec

      rec.onresult = (e: Any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transcript = Array.from(e.results as any[])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((r: any) => r[0].transcript).join(' ').toLowerCase()
        if (transcript.includes('hey ghostforge') || transcript.includes('ghost forge') || transcript.includes('hey forge')) {
          rec.stop()
          void speak("Yes? I'm listening.")
          setTimeout(startListening, 800)
        }
      }
      rec.onend = () => {
        // Use ref (not closure-captured state) to decide whether to restart
        if (wakeWordActiveRef.current) setTimeout(startWake, 300)
      }
      rec.onerror = () => {
        if (wakeWordActiveRef.current) setTimeout(startWake, 500)
      }
      try { rec.start() } catch { /* ignore if already started */ }
    }

    startWake()
  }, [speak, startListening])

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
            <button type="button" onClick={() => setShowSettings(s => !s)}
              className="font-mono text-[10px] rounded px-2 py-1 border transition"
              style={{ borderColor: `${mc.ring}44`, color: `${mc.ring}99`, background: showSettings ? `${mc.ring}18` : 'transparent' }}>
              ⚙ SETTINGS
            </button>
            <Clock />
          </div>
        </div>

        {/* ── Settings panel (collapsible) ── */}
        {showSettings && (
          <div className="relative z-20 border-b px-4 py-3 gfai-fade"
            style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,25,0.97)' }}>
            <div className="flex flex-wrap gap-6 font-mono text-[10px]">

              {/* Model selector */}
              <div>
                <p className="text-blue-400/40 tracking-widest mb-1.5">AI MODEL</p>
                <div className="flex flex-wrap gap-1.5 max-w-sm">
                  <button type="button"
                    onClick={() => { setSelectedProvider(''); setSelectedModel('') }}
                    className="rounded px-2 py-1 border transition"
                    style={{
                      borderColor: !selectedProvider ? mc.ring : `${mc.ring}33`,
                      color: !selectedProvider ? mc.ring : 'rgba(150,170,220,0.5)',
                      background: !selectedProvider ? `${mc.ring}18` : 'transparent',
                    }}>
                    AUTO (ENV)
                  </button>
                  {models.filter(m => m.available).map(m => (
                    <button type="button" key={`${m.provider}/${m.id}`}
                      onClick={() => { setSelectedProvider(m.provider); setSelectedModel(m.id) }}
                      className="rounded px-2 py-1 border transition"
                      style={{
                        borderColor: (selectedProvider === m.provider && selectedModel === m.id) ? mc.ring : `${mc.ring}33`,
                        color: (selectedProvider === m.provider && selectedModel === m.id) ? mc.ring : 'rgba(150,170,220,0.5)',
                        background: (selectedProvider === m.provider && selectedModel === m.id) ? `${mc.ring}18` : 'transparent',
                      }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice selector */}
              <div>
                <p className="text-blue-400/40 tracking-widest mb-1.5">VOICE ENGINE</p>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setVoiceEngine('browser')}
                    className="rounded px-2 py-1 border transition"
                    style={{
                      borderColor: voiceEngine === 'browser' ? mc.ring : `${mc.ring}33`,
                      color: voiceEngine === 'browser' ? mc.ring : 'rgba(150,170,220,0.5)',
                      background: voiceEngine === 'browser' ? `${mc.ring}18` : 'transparent',
                    }}>
                    BROWSER TTS
                  </button>
                  <button type="button"
                    disabled={!hasElevenLabs}
                    onClick={() => setVoiceEngine('elevenlabs')}
                    className="rounded px-2 py-1 border transition disabled:opacity-30"
                    style={{
                      borderColor: voiceEngine === 'elevenlabs' ? '#ff9922' : `${mc.ring}33`,
                      color: voiceEngine === 'elevenlabs' ? '#ff9922' : 'rgba(150,170,220,0.5)',
                      background: voiceEngine === 'elevenlabs' ? 'rgba(255,153,34,0.1)' : 'transparent',
                    }}
                    title={!hasElevenLabs ? 'Add ELEVENLABS_API_KEY to .env.local' : 'ElevenLabs Adam voice (JARVIS-like)'}>
                    ⚡ ELEVENLABS {!hasElevenLabs && '(NO KEY)'}
                  </button>
                </div>
              </div>

              {/* Integrations status */}
              <div>
                <p className="text-blue-400/40 tracking-widest mb-1.5">INTEGRATIONS</p>
                <div className="flex flex-col gap-1">
                  {[
                    { label: 'GitHub', ok: integrations.github, hint: 'Set GITHUB_TOKEN' },
                    { label: 'Discord', ok: integrations.discord, hint: 'Set DISCORD_WEBHOOK_URL' },
                    { label: 'Google Search', ok: integrations.googleSearch, hint: 'Set GOOGLE_SEARCH_API_KEY + CX' },
                    { label: 'ElevenLabs TTS', ok: hasElevenLabs, hint: 'Set ELEVENLABS_API_KEY' },
                  ].map(i => (
                    <div key={i.label} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: i.ok ? '#00ff88' : '#ff4444' }} />
                      <span style={{ color: i.ok ? '#00ff88' : 'rgba(255,100,100,0.6)' }}>{i.label}</span>
                      {!i.ok && <span className="text-blue-400/30">— {i.hint}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Main body ── */}
        <div className="relative z-10 flex flex-1 overflow-hidden">

          {/* ── Left panel ── */}
          <div className="hidden md:flex w-44 shrink-0 flex-col gap-3 border-r p-3 font-mono text-[10px]"
            style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.6)' }}>
            <div>
              <p className="text-blue-400/40 tracking-widest mb-2">SYSTEMS</p>
              {[
                { label: 'AI ENGINE', val: responseModel ? responseModel.split('/').pop()?.slice(0, 14) || 'ONLINE' : 'ONLINE', ok: true },
                { label: 'MAC CTRL', val: 'READY', ok: true },
                { label: 'MEMORY', val: memory.conversationCount > 0 ? `${memory.conversationCount} SES` : 'INIT', ok: true },
                { label: 'VOICE', val: voiceEngine === 'elevenlabs' ? 'ELEVENLABS' : voiceSupported ? 'BROWSER' : 'N/A', ok: voiceSupported },
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
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-[10px] opacity-60" style={{ color: borderColor }}>
                        {m.role === 'user' ? 'YOU' : 'G.F.A.I.'}
                      </span>
                      {m.tool && (
                        <span className="font-mono text-[9px] rounded px-1 py-0.5"
                          style={{ background: `${mc.ring}22`, color: mc.ring }}>
                          {m.tool.replace(/_/g, ' ')}
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
          <span style={{ color: responseModel ? mc.ring : `${mc.ring}44` }}>
            {responseModel ? `⚡ ${responseModel}` : (activeModel ? `${activeModel.provider}/${activeModel.model}` : 'AI ENGINE STANDBY')}
          </span>
          <span>PRIVATE · LOCAL · SECURE</span>
        </div>
      </div>
    </>
  )
}
