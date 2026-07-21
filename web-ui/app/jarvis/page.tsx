'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

// Web Speech API type shims (not in all TS lib.dom versions)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getSR = (): (new () => AnySpeechRecognition) | null => {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}
// ── Types ──────────────────────────────────────────────────────────────────────

type Mode = 'idle' | 'listening' | 'thinking' | 'speaking'
type Emotion = 'neutral' | 'happy' | 'thinking' | 'alert' | 'processing' | 'done'

interface Message {
  id: string
  role: 'user' | 'ai'
  text: string
  tool?: string | null
  emotion?: Emotion
  ts: number
}

interface Memory {
  userName: string
  preferences: { city: string; music: string }
  facts: string[]
  conversationCount: number
}

// ── Orb colors per mode ───────────────────────────────────────────────────────

const MODE_COLORS: Record<Mode, { ring: string; glow: string; dot: string }> = {
  idle:      { ring: '#1a6fff', glow: 'rgba(26,111,255,0.25)', dot: '#1a6fff' },
  listening: { ring: '#00ff88', glow: 'rgba(0,255,136,0.30)', dot: '#00ff88' },
  thinking:  { ring: '#ffaa00', glow: 'rgba(255,170,0,0.28)',  dot: '#ffaa00' },
  speaking:  { ring: '#aa44ff', glow: 'rgba(170,68,255,0.28)', dot: '#aa44ff' },
}

const GREETINGS = [
  'GhostForge AI online. All systems nominal.',
  'Good to see you again. Systems fully operational.',
  "I'm online. How can I assist you today?",
  'GhostForge AI initialized. Ready for your command.',
]

// ── Animated Orb SVG ─────────────────────────────────────────────────────────

function OrbSVG({ mode }: { mode: Mode }) {
  const c = MODE_COLORS[mode]
  const isThinking = mode === 'thinking'
  const isListening = mode === 'listening'

  return (
    <svg width="240" height="240" viewBox="0 0 240 240" className="select-none">
      {/* Outer rotating arc (thinking only) */}
      {isThinking && (
        <circle cx="120" cy="120" r="112" fill="none" stroke={c.ring} strokeWidth="1.5"
          strokeDasharray="60 300" strokeLinecap="round" opacity="0.7">
          <animateTransform attributeName="transform" type="rotate"
            from="0 120 120" to="360 120 120" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Outer ring */}
      <circle cx="120" cy="120" r="108" fill="none" stroke={c.ring} strokeWidth="0.8" opacity="0.3">
        {isListening && (
          <animate attributeName="r" values="108;116;108" dur="0.8s" repeatCount="indefinite" />
        )}
      </circle>

      {/* Middle ring */}
      <circle cx="120" cy="120" r="90" fill="none" stroke={c.ring} strokeWidth="1" opacity="0.45">
        {isListening && (
          <animate attributeName="r" values="90;96;90" dur="0.7s" repeatCount="indefinite" />
        )}
      </circle>

      {/* Counter-rotating arc */}
      <circle cx="120" cy="120" r="78" fill="none" stroke={c.ring} strokeWidth="1.2"
        strokeDasharray="30 180" strokeLinecap="round" opacity="0.5">
        <animateTransform attributeName="transform" type="rotate"
          from="0 120 120" to={isThinking ? '-360 120 120' : '360 120 120'}
          dur={isThinking ? '2s' : '8s'} repeatCount="indefinite" />
      </circle>

      {/* Inner glow fill */}
      <circle cx="120" cy="120" r="64" fill={c.glow}>
        <animate attributeName="opacity"
          values={mode === 'idle' ? '0.6;0.9;0.6' : mode === 'listening' ? '0.8;1;0.8' : '1;0.8;1'}
          dur={mode === 'idle' ? '3s' : '0.6s'} repeatCount="indefinite" />
      </circle>

      {/* Inner ring */}
      <circle cx="120" cy="120" r="64" fill="none" stroke={c.ring} strokeWidth="1.5" opacity="0.7" />

      {/* Core circle */}
      <circle cx="120" cy="120" r="44" fill="#050510" />
      <circle cx="120" cy="120" r="44" fill="none" stroke={c.ring} strokeWidth="2" opacity="0.8">
        <animate attributeName="stroke-width"
          values={mode === 'speaking' ? '2;3;2' : '2;2;2'} dur="0.4s" repeatCount="indefinite" />
      </circle>

      {/* Center emblem: GF */}
      <text x="120" y="115" textAnchor="middle" dominantBaseline="middle"
        fontSize="11" fontFamily="monospace" fontWeight="bold" fill={c.ring} opacity="0.9" letterSpacing="2">
        G.F.A.I
      </text>
      <text x="120" y="130" textAnchor="middle" dominantBaseline="middle"
        fontSize="7" fontFamily="monospace" fill={c.ring} opacity="0.6" letterSpacing="1">
        {mode.toUpperCase()}
      </text>

      {/* Speaking waveform bars */}
      {mode === 'speaking' && [-3, -1.5, 0, 1.5, 3].map((offset, i) => (
        <rect key={i} x={120 + offset * 6 - 2} y="108" width="3" rx="1.5"
          fill={c.ring} opacity="0.8">
          <animate attributeName="height" values={`${4 + i * 3};${14 + i * 2};${4 + i * 3}`}
            dur={`${0.3 + i * 0.08}s`} repeatCount="indefinite" />
          <animate attributeName="y" values={`${120 - 2 - i};${120 - 7 - i};${120 - 2 - i}`}
            dur={`${0.3 + i * 0.08}s`} repeatCount="indefinite" />
        </rect>
      ))}

      {/* Listening mic indicator */}
      {mode === 'listening' && (
        <circle cx="120" cy="120" r="20" fill="none" stroke={c.ring} strokeWidth="1" opacity="0.5">
          <animate attributeName="r" values="20;36;20" dur="1s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="1s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  )
}

// ── Clock component ───────────────────────────────────────────────────────────

function Clock() {
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
      setDate(now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="text-right font-mono">
      <div className="text-2xl font-bold text-blue-300 tracking-widest">{time}</div>
      <div className="text-[10px] text-blue-400/60 tracking-widest uppercase">{date}</div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function JarvisPage() {
  const [mode, setMode] = useState<Mode>('idle')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [memory, setMemory] = useState<Memory>({ userName: '', preferences: { city: 'Riyadh', music: 'spotify' }, facts: [], conversationCount: 0 })
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [wakeWordActive, setWakeWordActive] = useState(false)
  const [lastToolUsed, setLastToolUsed] = useState<string | null>(null)

  const recognitionRef = useRef<AnySpeechRecognition>(null)
  const wakeRecognitionRef = useRef<AnySpeechRecognition>(null)
  const synthRef = useRef<AnySpeechRecognition>(null)
  const voicesRef = useRef<AnySpeechRecognition[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const SR = getSR()
    setVoiceSupported(!!SR)

    // Load voices
    const loadVoices = () => { voicesRef.current = window.speechSynthesis?.getVoices() ?? [] }
    loadVoices()
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices)

    let greetTimer: ReturnType<typeof setTimeout>

    // Load memory
    fetch('/api/jarvis/memory')
      .then(r => r.json())
      .then((m: Memory) => {
        setMemory(m)
        const name = m.userName || ''
        const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
        const welcome = name
          ? `Welcome back, ${name}. ${greeting}`
          : `GhostForge AI online. ${greeting} You can say "my name is [name]" to personalize your experience.`
        addAIMessage(welcome, 'neutral', null)
        greetTimer = setTimeout(() => speak(welcome), 600)
      })
      .catch(() => {
        const welcome = "GhostForge AI online. All systems operational."
        addAIMessage(welcome, 'neutral', null)
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

  // Scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const addAIMessage = useCallback((text: string, emotion: Emotion, tool: string | null) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', text, emotion, tool, ts: Date.now() }])
  }, [])

  const addUserMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text, ts: Date.now() }])
  }, [])

  // ── TTS ───────────────────────────────────────────────────────────────────

  const speak = useCallback((text: string) => {
    window.speechSynthesis?.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    // Prefer Samantha (macOS) or a natural English voice
    const voices = voicesRef.current
    const preferred =
      voices.find(v => v.name === 'Samantha') ||
      voices.find(v => v.name.includes('Google UK Female')) ||
      voices.find(v => v.lang === 'en-GB') ||
      voices.find(v => v.lang === 'en-US' && v.localService) ||
      voices[0]
    if (preferred) utt.voice = preferred
    utt.rate = 1.05
    utt.pitch = 1.0
    utt.volume = 1.0
    utt.onstart  = () => setMode('speaking')
    utt.onend    = () => setMode('idle')
    utt.onerror  = () => setMode('idle')
    synthRef.current = utt
    window.speechSynthesis?.speak(utt)
  }, [])

  // ── Send message to Jarvis API ────────────────────────────────────────────

  const sendToJarvis = useCallback(async (text: string) => {
    if (!text.trim()) return
    addUserMessage(text)
    setMode('thinking')
    setLastToolUsed(null)

    // Extract name if user introduces themselves
    const nameMatch = text.match(/my name is (\w+)/i)
    if (nameMatch) {
      const name = nameMatch[1]
      setMemory(prev => ({ ...prev, userName: name }))
      await fetch('/api/jarvis/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: name }) })
    }

    try {
      const historySlice = messages.slice(-8).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }))
      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: historySlice, memory }),
      })
      const data = await res.json() as { speech: string; tool: string | null; toolResult: string | null; emotion: Emotion }
      const { speech, tool, emotion } = data

      if (tool) setLastToolUsed(tool)
      addAIMessage(speech, emotion || 'neutral', tool)
      speak(speech)

      // Update conversation count in memory
      await fetch('/api/jarvis/memory/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationCount: (memory.conversationCount || 0) + 1 }) }).catch(() => {})
    } catch (e) {
      const err = 'I encountered a systems error. Please try again.'
      addAIMessage(err, 'alert', null)
      speak(err)
      setMode('idle')
      console.error(e)
    }
  }, [messages, memory, addUserMessage, addAIMessage, speak])

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

    rec.onresult = (e: AnySpeechRecognition) => {
      const transcript = e.results[0][0].transcript
      setInput('')
      void sendToJarvis(transcript)
    }
    rec.onerror = () => setMode('idle')
    rec.onend   = () => { if (mode === 'listening') setMode('idle') }

    rec.start()
  }, [mode, sendToJarvis])

  // Wake word ("hey ghostforge")
  const toggleWakeWord = useCallback(() => {
    const SR = getSR()
    if (!SR) return

    if (wakeWordActive) {
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

      rec.onresult = (e: AnySpeechRecognition) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join(' ').toLowerCase()
        if (transcript.includes('hey ghostforge') || transcript.includes('hey ghost forge')) {
          rec.stop()
          speak("Yes? I'm listening.")
          setTimeout(startListening, 800)
        }
      }
      rec.onend = () => {
        if (wakeWordActive) setTimeout(startWake, 300)
      }
      rec.start()
    }
    startWake()
  }, [wakeWordActive, speak, startListening])

  // ── Handle text submit ────────────────────────────────────────────────────

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

  // ── Mode color ────────────────────────────────────────────────────────────
  const mc = MODE_COLORS[mode]

  return (
    <>
      <style>{`
        @keyframes scanline {
          0%   { transform: translateY(-100%); opacity: 0; }
          10%  { opacity: 0.06; }
          90%  { opacity: 0.06; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        @keyframes hudFadeIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:none; } }
        @keyframes statusBlink { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .gfai-scan { animation: scanline 6s linear infinite; }
        .gfai-fade { animation: hudFadeIn 0.4s ease both; }
        .gfai-blink { animation: statusBlink 2s ease-in-out infinite; }
        .gfai-grid {
          background-image:
            linear-gradient(rgba(26,111,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(26,111,255,0.04) 1px, transparent 1px);
          background-size: 40px 40px;
        }
        .gfai-msg-user { background: rgba(26,111,255,0.12); border-left: 2px solid #1a6fff; }
        .gfai-msg-ai { background: rgba(0,5,20,0.7); border-left: 2px solid; }
        .gfai-input:focus { outline: none; box-shadow: 0 0 0 1px ${mc.ring}66; }
      `}</style>

      <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#000208] text-white gfai-grid">

        {/* Scanline overlay */}
        <div className="pointer-events-none absolute inset-0 z-0 gfai-scan"
          style={{ background: 'linear-gradient(transparent 50%, rgba(26,111,255,0.03) 50%)', backgroundSize: '100% 4px' }} />

        {/* ── Top HUD bar ── */}
        <div className="relative z-10 flex shrink-0 items-center justify-between border-b px-4 py-2"
          style={{ borderColor: `${mc.ring}33`, background: `rgba(0,5,20,0.9)` }}>

          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-xs font-mono text-blue-400/60 hover:text-blue-300 transition">
              ← DASHBOARD
            </Link>
            <span className="text-[10px] text-blue-400/30 font-mono">|</span>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full gfai-blink" style={{ background: mc.ring }} />
              <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: mc.ring }}>
                G.F.A.I. — {mode}
              </span>
            </div>
            {lastToolUsed && (
              <span className="font-mono text-[10px] text-blue-400/50 hidden sm:block">
                Last: {lastToolUsed.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            {memory.userName && (
              <span className="font-mono text-[10px] text-blue-300/60 hidden sm:block">
                USER: {memory.userName.toUpperCase()}
              </span>
            )}
            <Clock />
          </div>
        </div>

        {/* ── Main body ── */}
        <div className="relative z-10 flex flex-1 overflow-hidden">

          {/* ── Left panel: status ── */}
          <div className="hidden md:flex w-48 shrink-0 flex-col gap-3 border-r p-3 font-mono text-[10px]"
            style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.6)' }}>
            <div>
              <p className="text-blue-400/40 tracking-widest mb-2">SYSTEMS</p>
              {[
                { label: 'AI ENGINE', val: 'ONLINE', ok: true },
                { label: 'MAC CTRL', val: 'READY', ok: true },
                { label: 'MEMORY', val: memory.conversationCount > 0 ? `${memory.conversationCount} SESSIONS` : 'INIT', ok: true },
                { label: 'VOICE', val: voiceSupported ? 'ENABLED' : 'N/A', ok: voiceSupported },
                { label: 'WAKE WORD', val: wakeWordActive ? 'ACTIVE' : 'OFF', ok: wakeWordActive },
              ].map(s => (
                <div key={s.label} className="flex justify-between py-0.5">
                  <span className="text-blue-400/50">{s.label}</span>
                  <span style={{ color: s.ok ? mc.ring : '#ff4444' }}>{s.val}</span>
                </div>
              ))}
            </div>

            <div className="border-t pt-3" style={{ borderColor: `${mc.ring}22` }}>
              <p className="text-blue-400/40 tracking-widest mb-2">TOOLS AVAILABLE</p>
              {['TIME', 'WEATHER', 'SEARCH', 'MESSAGES', 'MUSIC', 'REMINDER', 'APPS', 'TERMINAL', 'NOTES'].map(t => (
                <div key={t} className="flex items-center gap-1.5 py-0.5">
                  <span className="h-1 w-1 rounded-full" style={{ background: mc.ring }} />
                  <span className="text-blue-300/50">{t}</span>
                </div>
              ))}
            </div>

            {memory.userName && memory.facts.length > 0 && (
              <div className="border-t pt-3" style={{ borderColor: `${mc.ring}22` }}>
                <p className="text-blue-400/40 tracking-widest mb-2">MEMORY ({memory.facts.length})</p>
                {memory.facts.slice(-3).map((f, i) => (
                  <p key={i} className="text-blue-300/40 leading-relaxed text-[9px]">{f}</p>
                ))}
              </div>
            )}
          </div>

          {/* ── Center: orb + conversation ── */}
          <div className="flex flex-1 flex-col items-center overflow-hidden">

            {/* Conversation messages */}
            <div className="flex-1 w-full max-w-2xl overflow-y-auto px-4 py-3 space-y-2 scrollbar-thin scrollbar-track-transparent"
              style={{ scrollbarColor: `${mc.ring}33 transparent` }}>
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
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Orb */}
            <div className="shrink-0 py-4 flex flex-col items-center gap-3">
              <button type="button"
                onClick={mode === 'speaking' ? stopSpeaking : mode === 'listening' ? () => recognitionRef.current?.stop() : startListening}
                disabled={mode === 'thinking'}
                className="relative cursor-pointer disabled:cursor-wait transition-transform active:scale-95"
                style={{ filter: `drop-shadow(0 0 24px ${mc.glow})` }}
                title={mode === 'idle' ? 'Click to speak' : mode === 'listening' ? 'Listening… (click to stop)' : mode === 'speaking' ? 'Click to stop speaking' : 'Processing…'}
              >
                <OrbSVG mode={mode} />
              </button>

              {/* Voice controls */}
              <div className="flex items-center gap-2">
                {voiceSupported && (
                  <>
                    <button type="button"
                      onClick={startListening}
                      disabled={mode !== 'idle' && mode !== 'speaking'}
                      className="font-mono text-[10px] rounded px-3 py-1.5 border transition disabled:opacity-30"
                      style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}11` }}
                    >
                      🎤 SPEAK
                    </button>
                    <button type="button"
                      onClick={toggleWakeWord}
                      className="font-mono text-[10px] rounded px-3 py-1.5 border transition"
                      style={{
                        borderColor: wakeWordActive ? '#00ff88' : `${mc.ring}44`,
                        color: wakeWordActive ? '#00ff88' : `${mc.ring}88`,
                        background: wakeWordActive ? 'rgba(0,255,136,0.08)' : 'transparent',
                      }}
                      title='Say "Hey GhostForge" to activate'
                    >
                      {wakeWordActive ? '🔊 WAKE WORD ON' : '😴 WAKE WORD OFF'}
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

            {/* Text input */}
            <form onSubmit={handleSubmit} className="shrink-0 w-full max-w-2xl px-4 pb-4 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={
                  mode === 'listening' ? 'Listening…'
                  : mode === 'thinking' ? 'Processing your request…'
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
                style={{ borderColor: mc.ring, color: mc.ring, background: `${mc.ring}18` }}
              >
                SEND
              </button>
            </form>
          </div>

          {/* ── Right panel: quick commands ── */}
          <div className="hidden lg:flex w-48 shrink-0 flex-col gap-2 border-l p-3"
            style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.6)' }}>
            <p className="font-mono text-[10px] text-blue-400/40 tracking-widest mb-1">QUICK COMMANDS</p>
            {[
              { label: '⏰ Time', cmd: "What's the time?" },
              { label: '🌤 Weather', cmd: 'How\'s the weather?' },
              { label: '🔍 Search', cmd: 'Search for latest AI news' },
              { label: '💬 Message', cmd: 'Send iMessage to Rawzi saying hello' },
              { label: '🎵 Music', cmd: 'Play music on Spotify' },
              { label: '📸 Screenshot', cmd: 'Take a screenshot' },
              { label: '🔒 Lock', cmd: 'Lock the screen' },
              { label: '🔔 Remind me', cmd: 'Remind me to check email' },
              { label: '💻 Sysinfo', cmd: 'System status report' },
              { label: '📝 Note', cmd: 'Note: remember to review PR tomorrow' },
            ].map(q => (
              <button type="button"
                key={q.label}
                onClick={() => { void sendToJarvis(q.cmd) }}
                disabled={mode === 'thinking' || mode === 'listening'}
                className="w-full text-left rounded px-2 py-1.5 font-mono text-[10px] border transition disabled:opacity-30 hover:border-blue-600/60"
                style={{ borderColor: `${mc.ring}22`, color: 'rgba(200,210,255,0.7)', background: `${mc.ring}08` }}
              >
                {q.label}
              </button>
            ))}

            <div className="mt-auto border-t pt-2" style={{ borderColor: `${mc.ring}22` }}>
              <p className="font-mono text-[9px] text-blue-400/30 leading-relaxed">
                Say "Hey GhostForge" to activate wake word. Click the orb to speak.
              </p>
            </div>
          </div>
        </div>

        {/* ── Bottom HUD bar ── */}
        <div className="relative z-10 flex shrink-0 items-center justify-between border-t px-4 py-1.5 font-mono text-[9px]"
          style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.9)', color: `${mc.ring}66` }}>
          <span>G.F.A.I. v4.6 — GHOSTFORGE AI SYSTEM</span>
          <span>OPENJARVIS.STANFORD.EDU INSPIRED</span>
          <span>PRIVATE · LOCAL · SECURE</span>
        </div>
      </div>
    </>
  )
}
