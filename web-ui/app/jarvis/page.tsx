'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import CollabShare from '@/components/CollabShare'
import LLMfitAutoSwitch from '@/components/LLMfitAutoSwitch'
import ClickyOverlay from '@/components/ClickyOverlay'
import { usePlatform, detectLanguage, getSpeechLang, platformLabel } from '@/lib/platform'

const MarkLPanel = dynamic(() => import('@/components/MarkLPanel'), { ssr: false })
const OpenJarvisPanel = dynamic(() => import('@/components/OpenJarvisPanel'), { ssr: false })
const AgentDashboard = dynamic(() => import('@/components/AgentDashboard'), { ssr: false })
import { collectRecognitionTranscript, findWakePhrase } from '@/lib/voice-runtime'
import { JARVIS_QUICK_ACTIONS } from '@/lib/quick-actions'
import { MARK_LIV_ACTIONS } from '@/lib/mark-liv-actions'

// Web Speech API type shims
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const getSR = (): (new () => Any) | null => {
  if (typeof window === 'undefined') return null
   
  const w = window as Any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

// ── Types ──────────────────────────────────────────────────────────────────────

type Mode = 'idle' | 'listening' | 'thinking' | 'speaking'
type Emotion = 'neutral' | 'happy' | 'thinking' | 'alert' | 'processing' | 'done'
type VoiceEngine = 'browser' | 'elevenlabs' | 'fish-audio'

interface HostCapabilities {
  platform: string
  macControl: boolean
  screenCapture: boolean
  browserControl: boolean
  shell: boolean
  remoteClientControl: boolean
  freeLocalAI: boolean
}

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

interface HistoryPayloadMessage {
  role: 'user' | 'ai'
  content: string
  ts: number
}

interface HistoryPayloadSession {
  id: string
  startedAt: string
  endedAt: string
  messages: HistoryPayloadMessage[]
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

interface ClipboardPanelState {
  text: string
  visible: boolean
}

interface MorningBriefingResponse {
  greeting: string
  weather: string
  news: string[]
  time: string
  advice: string
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

const PERSONA_OPTIONS = [
  { id: 'default', label: '🤖 Default', desc: 'Standard JARVIS', badge: 'DEFAULT' },
  { id: 'dev', label: '👨‍💻 Dev', desc: 'Senior engineer', badge: 'DEV' },
  { id: 'manager', label: '📋 Manager', desc: 'Tech lead', badge: 'MANAGER' },
  { id: 'creative', label: '🎨 Creative', desc: 'Brainstorm mode', badge: 'CREATIVE' },
  { id: 'security', label: '🔒 Security', desc: 'Security focus', badge: 'SECURITY' },
] as const

// ── Orb SVG ───────────────────────────────────────────────────────────────────

function OrbSVG({ mode, audioLevel = 0 }: { mode: Mode; audioLevel?: number }) {
  const c = MODE_COLORS[mode]
  const isThinking = mode === 'thinking'
  const isListening = mode === 'listening'
  // Audio-reactive scaling: idle pulses gently, listening pulses with mic level
  const listenScale = isListening ? 1 + audioLevel * 0.4 : 1
  return (
    <svg width="220" height="220" viewBox="0 0 240 240" className="select-none">
      {isThinking && (
        <circle cx="120" cy="120" r="112" fill="none" stroke={c.ring} strokeWidth="1.5"
          strokeDasharray="60 300" strokeLinecap="round" opacity="0.7">
          <animateTransform attributeName="transform" type="rotate"
            from="0 120 120" to="360 120 120" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx="120" cy="120" r="108" fill="none" stroke={c.ring} strokeWidth="0.8" opacity="0.3"
        style={isListening ? { transform: `scale(${listenScale})`, transformOrigin: '120px 120px', transition: 'transform 0.08s ease-out' } : undefined}>
      </circle>
      <circle cx="120" cy="120" r="90" fill="none" stroke={c.ring} strokeWidth="1" opacity="0.45"
        style={isListening ? { transform: `scale(${listenScale * 1.05})`, transformOrigin: '120px 120px', transition: 'transform 0.08s ease-out' } : undefined}>
      </circle>
      <circle cx="120" cy="120" r="78" fill="none" stroke={c.ring} strokeWidth="1.2"
        strokeDasharray="30 180" strokeLinecap="round" opacity="0.5">
        <animateTransform attributeName="transform" type="rotate"
          from="0 120 120" to={isThinking ? '-360 120 120' : '360 120 120'}
          dur={isThinking ? '2s' : '8s'} repeatCount="indefinite" />
      </circle>
      <circle cx="120" cy="120" r="64" fill={c.glow}
        style={isListening ? { opacity: 0.6 + audioLevel * 0.4, transition: 'opacity 0.08s ease-out' } : undefined}>
        {!isListening && <animate attributeName="opacity"
          values={mode === 'idle' ? '0.6;0.9;0.6' : '1;0.8;1'}
          dur={mode === 'idle' ? '3s' : '0.6s'} repeatCount="indefinite" />}
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
    <div className="text-end font-mono">
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
            className="shrink-0 ms-1 opacity-40 hover:opacity-100 transition">✕</button>
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
                <th className="px-3 py-1 text-start">TIME</th>
                <th className="px-3 py-1 text-start">LEVEL</th>
                <th className="px-3 py-1 text-start">EVENT</th>
                <th className="px-3 py-1 text-start">TOOL</th>
                <th className="px-3 py-1 text-start">RISK</th>
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
  const [status, setStatus] = useState<'idle' | 'recording' | 'uploading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [enrolled, setEnrolled] = useState(false)
  const [reEnrollMode, setReEnrollMode] = useState(false)
  const [savedIdentity, setSavedIdentity] = useState<{ name: string; dob: string } | null>(null)
  const [enrollName, setEnrollName] = useState('')
  const [enrollDob, setEnrollDob] = useState('')
  const [enrollKeyword, setEnrollKeyword] = useState('')
  const [audioBase64, setAudioBase64] = useState('')
  const [verifyName, setVerifyName] = useState('')
  const [verifyDob, setVerifyDob] = useState('')
  const [verifyKeyword, setVerifyKeyword] = useState('')
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'checking' | 'pass' | 'fail'>('idle')
  const [verifyMessage, setVerifyMessage] = useState('')
  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const isEnrolled = localStorage.getItem('gf_enrolled') === 'true'
    const rawIdentity = localStorage.getItem('gf_identity')
    let identity: { name: string; dob: string } | null = null

    if (rawIdentity) {
      try {
        const parsed = JSON.parse(rawIdentity) as { name?: string; dob?: string }
        identity = { name: parsed.name || '', dob: parsed.dob || '' }
      } catch {
        identity = null
      }
    }

    setEnrolled(isEnrolled)
    setSavedIdentity(identity)
    setEnrollName(identity?.name || '')
    setEnrollDob(identity?.dob || '')
    setVerifyName(identity?.name || '')
    setVerifyDob(identity?.dob || '')

    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
      if (mediaRef.current?.state === 'recording') mediaRef.current.stop()
      streamRef.current?.getTracks().forEach(track => track.stop())
    }
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }, [])

  const showEnrollForm = !enrolled || reEnrollMode
  const canRecord = Boolean(enrollName.trim() && enrollDob.trim() && enrollKeyword.trim())
  const canEnroll = Boolean(canRecord && audioBase64 && status !== 'uploading' && status !== 'recording')

  const startEnroll = async () => {
    try {
      setAudioBase64('')
      setMessage('')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' })
      mediaRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
        stopStream()
        if (!chunksRef.current.length) {
          setStatus('error')
          setMessage('No audio captured — please try again.')
          return
        }

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => {
              const result = typeof reader.result === 'string' ? reader.result.split(',')[1] || '' : ''
              resolve(result)
            }
            reader.onerror = () => reject(new Error('Failed to read audio sample'))
            reader.readAsDataURL(blob)
          })
          setAudioBase64(base64)
          setStatus('idle')
          setMessage('Voice sample recorded. Ready to enroll.')
        } catch (error) {
          setStatus('error')
          setMessage((error as Error).message || 'Failed to prepare audio sample.')
        }
      }
      rec.start(1000)
      setStatus('recording')
      setMessage('Speak naturally — say your name and a phrase.')
      stopTimerRef.current = setTimeout(() => {
        if (mediaRef.current?.state === 'recording') mediaRef.current.stop()
      }, 8_000)
    } catch (e) {
      setStatus('error')
      const msg = (e as Error).message || ''
      setMessage(msg.includes('NotAllowed') || msg.includes('Permission') ? 'Microphone access denied — allow in browser settings' : `Recording error: ${msg}`)
    }
  }

  const stopEarly = () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    if (mediaRef.current?.state === 'recording') mediaRef.current.stop()
  }

  const submitEnroll = async () => {
    if (!canEnroll) return

    setStatus('uploading')
    setMessage('Saving voice profile…')
    try {
      const res = await fetch('/api/jarvis/biometrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'enroll-voice',
          audio: audioBase64,
          name: enrollName.trim(),
          dob: enrollDob.trim(),
          keyword: enrollKeyword.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string; message?: string }
        setStatus('error')
        setMessage(data.error || data.message || 'Enrollment failed — try again.')
        return
      }
      const data = await res.json() as { success?: boolean; error?: string; message?: string }
      if (!data.success) {
        setStatus('error')
        setMessage(data.error || data.message || 'Enrollment failed — try again.')
        return
      }

      const identity = { name: enrollName.trim(), dob: enrollDob.trim() }
      if (typeof window !== 'undefined') {
        localStorage.setItem('gf_enrolled', 'true')
        localStorage.setItem('gf_identity', JSON.stringify(identity))
      }
      setSavedIdentity(identity)
      setEnrolled(true)
      setReEnrollMode(false)
      setVerifyName(identity.name)
      setVerifyDob(identity.dob)
      setStatus('done')
      setMessage('✓ Voice profile saved. JARVIS knows who you are.')
    } catch {
      setStatus('error')
      setMessage('Enrollment failed — check connection and try again.')
    }
  }

  const submitVerify = async () => {
    if (!verifyName.trim() || !verifyDob.trim() || !verifyKeyword.trim()) return

    setVerifyStatus('checking')
    setVerifyMessage('Verifying identity…')
    try {
      const res = await fetch('/api/jarvis/biometrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'identity-challenge',
          name: verifyName.trim(),
          dob: verifyDob.trim(),
          keyword: verifyKeyword.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string; error?: string }
        setVerifyStatus('fail')
        setVerifyMessage(data.message || data.error || 'Identity verification failed.')
        return
      }
      const data = await res.json() as { verified?: boolean; message?: string; error?: string }
      const verified = Boolean(res.ok && data.verified)
      setVerifyStatus(verified ? 'pass' : 'fail')
      setVerifyMessage(data.message || data.error || (verified ? '✓ Identity verified.' : 'Identity verification failed.'))
    } catch {
      setVerifyStatus('fail')
      setVerifyMessage('Identity verification failed — try again.')
    }
  }

  return (
    <div className="min-w-[220px]">
      <p className="text-blue-400/40 tracking-widest mb-1.5">VOICE BIOMETRICS</p>
      <p className="text-[9px] text-blue-400/30 mb-2 leading-relaxed">
        Enroll your voice so JARVIS can verify your identity and lock out imposters.
      </p>

      <div className="space-y-3">
        <div className="rounded border p-2" style={{ borderColor: `${mc.ring}33`, background: 'rgba(0,0,0,0.18)' }}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] tracking-widest text-blue-400/45">VOICE ENROLLMENT</p>
            {enrolled && !reEnrollMode && (
              <div className="flex items-center gap-2 text-[9px]">
                <span style={{ color: '#00ff88' }}>✓ Enrolled as {savedIdentity?.name || 'saved profile'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setReEnrollMode(true)
                    setStatus('idle')
                    setMessage('')
                    setAudioBase64('')
                  }}
                  className="underline underline-offset-2 transition"
                  style={{ color: `${mc.ring}bb` }}>
                  Re-enroll
                </button>
              </div>
            )}
          </div>

          {showEnrollForm && (
            <div className="space-y-2">
              <div className="grid gap-1.5">
                <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
                  <span>Full name</span>
                  <input
                    type="text"
                    value={enrollName}
                    onChange={e => setEnrollName(e.target.value)}
                    placeholder="Full name"
                    className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                    style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
                  />
                </label>
                <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
                  <span>Date of birth</span>
                  <input
                    type="text"
                    value={enrollDob}
                    onChange={e => setEnrollDob(e.target.value)}
                    placeholder="March 2 2001"
                    className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                    style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
                  />
                </label>
                <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
                  <span>Personal keyword / phrase</span>
                  <input
                    type="text"
                    value={enrollKeyword}
                    onChange={e => setEnrollKeyword(e.target.value)}
                    placeholder="e.g. ghostforge"
                    className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                    style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {canRecord ? (
                  status === 'recording' ? (
                    <>
                      <button
                        type="button"
                        onClick={stopEarly}
                        className="rounded px-2 py-1 border transition text-[10px] animate-pulse"
                        style={{ borderColor: '#ff4444', color: '#ff4444', background: 'rgba(255,68,68,0.1)' }}>
                        ⏹ STOP RECORDING
                      </button>
                      <span className="text-[9px] text-red-400/60 animate-pulse">● REC</span>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void startEnroll()}
                      disabled={status === 'uploading'}
                      className="rounded px-2 py-1 border transition text-[10px] disabled:opacity-40"
                      style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}12` }}>
                      🎙 RECORD VOICE
                    </button>
                  )
                ) : (
                  <span className="text-[9px] text-blue-400/30">Fill out all fields to unlock voice recording.</span>
                )}

                <button
                  type="button"
                  onClick={() => void submitEnroll()}
                  disabled={!canEnroll}
                  className="rounded px-2 py-1 border transition text-[10px] disabled:opacity-40"
                  style={{ borderColor: `${mc.ring}66`, color: canEnroll ? mc.ring : `${mc.ring}88`, background: `${mc.ring}12` }}>
                  {status === 'uploading' ? 'ENROLLING…' : 'ENROLL'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded border p-2" style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,0,0,0.14)' }}>
          <p className="mb-2 text-[10px] tracking-widest text-blue-400/45">ID VERIFY</p>
          <div className="grid gap-1.5">
            <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
              <span>Full name</span>
              <input
                type="text"
                value={verifyName}
                onChange={e => setVerifyName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
              />
            </label>
            <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
              <span>Date of birth</span>
              <input
                type="text"
                value={verifyDob}
                onChange={e => setVerifyDob(e.target.value)}
                placeholder="March 2 2001"
                className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
              />
            </label>
            <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
              <span>Security phrase</span>
              <input
                type="text"
                value={verifyKeyword}
                onChange={e => setVerifyKeyword(e.target.value)}
                placeholder="e.g. ghostforge"
                className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
              />
            </label>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void submitVerify()}
              disabled={!verifyName.trim() || !verifyDob.trim() || !verifyKeyword.trim() || verifyStatus === 'checking'}
              className="rounded px-2 py-1 border transition text-[10px] disabled:opacity-40"
              style={{ borderColor: `${mc.ring}44`, color: mc.ring, background: 'transparent' }}>
              {verifyStatus === 'checking' ? 'VERIFYING…' : 'VERIFY IDENTITY'}
            </button>
          </div>
        </div>
      </div>

      {message && (
        <p className="mt-1 text-[9px] leading-relaxed" style={{ color: status === 'done' ? '#00ff88' : status === 'error' ? '#ff6666' : `${mc.ring}99` }}>
          {message}
        </p>
      )}
      {verifyMessage && (
        <p className="mt-1 text-[9px] leading-relaxed" style={{ color: verifyStatus === 'pass' ? '#00ff88' : verifyStatus === 'fail' ? '#ff6666' : `${mc.ring}99` }}>
          {verifyMessage}
        </p>
      )}
    </div>
  )
}

function metricColor(percent: number) {
  if (percent >= 80) return '#ff5c5c'
  if (percent >= 60) return '#ffb347'
  return '#00ff88'
}

function ClipboardPanel({ text, onAction, onClose }: { text: string; onAction: (action: 'EXPLAIN' | 'SUMMARISE' | 'TRANSLATE' | 'FIX') => void; onClose: () => void }) {
  const actions: Array<{ label: 'EXPLAIN' | 'SUMMARISE' | 'TRANSLATE' | 'FIX'; icon: string }> = [
    { label: 'EXPLAIN', icon: '📋' },
    { label: 'SUMMARISE', icon: '📝' },
    { label: 'TRANSLATE', icon: '🔄' },
    { label: 'FIX', icon: '🐛' },
  ]

  return (
    <div className="gfai-fade fixed top-20 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border p-3 shadow-2xl"
      style={{ borderColor: 'rgba(34,211,238,0.65)', background: 'rgba(2,12,22,0.96)', boxShadow: '0 0 28px rgba(34,211,238,0.12)' }}>
      <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[10px]">
        <span className="tracking-[0.24em] text-cyan-300/80">CLIPBOARD INTELLIGENCE</span>
        <button type="button" onClick={onClose} className="text-cyan-300/50 transition hover:text-cyan-200">✕</button>
      </div>
      <p className="mb-3 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-cyan-400/10 bg-black/20 px-2.5 py-2 text-xs leading-relaxed text-slate-200">
        {text}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {actions.map(action => (
          <button
            key={action.label}
            type="button"
            onClick={() => onAction(action.label)}
            className="rounded-lg border px-2 py-2 text-start font-mono text-[10px] tracking-wide text-cyan-200 transition hover:bg-cyan-400/10"
            style={{ borderColor: 'rgba(34,211,238,0.28)' }}
          >
            {action.icon} {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function HardwareMetrics({ isMobile }: { isMobile: boolean }) {
  const [metrics, setMetrics] = useState({
    cpu: 0, ram: 0, ramLabel: '—', batteryPct: null as number | null, batteryCharging: false,
    diskPct: 0, diskLabel: '—',
  })

  useEffect(() => {
    if (isMobile) return
    let mounted = true

    const loadMetrics = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).electron?.hardware
        if (api) {
          const report = await api.fullReport() as {
            cpu: { usagePercent: number }
            ram: { percent: number; usedGB: number; totalGB: number }
            battery: { percent: number | null; charging: boolean }
            disks: Array<{ percent: number; usedGB: number; totalGB: number; mount: string }>
          }
          if (!mounted) return
          const primaryDisk = report.disks?.find(d => d.mount === '/' || d.mount === '/System/Volumes/Data') || report.disks?.[0]
          setMetrics({
            cpu: Math.max(0, Math.min(100, Math.round(report.cpu.usagePercent || 0))),
            ram: Math.max(0, Math.min(100, Math.round(report.ram.percent || 0))),
            ramLabel: `${report.ram.usedGB}/${report.ram.totalGB} GB`,
            batteryPct: report.battery.percent,
            batteryCharging: report.battery.charging,
            diskPct: primaryDisk?.percent ?? 0,
            diskLabel: primaryDisk ? `${primaryDisk.usedGB}/${primaryDisk.totalGB} GB` : '—',
          })
          return
        }

        const res = await fetch('/api/dashboard', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as { system?: { cpu?: number; ram?: { pct?: number; usedGB?: number; totalGB?: number }; disk?: { pct?: number; usedGB?: number; totalGB?: number }; battery?: { pct?: number | null; charging?: boolean } } }
        if (!mounted) return
        setMetrics({
          cpu: Math.max(0, Math.min(100, Math.round(data.system?.cpu || 0))),
          ram: Math.max(0, Math.min(100, Math.round(data.system?.ram?.pct || 0))),
          ramLabel: data.system?.ram?.usedGB && data.system?.ram?.totalGB ? `${data.system.ram.usedGB}/${data.system.ram.totalGB} GB` : '—',
          batteryPct: data.system?.battery?.pct ?? null,
          batteryCharging: data.system?.battery?.charging ?? false,
          diskPct: data.system?.disk?.pct ?? 0,
          diskLabel: data.system?.disk?.usedGB && data.system?.disk?.totalGB ? `${data.system.disk.usedGB}/${data.system.disk.totalGB} GB` : '—',
        })
      } catch {
        if (mounted) setMetrics(prev => ({ ...prev }))
      }
    }

    void loadMetrics()
    const timer = setInterval(() => { void loadMetrics() }, 5000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [isMobile])

  if (isMobile) return null

  const cpuColor = metricColor(metrics.cpu)
  const ramColor = metricColor(metrics.ram)
  const diskColor = metricColor(metrics.diskPct)

  const rows = [
    { label: 'CPU', pct: metrics.cpu, color: cpuColor, sub: `${metrics.cpu}%` },
    { label: 'RAM', pct: metrics.ram, color: ramColor, sub: `${metrics.ram}% · ${metrics.ramLabel}` },
    { label: 'DISK', pct: metrics.diskPct, color: diskColor, sub: `${metrics.diskPct}% · ${metrics.diskLabel}` },
  ]
  if (metrics.batteryPct !== null) {
    rows.push({
      label: 'BAT',
      pct: metrics.batteryPct,
      color: metrics.batteryPct <= 20 ? '#ff4444' : metrics.batteryPct <= 50 ? '#ffb347' : '#00ff88',
      sub: `${metrics.batteryPct}%${metrics.batteryCharging ? ' ⚡' : ''}`,
    })
  }

  return (
    <div className="w-full max-w-[220px] rounded-xl border px-3 py-2 font-mono text-[10px]"
      style={{ borderColor: 'rgba(26,111,255,0.18)', background: 'rgba(0,7,20,0.78)' }}>
      <div className="mb-2 text-center text-[9px] tracking-[0.28em] text-blue-300/55">LIVE METRICS</div>
      {rows.map(metric => (
        <div key={metric.label} className="mb-2 last:mb-0">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-blue-300/45">{metric.label}</span>
            <span style={{ color: metric.color }}>{metric.sub}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${metric.pct}%`, background: metric.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function JarvisPage() {
  const platform = usePlatform()
  const [mode, setMode]                     = useState<Mode>('idle')
  const [messages, setMessages]             = useState<Message[]>([])
  const [currentUser, setCurrentUser]       = useState<{ name: string; username: string; role: string } | null>(null)
  const [input, setInput]                   = useState('')
  const [memory, setMemory]                 = useState<Memory>({ userName: '', preferences: { city: 'Riyadh', music: 'spotify' }, facts: [], conversationCount: 0 })
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [wakeWordActive, setWakeWordActive] = useState(false)
  const [persona, setPersona]               = useState<string>('default')
  const [autoSwitch, setAutoSwitch]         = useState(false)
  const [offlineMode, setOfflineMode]       = useState(false)
  const [hotwordEnabled, setHotwordEnabled] = useState(false)
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(false)
  const [voiceEngine, setVoiceEngine]       = useState<VoiceEngine>('browser')
  const persistVoiceEngine = useCallback((engine: VoiceEngine) => {
    setVoiceEngine(engine)
    if (typeof window !== 'undefined') localStorage.setItem('gf_voiceEngine', engine)
  }, [])
  const [ttsInfo, setTtsInfo]               = useState<TtsInfo | null>(null)
  const [showSettings, setShowSettings]     = useState(false)
  const [showAudit, setShowAudit]           = useState(false)
  const [models, setModels]                 = useState<ModelInfo[]>([])
  const [activeModel, setActiveModel]       = useState<{ provider: string; model: string } | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [selectedModel, setSelectedModel]       = useState<string>('')
  const [integrations, setIntegrations]     = useState({ github: false, discord: false, googleSearch: false })
  const [hostCapabilities, setHostCapabilities] = useState<HostCapabilities>({
    platform: 'unknown', macControl: false, screenCapture: false, browserControl: false,
    shell: true, remoteClientControl: true, freeLocalAI: false,
  })
  const [lastToolUsed, setLastToolUsed]     = useState<string | null>(null)
  const [liveModel, setLiveModel]           = useState<{ provider: string; model: string } | null>(null)
  const [toasts, setToasts]                 = useState<Toast[]>([])
  const [copilotMode, setCopilotMode]       = useState(false)
  const [copilotThinking, setCopilotThinking] = useState(false)
  const [pendingRiskMsg, setPendingRiskMsg] = useState<{ message: string; tool: string } | null>(null)
  const [speechLang, setSpeechLang]         = useState('en-US')
  const [detectedLang, setDetectedLang]     = useState('en')
  const [clipboardPanel, setClipboardPanel] = useState<ClipboardPanelState>({ text: '', visible: false })
  const [interruptFlash, setInterruptFlash] = useState(false)
  // ── Clicky state ──────────────────────────────────────────────────────────────
  const [clickyPoint, setClickyPoint] = useState<{ x: number; y: number; label?: string | null } | null>(null)
  const [clickyHighlight, setClickyHighlight] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [screenCaptureActive, setScreenCaptureActive] = useState(false)
  const [screenCaptureData, setScreenCaptureData] = useState<string | null>(null)
  const [pushToTalkActive, setPushToTalkActive] = useState(false)
  const [visionPending, setVisionPending] = useState(false)
  const pushToTalkRef = useRef(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)
  const [showMarkL, setShowMarkL] = useState(false)
  const [bridgeStatus, setBridgeStatus] = useState<string>('stopped')
  // ── n8n workflow state ───────────────────────────────────────────────────────
  const [n8nConnected, setN8nConnected] = useState(false)
  const [n8nUrl, setN8nUrl] = useState('http://localhost:5678')
  const [n8nUrlTouched, setN8nUrlTouched] = useState(false)
  const [n8nWorkflows, setN8nWorkflows] = useState<Array<{ id: string; name: string; active: boolean; trigger: string }>>([])
  const [n8nConnecting, setN8nConnecting] = useState(false)
  const [n8nReachable, setN8nReachable] = useState<boolean | null>(null)
  const [n8nCreating, setN8nCreating] = useState(false)
  const [n8nNewName, setN8nNewName] = useState('')
  const [n8nNewType, setN8nNewType] = useState<'deploy' | 'notify' | 'pr' | 'custom'>('deploy')
  const [n8nNewDesc, setN8nNewDesc] = useState('')
  const [n8nCopiedId, setN8nCopiedId] = useState<string | null>(null)
  // ── Gemini Live voice state ───────────────────────────────────────────────────
  const [geminiConnectionState, setGeminiConnectionState] = useState<string>('disconnected')
  const [geminiListening, setGeminiListening] = useState(false)
  const [geminiTranscript, setGeminiTranscript] = useState<Array<{ text: string; isFinal: boolean; ts: number }>>([])
  const [geminiPlayActive, setGeminiPlayActive] = useState(false)
  const [geminiVoiceMode, setGeminiVoiceMode] = useState<'gemini-live' | 'browser' | 'offline' | 'voicebox'>('browser')
  const voiceboxConfigRef = useRef<{ engine: string; profile: string }>({ engine: 'kokoro', profile: '' })
  // ── Agent state ─────────────────────────────────────────────────────────────
  const [showAgent, setShowAgent] = useState(false)
  const [agentStatus, setAgentStatus] = useState<string>('IDLE')
  const [agentIssueCount, setAgentIssueCount] = useState(0)
  const [agentCurrentTask, setAgentCurrentTask] = useState<string>('')
  // ── Permission state ───────────────────────────────────────────────────────
  const [permissions, setPermissions] = useState<{ mic: boolean; camera: boolean; screen: boolean }>({ mic: false, camera: false, screen: false })
  const [showPermissionBanner, setShowPermissionBanner] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const geminiTranscriptRef = useRef<Array<{ text: string; isFinal: boolean; ts: number }>>([])
  const audioAnalyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioAnimFrameRef = useRef<number | null>(null)

  const recognitionRef     = useRef<Any>(null)
  const wakeRecognitionRef = useRef<Any>(null)
  const micStreamRef       = useRef<MediaStream | null>(null)  // held while speech recognition is active (Windows fix)
  const voicesRef          = useRef<Any[]>([])
  const messagesEndRef     = useRef<HTMLDivElement>(null)
  const inputRef           = useRef<HTMLInputElement>(null)
  const hotwordEnabledRef  = useRef(false)
  const handsFreeEnabledRef = useRef(false)
  const listeningRequestedRef = useRef(false)
  const startListeningRef  = useRef<(() => Promise<void>) | null>(null)
  const startWakeListenerRef = useRef<(() => Promise<void>) | null>(null)
  const modeRef            = useRef<Mode>('idle')
  const ttsFailCountRef    = useRef(0)
  const wakeRestartingRef  = useRef(false)  // persists across re-renders (fixes stale closure)
  const micPermGranted     = useRef(false)  // tracks whether mic permission has been granted
  const micPausedRef       = useRef(false)  // true while JARVIS is thinking/speaking (prevents echo)
  const wakeJustDetectedRef = useRef(false)  // suppresses onend restart after wake detection
  const speakingRef         = useRef(false)  // prevents overlapping speak() calls
  const externalAudioRef   = useRef<HTMLAudioElement | null>(null)
  const externalAudioUrlRef = useRef<string | null>(null)
  const lastActivityRef    = useRef(Date.now())
  const proactiveTriggeredRef = useRef(false)
  const proactiveTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const clipboardWatchRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const clipboardDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clipboardPrimedRef = useRef(false)
  const lastClipboardRef   = useRef('')
  const sessionIdRef       = useRef(`jarvis-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
  const sessionStartedAtRef = useRef(new Date().toISOString())
  const messagesRef         = useRef<Message[]>([])

  useEffect(() => { hotwordEnabledRef.current = hotwordEnabled }, [hotwordEnabled])
  useEffect(() => { handsFreeEnabledRef.current = handsFreeEnabled }, [handsFreeEnabled])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    setPersona(localStorage.getItem('gf_persona') || 'default')
    setAutoSwitch(localStorage.getItem('gf_autoswitch') === 'true')
    setOfflineMode(localStorage.getItem('gf_offline') === 'true')
    setHotwordEnabled(localStorage.getItem('gf_hotword') === 'true')
    setHandsFreeEnabled(localStorage.getItem('gf_handsfree') === 'true')
    setVoiceEngine((localStorage.getItem('gf_voiceEngine') as VoiceEngine) || 'browser')
     // Load Gemini Live voice settings
     try {
       const raw = localStorage.getItem('gf_voice_settings')
       if (raw) {
         const vs = JSON.parse(raw) as { mode?: string; voiceboxEngine?: string; voiceboxProfile?: string }
         if (vs.mode) setGeminiVoiceMode(vs.mode as 'gemini-live' | 'browser' | 'offline' | 'voicebox')
         if (vs.voiceboxEngine) voiceboxConfigRef.current.engine = vs.voiceboxEngine
         if (vs.voiceboxProfile) voiceboxConfigRef.current.profile = vs.voiceboxProfile
       }
     } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const prefill = new URLSearchParams(window.location.search).get('prefill')
    if (!prefill) return
    setInput(prefill)
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(timeout)
  }, [])

  useEffect(() => () => {
    const snapshot = messagesRef.current
    if (snapshot.length === 0) return

    const payload: HistoryPayloadSession = {
      id: sessionIdRef.current,
      startedAt: sessionStartedAtRef.current,
      endedAt: new Date().toISOString(),
      messages: snapshot.map(message => ({
        role: message.role,
        content: message.text,
        ts: message.ts,
      })),
    }

    void fetch('/api/jarvis/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined)
  }, [])

  // ── Toast helpers ─────────────────────────────────────────────────────────

  const toast = useCallback((type: Toast['type'], msg: string, duration = 4000) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, type, msg }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    proactiveTriggeredRef.current = false
  }, [])

  const stopCurrentAudio = useCallback(() => {
    if (externalAudioRef.current) {
      externalAudioRef.current.pause()
      externalAudioRef.current.currentTime = 0
      externalAudioRef.current = null
    }
    if (externalAudioUrlRef.current) {
      URL.revokeObjectURL(externalAudioUrlRef.current)
      externalAudioUrlRef.current = null
    }
    window.speechSynthesis?.cancel()
  }, [])

  // ── Permission management ─────────────────────────────────────────────────

  const checkPermissions = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.permissions) {
      setShowPermissionBanner(true)
      return
    }
    try {
      const micStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      const camStatus = await navigator.permissions.query({ name: 'camera' as PermissionName })
      const mic = micStatus.state === 'granted'
      const camera = camStatus.state === 'granted'
      setPermissions(prev => ({ ...prev, mic, camera }))
      if (!mic) setShowPermissionBanner(true)
      if (micStatus.onchange) micStatus.onchange = () => setPermissions(prev => ({ ...prev, mic: micStatus.state === 'granted' }))
      if (camStatus.onchange) camStatus.onchange = () => setPermissions(prev => ({ ...prev, camera: camStatus.state === 'granted' }))
    } catch {
      setShowPermissionBanner(true)
    }
  }, [])

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
      setPermissions(prev => ({ ...prev, mic: true }))
      micPermGranted.current = true
      return true
    } catch {
      setPermissions(prev => ({ ...prev, mic: false }))
      setPermissionError('Microphone access denied. Please allow mic in browser settings and reload.')
      return false
    }
  }, [])

  const requestCameraPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach(t => t.stop())
      setPermissions(prev => ({ ...prev, camera: true }))
      toast('success', 'Camera access granted')
    } catch {
      setPermissions(prev => ({ ...prev, camera: false }))
      toast('warn', 'Camera access denied — screen vision features will be limited')
    }
  }, [toast])

  const requestAllPermissions = useCallback(async () => {
    setPermissionError(null)
    const micOk = await requestMicPermission()
    if (micOk) toast('success', 'Microphone connected')
    await requestCameraPermission()
    // Screen share can only be requested on user gesture
    setShowPermissionBanner(false)
  }, [requestMicPermission, requestCameraPermission, toast])

  const releaseMicStream = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }
  }, [])

  // ── Audio level analyser for orb visualization ──────────────────────────────
  const startAudioAnalyser = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      audioContextRef.current = ctx
      audioAnalyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(dataArray)
        // Average the lower frequencies (voice range: 85-300Hz)
        let sum = 0
        const bins = Math.min(16, dataArray.length)
        for (let i = 0; i < bins; i++) sum += dataArray[i]
        setAudioLevel(sum / bins / 255) // 0..1
        audioAnimFrameRef.current = requestAnimationFrame(tick)
      }
      audioAnimFrameRef.current = requestAnimationFrame(tick)
    } catch {
      // Mic access denied — no visual feedback, but still works
    }
  }, [])

  const stopAudioAnalyser = useCallback(() => {
    if (audioAnimFrameRef.current) {
      cancelAnimationFrame(audioAnimFrameRef.current)
      audioAnimFrameRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    audioAnalyserRef.current = null
    setAudioLevel(0)
  }, [])

  // ── Mic pause/resume — stop listening while JARVIS thinks/speaks (prevents echo) ──

  const pauseMic = useCallback(() => {
    if (micPausedRef.current) return
    micPausedRef.current = true
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch { /* already stopped */ }
      recognitionRef.current = null
    }
    releaseMicStream()
    setLiveTranscript('')
    stopAudioAnalyser()
  }, [stopAudioAnalyser, releaseMicStream])

  const resumeMic = useCallback(() => {
    micPausedRef.current = false
    window.setTimeout(() => {
      // Don't restart mic if mode isn't idle (e.g. still thinking/speaking from a concurrent call)
      if (modeRef.current !== 'idle') return
      if (listeningRequestedRef.current && handsFreeEnabledRef.current) {
        void startListeningRef.current?.()
      } else if (hotwordEnabledRef.current) {
        void startWakeListenerRef.current?.()
      }
    }, 250)
  }, [])

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const SR = getSR()
    setVoiceSupported(!!SR)
    let cancelled = false
    let greetTimer: ReturnType<typeof setTimeout> | null = null
    let morningTimer: ReturnType<typeof setTimeout> | null = null

    const loadVoices = () => { voicesRef.current = window.speechSynthesis?.getVoices() ?? [] }
    loadVoices()
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices)

    const queueGreeting = (welcome: string) => {
      if (cancelled) return
      if (greetTimer) clearTimeout(greetTimer)
      addAIMessage(welcome, 'neutral', null, null)
      greetTimer = setTimeout(() => {
        if (!cancelled) void speak(welcome)
      }, 600)
    }

    const queueMorningBriefing = () => {
      if (typeof window === 'undefined') return
      const today = new Date().toISOString().slice(0, 10)
      if (localStorage.getItem('gf_morning_date') === today) return
      if (morningTimer) clearTimeout(morningTimer)

      morningTimer = setTimeout(async () => {
        if (cancelled) return
        try {
          const res = await fetch('/api/jarvis/morning', { cache: 'no-store' })
          if (!res.ok) return
          const data = await res.json() as MorningBriefingResponse
          if (cancelled) return

          const briefing = [
            '🌅',
            data.greeting,
            `Time: ${data.time}.`,
            data.weather,
            ...(data.news || []).slice(0, 3).map((item, index) => `Tech ${index + 1}: ${item}.`),
            data.advice,
          ].join(' ')

          addAIMessage(briefing, 'happy', null, null)
          localStorage.setItem('gf_morning_date', today)
          void speak(briefing)
        } catch {
          // Keep startup quiet on briefing failure.
        }
      }, 2000)
    }

    const loadModels = async () => {
      try {
        const res = await fetch('/api/jarvis/models')
        if (!res.ok) return
        const data = await res.json() as {
          models?: ModelInfo[]
          active?: { provider: string; model: string } | null
          integrations?: { github?: boolean; discord?: boolean; googleSearch?: boolean }
          host?: HostCapabilities
          tts?: TtsInfo
        }
        if (cancelled) return

        setModels(data.models || [])
        setActiveModel(data.active || null)
        setIntegrations({ github: !!data.integrations?.github, discord: !!data.integrations?.discord, googleSearch: !!data.integrations?.googleSearch })
        if (data.host) setHostCapabilities(data.host)
        if (data.tts) {
          setTtsInfo(data.tts)
          const saved = localStorage.getItem('gf_voiceEngine') as VoiceEngine | null
          const serverEngine = data.tts.engine || 'browser'
          // Only auto-select the server engine when the user has never chosen
          // a voice engine — never override an explicit 'browser' preference.
          if (!saved) {
            persistVoiceEngine(serverEngine)
            if (data.tts.fishAudio) toast('success', '🎙 JARVIS voice ready — Fish Audio active', 5000)
            else if (data.tts.elevenLabs) toast('info', '🎙 ElevenLabs voice active')
          }
        }
      } catch {}
    }

    const loadMemory = async () => {
      try {
        const res = await fetch('/api/jarvis/memory')
        if (!res.ok) throw new Error('memory-load-failed')
        const m = await res.json() as Memory
        if (cancelled) return
        setMemory(m)
        const name = m.userName || ''
        const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
        queueGreeting(name ? `Welcome back, ${name}. ${greeting}` : `G.F.A.I. online. ${greeting}`)
        queueMorningBriefing()
      } catch {
        queueGreeting('G.F.A.I. online. Systems operational.')
        queueMorningBriefing()
      }
    }

    void loadModels()
    void loadMemory()
    void checkPermissions()
    void fetch('/api/auth/me').then(async r => {
      if (cancelled || !r.ok) return
      const data = await r.json().catch(() => null)
      if (data?.user && !cancelled) setCurrentUser(data.user)
    }).catch(() => {})
    // Auto-register this browser/device under the current user
    import('@/lib/client-device').then(m => m.reportDevice()).catch(() => {})

    return () => {
      cancelled = true
      if (greetTimer) clearTimeout(greetTimer)
      if (morningTimer) clearTimeout(morningTimer)
      stopCurrentAudio()
      window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices)
      recognitionRef.current?.stop()
      wakeRecognitionRef.current?.stop()
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop())
        micStreamRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Inbox polling — surface messages from other GhostForge users ─────────
  useEffect(() => {
    let cancelled = false
    const seen = new Set<string>()

    const checkInbox = async () => {
      try {
        const res = await fetch('/api/jarvis/inbox')
        if (!res.ok) return
        const data = await res.json() as { messages: Array<{ id: string; from: string; text: string; ts: string }>; unread: number }
        if (cancelled) return
        for (const m of data.messages) {
          if (seen.has(m.id)) continue
          seen.add(m.id)
          const who = m.from ? ` from ${m.from}` : ''
          toast('info', `📨 Message${who}: ${m.text}`, 8000)
          addAIMessage(`📨 New message${who}: ${m.text}`, 'happy', null, null)
        }
        void fetch('/api/jarvis/inbox', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        }).catch(() => {})
      } catch {
        /* server unreachable — retry next tick */
      }
    }

    void checkInbox()
    const timer = window.setInterval(checkInbox, 20000)
    return () => { cancelled = true; window.clearInterval(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electron?.bridgeManager
    if (!api) return
    api.getStatus().then((res: { status: string }) => setBridgeStatus(res.status)).catch(() => {})
    api.onStatusChange((status: string) => setBridgeStatus(status))
  }, [])

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electron?.n8n
    if (!api) return
    api.getStatus().then((res: { connected: boolean; url: string }) => {
      setN8nConnected(res.connected)
      if (res.url) setN8nUrl(res.url)
      if (res.connected) {
        api.listWorkflows().then((wfs: Array<{ id: string; name: string; active: boolean; trigger: string }>) => {
          setN8nWorkflows(wfs)
        }).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    // Only probe n8n when it's actually in use (connected via Electron, or the
    // user entered a custom URL) — avoids ERR_CONNECTION_REFUSED noise in the
    // console every 15s when n8n is never used.
    if (!n8nConnected && !n8nUrlTouched) {
      setN8nReachable(null)
      return
    }
    let active = true
    const check = async () => {
      try {
        const res = await fetch(n8nUrl, { method: 'HEAD', mode: 'no-cors', signal: AbortSignal.timeout(3000) })
        if (active) setN8nReachable(true)
      } catch {
        if (active) setN8nReachable(false)
      }
    }
    void check()
    const timer = setInterval(check, 15000)
    return () => { active = false; clearInterval(timer) }
  }, [n8nUrl, n8nConnected, n8nUrlTouched])

  // ── Agent IPC listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electron?.autonomousAgent
    if (!api) return

    api.getStatus().then((s: { status?: string; issueCount?: number; currentTask?: string }) => {
      if (s.status) setAgentStatus(s.status)
      if (s.issueCount != null) setAgentIssueCount(s.issueCount)
      if (s.currentTask) setAgentCurrentTask(s.currentTask)
    }).catch(() => {})

    api.onStateChange((s: { status?: string; issueCount?: number }) => {
      if (s.status) setAgentStatus(s.status)
      if (s.issueCount != null) setAgentIssueCount(s.issueCount)
    })

    api.onProgress((p: { currentTask?: string; issueNumber?: number }) => {
      if (p.currentTask) setAgentCurrentTask(p.currentTask)
    })

    api.onIssueUpdate((u: { count?: number }) => {
      if (u.count != null) setAgentIssueCount(u.count)
    })
  }, [])

  useEffect(() => {
    const handleActivity = (event: Event) => {
      if (event.type === 'mousemove' && Date.now() - lastActivityRef.current < 30_000) return
      markActivity()
    }

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'mousemove']
    for (const event of events) window.addEventListener(event, handleActivity)
    return () => {
      for (const event of events) window.removeEventListener(event, handleActivity)
    }
  }, [markActivity])

  useEffect(() => {
    let interruptTimer: number | null = null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (modeRef.current === 'speaking' || externalAudioRef.current) {
        stopSpeaking()
        setInterruptFlash(true)
        if (interruptTimer !== null) window.clearTimeout(interruptTimer)
        interruptTimer = window.setTimeout(() => setInterruptFlash(false), 1200)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (interruptTimer !== null) window.clearTimeout(interruptTimer)
    }
  }, [])

  useEffect(() => {
    if (platform.isMobile || typeof navigator === 'undefined' || !navigator.clipboard?.readText) return

    let active = true
    let dismissTimer: ReturnType<typeof setTimeout> | null = null

    const dismissPanel = () => {
      if (dismissTimer) clearTimeout(dismissTimer)
      dismissTimer = setTimeout(() => {
        if (!active) return
        setClipboardPanel(prev => ({ ...prev, visible: false }))
      }, 10_000)
      clipboardDismissRef.current = dismissTimer
    }

    const pollClipboard = async () => {
      if (document.hidden) return
      try {
        const nextValue = (await navigator.clipboard.readText()).trim()
        if (!active) return
        if (!clipboardPrimedRef.current) {
          clipboardPrimedRef.current = true
          lastClipboardRef.current = nextValue
          return
        }
        if (nextValue.length < 15 || nextValue === lastClipboardRef.current) return
        lastClipboardRef.current = nextValue
        setClipboardPanel({ text: nextValue, visible: true })
        dismissPanel()
      } catch {
        // Clipboard access can be denied by the browser; stay silent.
      }
    }

    void pollClipboard()
    clipboardWatchRef.current = setInterval(() => { void pollClipboard() }, 3000)

    return () => {
      active = false
      if (clipboardWatchRef.current) clearInterval(clipboardWatchRef.current)
      if (dismissTimer) clearTimeout(dismissTimer)
    }
  }, [platform.isMobile])

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
      stopCurrentAudio()
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
        toast('warn', `${engine === 'fish-audio' ? 'Fish Audio' : 'TTS'} failed (${data.reason || `HTTP ${res.status}`}) — using browser voice`)
        if (ttsFailCountRef.current >= 2) {
          persistVoiceEngine('browser')
          toast('warn', 'Repeated TTS failures — browser voice is now the default')
        }
        return { ok: false, usedEngine: '' }
      }

      if (engine !== 'browser' && actualEngine !== engine) {
        ttsFailCountRef.current += 1
        toast('warn', `${engine === 'fish-audio' ? 'Fish Audio' : 'TTS'} returned ${actualEngine} unexpectedly — using browser voice`)
        return { ok: false, usedEngine: '' }
      }

      ttsFailCountRef.current = 0
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      externalAudioRef.current = audio
      externalAudioUrlRef.current = url
      pauseMic()  // stop mic while JARVIS speaks — prevents echo
      setMode('speaking')
      const cleanup = () => {
        if (externalAudioRef.current === audio) externalAudioRef.current = null
        if (externalAudioUrlRef.current === url) {
          URL.revokeObjectURL(url)
          externalAudioUrlRef.current = null
        }
        setMode('idle')
        resumeMic()
      }
      audio.onended = cleanup
      audio.onerror = cleanup
      await audio.play()
      return { ok: true, usedEngine: actualEngine }
    } catch {
      ttsFailCountRef.current += 1
      resumeMic()
      return { ok: false, usedEngine: '' }
    }
  }, [voiceEngine, toast, pauseMic, resumeMic, stopCurrentAudio])

  // ── Browser TTS (fallback, always available) ──────────────────────────────

  const speakBrowser = useCallback((text: string) => {
    stopCurrentAudio()
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
    pauseMic()  // stop mic while speaking — prevents echo
    utt.onstart = () => setMode('speaking')
    utt.onend   = () => { setMode('idle'); resumeMic() }
    utt.onerror = () => { setMode('idle'); resumeMic() }
    window.speechSynthesis?.speak(utt)
  }, [pauseMic, resumeMic, stopCurrentAudio])

  // ── Voicebox TTS (local neural TTS) ─────────────────────────────────────────

  const speakVoicebox = useCallback(async (text: string): Promise<boolean> => {
    try {
      stopCurrentAudio()
      const config = voiceboxConfigRef.current
      const win = window as unknown as { electron?: { voicebox?: {
        generateSpeech: (text: string, opts: Record<string, unknown>) => Promise<{ audio: ArrayBuffer; duration: number }>;
      } } }
      if (win.electron?.voicebox) {
        const result = await win.electron.voicebox.generateSpeech(text, {
          engine: config.engine || 'kokoro',
          profileId: config.profile || undefined,
        })
        const blob = new Blob([result.audio], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        externalAudioRef.current = audio
        externalAudioUrlRef.current = url
        pauseMic()
        setMode('speaking')
        const cleanup = () => {
          if (externalAudioRef.current === audio) externalAudioRef.current = null
          if (externalAudioUrlRef.current === url) {
            URL.revokeObjectURL(url)
            externalAudioUrlRef.current = null
          }
          setMode('idle')
          resumeMic()
        }
        audio.onended = cleanup
        audio.onerror = cleanup
        await audio.play()
        return true
      }
      const res = await fetch('http://127.0.0.1:17493/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          engine: config.engine || 'kokoro',
          profile_id: config.profile || undefined,
        }),
        signal: AbortSignal.timeout(60000),
      })
      if (!res.ok) return false
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      externalAudioRef.current = audio
      externalAudioUrlRef.current = url
      pauseMic()
      setMode('speaking')
      const cleanup = () => {
        if (externalAudioRef.current === audio) externalAudioRef.current = null
        if (externalAudioUrlRef.current === url) {
          URL.revokeObjectURL(url)
          externalAudioUrlRef.current = null
        }
        setMode('idle')
        resumeMic()
      }
      audio.onended = cleanup
      audio.onerror = cleanup
      await audio.play()
      return true
    } catch {
      return false
    }
  }, [stopCurrentAudio, pauseMic, resumeMic])

  // ── Unified speak: voicebox → external engines → browser fallback ───────────

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return
    if (speakingRef.current) stopCurrentAudio()
    speakingRef.current = true
    try {
      // Voicebox mode — use local neural TTS
      if (geminiVoiceMode === 'voicebox') {
        const ok = await speakVoicebox(text)
        if (ok) return
        toast('warn', 'Voicebox TTS failed — falling back to browser voice')
      }
      if (voiceEngine !== 'browser') {
        const { ok } = await speakExternal(text)
        if (ok) return
      }
      speakBrowser(text)
    } finally {
      speakingRef.current = false
    }
  }, [geminiVoiceMode, speakVoicebox, voiceEngine, speakExternal, speakBrowser, stopCurrentAudio, toast])

  useEffect(() => {
    proactiveTimerRef.current = setInterval(() => {
      const silenceMs = Date.now() - lastActivityRef.current
      if (silenceMs < 15 * 60 * 1000) return
      if (proactiveTriggeredRef.current) return
      if (modeRef.current !== 'idle' || recognitionRef.current) return

      proactiveTriggeredRef.current = true
      const lastTopic = [...messages].reverse().find(message => message.role === 'user')?.text || ''
      const params = new URLSearchParams({
        silenceMs: String(silenceMs),
        lastTopic: lastTopic.slice(0, 160),
      })

      fetch(`/api/jarvis/proactive?${params.toString()}`, { cache: 'no-store' })
        .then(async res => {
          if (!res.ok) return null
          return res.json() as Promise<{ suggestion?: string; shouldPrompt?: boolean }>
        })
        .then(payload => {
          if (!payload?.shouldPrompt || !payload.suggestion) {
            proactiveTriggeredRef.current = false
            return
          }
          addAIMessage(`🛰 ${payload.suggestion}`, 'neutral', null, null)
          void speak(payload.suggestion)
        })
        .catch(() => {
          proactiveTriggeredRef.current = false
        })
    }, 60_000)

    return () => {
      if (proactiveTimerRef.current) clearInterval(proactiveTimerRef.current)
    }
  }, [messages, addAIMessage, speak])

  // ── Send directly to Copilot CLI ─────────────────────────────────────────

  const recordModelResponse = useCallback((modelName: string | undefined, latency: number, responseText: string) => {
    if (typeof window === 'undefined' || !responseText.trim()) return

    const recorder = (window as Window & {
      __gf_recordModelResponse?: (model: string, responseLatency: number, responseLength: number) => void
    }).__gf_recordModelResponse

    recorder?.(modelName || selectedModel || liveModel?.model || 'auto', latency, responseText.length)
  }, [liveModel, selectedModel])

  const sendToCopilot = useCallback(async (text: string) => {
    if (!text.trim()) return
    markActivity()
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
          persona,
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
  }, [memory, persona, addUserMessage, addAIMessage, speak, markActivity])

  // ── Screen capture for Clicky ─────────────────────────────────────────────
  const captureScreen = useCallback(async (): Promise<string | null> => {
    try {
      // Prefer Electron IPC for direct screen capture
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).electron?.screen
      if (api) {
        const result = await api.capture({ format: 'jpeg', quality: 70 }) as { success: boolean; image: string }
        if (result?.success && result.image) {
          setScreenCaptureData(result.image)
          return result.image
        }
        return null
      }
      const res = await fetch('/api/jarvis/screen-capture', { method: 'POST' })
      const data = await res.json() as { image?: string; error?: string }
      if (data.image) {
        setScreenCaptureData(data.image)
        return data.image
      }
      return null
    } catch {
      return null
    }
  }, [])

  // ── Handle Clicky tool responses ───────────────────────────────────────────
  const handleClickyToolResult = useCallback((tool: string, result: string) => {
    if (tool === 'point_cursor') {
      try {
        const parsed = JSON.parse(result) as { action: string; x: number; y: number; label?: string }
        if (parsed.action === 'point_cursor') {
          setClickyPoint({ x: parsed.x, y: parsed.y, label: parsed.label })
          setTimeout(() => setClickyPoint(null), 5000)
        }
      } catch {}
    }
    if (tool === 'highlight_area') {
      try {
        const parsed = JSON.parse(result) as { action: string; x: number; y: number; w: number; h: number }
        setClickyHighlight({ x: parsed.x, y: parsed.y, w: parsed.w, h: parsed.h })
        setTimeout(() => setClickyHighlight(null), 5000)
      } catch {}
    }
  }, [])

  // ── Push-to-talk with screen capture ───────────────────────────────────────
  const handlePushToTalk = useCallback(async () => {
    if (pushToTalkRef.current) return
    pushToTalkRef.current = true
    setPushToTalkActive(true)
    setVisionPending(true)

    try {
      const image = await captureScreen()
      if (!image) {
        toast('error', 'Screen capture failed — check Screen Recording permission')
        return
      }

      // Send to vision model via the understand_screen tool
      setMode('thinking')
      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'What do you see on this screen? Describe the UI elements and where they are.',
          quickAction: 'understand_screen',
          memory,
          persona,
        }),
      })
      const data = await res.json() as { speech: string; tool: string | null; toolResult: string | null; emotion: Emotion }
      addAIMessage(data.speech, data.emotion || 'neutral', data.tool, data.toolResult)
      if (data.tool) handleClickyToolResult(data.tool, data.toolResult || '')
      void speak(data.speech)
    } catch {
      toast('error', 'Screen understanding failed')
    } finally {
      setVisionPending(false)
      setPushToTalkActive(false)
      pushToTalkRef.current = false
      setMode('idle')
    }
  }, [captureScreen, memory, persona, addAIMessage, speak, handleClickyToolResult])

  // ── Keyboard shortcut: Ctrl+Option for push-to-talk ───────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === 'v') {
        e.preventDefault()
        void handlePushToTalk()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlePushToTalk])

  // ── Send to G.F.A.I. ─────────────────────────────────────────
  const sendToJarvis = useCallback(async (text: string, quickAction?: string) => {
    if (!text.trim()) return
    markActivity()
    // If Copilot Mode is ON, route directly to Copilot CLI
    if (copilotMode) { void sendToCopilot(text); return }
    // Re-route "Ask Copilot: ..." quick commands
    const copilotMatch = text.match(/^Ask Copilot:\s*(.+)/i)
    if (copilotMatch) {
      text = `Ask GitHub Copilot CLI: ${copilotMatch[1]}`
    }
    addUserMessage(text)
    modeRef.current = 'thinking'
    setMode('thinking')
    pauseMic()  // stop mic while thinking — mic restarts when JARVIS finishes speaking
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
      const startedAt = Date.now()
      let latestResponseText = ''
      const historySlice = messages.slice(-8).map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user', content: m.text,
      }))
      const responseId = `${Date.now()}-jarvis`
      const upsertAIMessage = (patch: Partial<Message> & { text: string }) => {
        setMessages(prev => {
          const index = prev.findIndex(message => message.id === responseId)
          if (patch.text && patch.text !== '...') latestResponseText = patch.text

          const nextMessage: Message = {
            id: responseId,
            role: 'ai',
            text: patch.text,
            emotion: patch.emotion,
            tool: patch.tool,
            toolResult: patch.toolResult,
            usedModel: patch.usedModel,
            domain: patch.domain,
            confidence: patch.confidence,
            risk: patch.risk,
            requiresConfirmation: patch.requiresConfirmation,
            ts: index >= 0 ? prev[index].ts : Date.now(),
          }

          if (index === -1) {
            return [...prev, nextMessage]
          }

          const updated = [...prev]
          updated[index] = { ...prev[index], ...nextMessage }
          return updated
        })
      }
      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          message: text,
          quickAction,
          history: historySlice,
          memory,
          selectedProvider: selectedProvider || undefined,
          selectedModel: selectedModel || undefined,
          persona,
          offlineMode,
          confirmRisk: /^(confirm|yes|proceed|do it|تأكيد|نعم)$/i.test(text.trim()) && pendingRiskMsg != null,
          lang: msgLang,
          platform: platform.type,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || 'Request failed')
      }

      const contentType = res.headers.get('content-type') || ''
      if (!res.body || !contentType.includes('text/event-stream')) {
        const data = await res.json() as {
          speech: string; tool: string | null; toolResult: string | null
          emotion: Emotion; usedModel?: string; usedProvider?: string
          domain?: string; confidence?: number; detectedLang?: string
          risk?: { risk: number; level: string; reason: string; requires_confirmation: boolean }
          requiresConfirmation?: boolean
        }
        const { speech, tool, toolResult, emotion, usedModel, usedProvider, domain, confidence, risk, requiresConfirmation, detectedLang: serverLang } = data

        if (tool) setLastToolUsed(tool)
        if (tool && toolResult) handleClickyToolResult(tool, toolResult)
        if (serverLang && serverLang !== detectedLang) {
          setDetectedLang(serverLang)
          setSpeechLang(getSpeechLang(serverLang))
        }

        if (usedModel) {
          const live = { provider: usedProvider || '', model: usedModel }
          setLiveModel(live)
          if (selectedModel && selectedModel !== usedModel) {
            toast('warn', `Selected "${selectedModel}" unavailable — used "${usedModel}" instead`)
          }
        }

        addAIMessage(speech, emotion || 'neutral', tool, toolResult, usedModel, domain, confidence, risk, requiresConfirmation)
        recordModelResponse(usedModel, Date.now() - startedAt, speech)
        void speak(speech)

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
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentTool: string | null = null
      let currentRisk: Message['risk'] = null
      let requiresConfirmation = false

      const handleEvent = (payload: {
        type?: string
        speech?: string
        tool?: string | null
        toolParams?: Record<string, unknown>
        toolResult?: string | null
        emotion?: Emotion
        confidence?: number
        risk?: Message['risk']
        requiresConfirmation?: boolean
        usedModel?: string
        usedProvider?: string
        domain?: string
        detectedLang?: string
      }) => {
        switch (payload.type) {
          case 'ack':
            // Just show a silent "thinking" bubble — never speak the ack phrase
            upsertAIMessage({ text: '...', emotion: 'thinking', tool: null, toolResult: null })
            break
          case 'response':
            currentTool = payload.tool ?? null
            currentRisk = payload.risk ?? null
            requiresConfirmation = Boolean(payload.requiresConfirmation)
            if (currentTool) {
              setLastToolUsed(currentTool)
              setMode('thinking')
            }
            upsertAIMessage({
              text: payload.speech || 'Done.',
              emotion: payload.emotion || 'neutral',
              tool: currentTool,
              toolResult: null,
              domain: payload.domain,
              confidence: payload.confidence,
              risk: currentRisk,
              requiresConfirmation,
            })
            if (requiresConfirmation) {
              toast('warn', `⚠️ High-risk action detected. Reply "confirm" to proceed or "cancel" to abort.`, 10000)
              setPendingRiskMsg({ message: text, tool: currentTool || '' })
              // Still speak the warning so user hears it, then return to idle so they can type
              if (payload.speech) void speak(payload.speech)
              setMode('idle')
              resumeMic()
            } else {
              setPendingRiskMsg(null)
              if (!currentTool && payload.speech) {
                void speak(payload.speech)
              }
            }
            break
          case 'tool_done':
            upsertAIMessage({
              text: payload.speech || 'Done.',
              emotion: 'done',
              tool: currentTool,
              toolResult: payload.toolResult || null,
              confidence: undefined,
              risk: currentRisk,
              requiresConfirmation: false,
            })
            if (payload.speech) {
              void speak(payload.speech)
            }
            break
          case 'done':
            if (payload.detectedLang && payload.detectedLang !== detectedLang) {
              setDetectedLang(payload.detectedLang)
              setSpeechLang(getSpeechLang(payload.detectedLang))
            }
            if (payload.usedModel) {
              const live = { provider: payload.usedProvider || '', model: payload.usedModel }
              setLiveModel(live)
              if (selectedModel && selectedModel !== payload.usedModel) {
                toast('warn', `Selected "${selectedModel}" unavailable — used "${payload.usedModel}" instead`)
              }
            }
            recordModelResponse(payload.usedModel, Date.now() - startedAt, latestResponseText)
            fetch('/api/jarvis/memory', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ conversationCount: (memory.conversationCount || 0) + 1 }),
            }).catch(() => {})
            // Always transition to idle on done — tools and confirmation already handled their own speak/mic
            setMode('idle')
            resumeMic()
            break
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data:')) continue
            const raw = line.slice(5).trim()
            if (!raw) continue
            try {
              handleEvent(JSON.parse(raw) as {
                type?: string
                speech?: string
                tool?: string | null
                toolParams?: Record<string, unknown>
                toolResult?: string | null
                emotion?: Emotion
                confidence?: number
                risk?: Message['risk']
                requiresConfirmation?: boolean
                usedModel?: string
                usedProvider?: string
                domain?: string
                detectedLang?: string
              })
            } catch {
              // Ignore malformed SSE frames.
            }
          }
        }
      }
    } catch (e) {
      const err = 'Systems error. Please try again.'
      addAIMessage(err, 'alert', null, null)
      toast('error', `Request failed: ${String(e).slice(0, 60)}`)
      // speak() handles mode transition to idle and mic resume via its onended/onerror
      await speak(err)
      console.error(e)
    }
  }, [messages, memory, selectedProvider, selectedModel, persona, copilotMode, detectedLang, platform.type, pendingRiskMsg, sendToCopilot, addUserMessage, addAIMessage, speak, toast, pauseMic, resumeMic, markActivity, recordModelResponse])

  // ── Gemini Live event listeners (Electron only) ────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = (window as any).electron as {
      geminiLive?: {
        onConnectionChange: (cb: (state: string) => void) => void
        onTranscript: (cb: (data: { text: string; isFinal: boolean }) => void) => void
        onAudioData: (cb: (data: unknown) => void) => void
        onError: (cb: (error: string) => void) => void
        onListeningStarted: (cb: () => void) => void
        onListeningStopped: (cb: () => void) => void
        onPlaybackStarted: (cb: () => void) => void
        onPlaybackEnded: (cb: () => void) => void
        getStatus: () => Promise<{ connectionState: string; active: boolean }>
      }
    } | null
    if (!electron?.geminiLive) return

    const gl = electron.geminiLive

    gl.onConnectionChange((state: string) => setGeminiConnectionState(state))
    gl.onTranscript((data: { text: string; isFinal: boolean }) => {
      const entry = { text: data.text, isFinal: data.isFinal, ts: Date.now() }
      geminiTranscriptRef.current = [...geminiTranscriptRef.current.slice(-30), entry]
      setGeminiTranscript([...geminiTranscriptRef.current])
      if (data.isFinal && data.text.trim()) {
        setInput(data.text)
        const raw = localStorage.getItem('gf_voice_settings')
        const vs = raw ? JSON.parse(raw) as { pushToTalk?: boolean } : {}
        if (!vs.pushToTalk) {
          setTimeout(() => {
            void sendToJarvis(data.text)
            setGeminiTranscript([])
            geminiTranscriptRef.current = []
          }, 300)
        }
      }
    })
    gl.onAudioData(() => setGeminiPlayActive(true))
    gl.onListeningStarted(() => setGeminiListening(true))
    gl.onListeningStopped(() => setGeminiListening(false))
    gl.onPlaybackStarted(() => setGeminiPlayActive(true))
    gl.onPlaybackEnded(() => setGeminiPlayActive(false))
    gl.onError((error: string) => toast('error', `Gemini Live: ${error}`))

    gl.getStatus().then(s => setGeminiConnectionState(s.connectionState)).catch(() => {})
  }, [toast, sendToJarvis])

  // ── Voice recognition ─────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    const SR = getSR()
    if (!SR) {
      const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      toast('error', isLocal ? '🎤 Speech recognition not supported — use Chrome or Edge.' : '🎤 Mic requires HTTPS — use localhost:3001')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      toast('error', '🎤 Microphone API unavailable — use Chrome or Edge on localhost/HTTPS.')
      return
    }

    // Stop ALL audio to prevent echo
    stopCurrentAudio()
    releaseMicStream()

    // Abort wake listener and any existing session
    if (wakeRecognitionRef.current) {
      try { wakeRecognitionRef.current.abort() } catch { /* ignore */ }
      wakeRecognitionRef.current = null
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch { /* ignore */ }
      recognitionRef.current = null
    }

    // Windows fix: request mic permission BEFORE starting SpeechRecognition
    let micStream: MediaStream | null = null
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = micStream
      micPermGranted.current = true
      setPermissions(prev => ({ ...prev, mic: true }))
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.includes('NotAllowed') || msg.includes('Permission')) {
        toast('error', '🎤 Mic access denied — allow microphone in browser settings and reload.')
        setPermissionError('Microphone access denied. Allow mic permission and reload the page.')
        setShowPermissionBanner(true)
      } else {
        toast('error', `🎤 Mic error: ${msg.slice(0, 60)}`)
      }
      return
    }

    listeningRequestedRef.current = true
    micPausedRef.current = false
    modeRef.current = 'listening'
    setMode('listening')
    setLiveTranscript('')
    startAudioAnalyser()

    const createAndStart = () => {
      if (!listeningRequestedRef.current || micPausedRef.current) return

      const rec = new SR()
      rec.lang = speechLang
      rec.continuous = true
      rec.interimResults = true
      rec.maxAlternatives = 1
      recognitionRef.current = rec

      let silenceTimer: ReturnType<typeof setTimeout> | null = null
      let latestTranscript = ''

      rec.onresult = (e: Any) => {
        if (silenceTimer) clearTimeout(silenceTimer)
        latestTranscript = collectRecognitionTranscript(e.results)
        if (!latestTranscript) return
        setInput(latestTranscript)
        setLiveTranscript(latestTranscript)

        const currentResult = e.results[e.results.length - 1]
        const delay = currentResult?.isFinal ? 350 : 1100
        silenceTimer = setTimeout(() => {
          silenceTimer = null
          const captured = latestTranscript.trim()
          if (!captured) return
          listeningRequestedRef.current = handsFreeEnabledRef.current
          setInput('')
          setLiveTranscript('')
          void sendToJarvis(captured)
        }, delay)
      }

      rec.onerror = (ev: Any) => {
        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
        recognitionRef.current = null
        const err = ev?.error || 'unknown'
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          toast('error', '🎤 Mic blocked — click the lock icon in the address bar → Allow microphone → then try again.')
          listeningRequestedRef.current = false
          releaseMicStream()
          stopAudioAnalyser()
          setMode('idle')
          modeRef.current = 'idle'
        } else if (err === 'aborted') {
          // intentional
        } else if (err === 'no-speech') {
          setTimeout(createAndStart, 50)
        } else {
          if (listeningRequestedRef.current && !micPausedRef.current) setTimeout(createAndStart, 600)
          else {
            releaseMicStream()
            setMode('idle')
            modeRef.current = 'idle'
          }
        }
      }

      rec.onend = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        recognitionRef.current = null
        if (listeningRequestedRef.current && !micPausedRef.current) {
          setTimeout(createAndStart, 100)
        } else {
          releaseMicStream()
          if (hotwordEnabledRef.current && !wakeRecognitionRef.current) {
            setTimeout(() => { if (hotwordEnabledRef.current) void startWakeListenerRef.current?.() }, 600)
          }
        }
      }

      try {
        rec.start()
        if (!micPermGranted.current) {
          micPermGranted.current = true
        }
        if (!micPermGranted.current) {
          toast('success', '🎤 Microphone connected — speak now')
        }
      } catch {
        recognitionRef.current = null
        if (listeningRequestedRef.current && !micPausedRef.current) setTimeout(createAndStart, 400)
      }
    }

    createAndStart()
  }, [sendToJarvis, speechLang, toast, stopCurrentAudio, startAudioAnalyser, stopAudioAnalyser, releaseMicStream])

  useEffect(() => {
    startListeningRef.current = startListening
  }, [startListening])

  const stopListening = useCallback(() => {
    listeningRequestedRef.current = false
    micPausedRef.current = false
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch { /* ignore */ }
      recognitionRef.current = null
    }
    releaseMicStream()
    setInput('')
    setLiveTranscript('')
    stopAudioAnalyser()
    modeRef.current = 'idle'
    setMode('idle')
  }, [stopAudioAnalyser, releaseMicStream])

  // ── Wake word ─────────────────────────────────────────────────────────────

  const startWakeListener = useCallback(async () => {
    const SR = getSR()
    if (!SR || !hotwordEnabledRef.current || modeRef.current !== 'idle' || micPausedRef.current) return
    if (wakeRecognitionRef.current) return  // already running

    // Windows fix: ensure mic permission is granted before starting wake word listener
    if (!micPermGranted.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(t => t.stop())  // release immediately, just checking permission
        micPermGranted.current = true
        setPermissions(prev => ({ ...prev, mic: true }))
      } catch {
        setPermissionError('Microphone access needed for wake word detection. Allow mic and reload.')
        setShowPermissionBanner(true)
        return
      }
    }

    const rec = new SR()
    rec.lang = speechLang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    wakeRecognitionRef.current = rec

    rec.onresult = (e: Any) => {
      if (modeRef.current !== 'idle') return
      const transcript = collectRecognitionTranscript(e.results)
      const triggered = findWakePhrase(transcript)
      if (triggered) {
        wakeJustDetectedRef.current = true
        try { rec.abort() } catch { /* ignore */ }
        wakeRecognitionRef.current = null
        setWakeWordActive(false)
        toast('success', `${triggered} detected — listening`)
        window.setTimeout(() => { void startListening() }, 200)
      }
    }
    rec.onend = () => {
      wakeRecognitionRef.current = null
      setWakeWordActive(false)
      // Skip restart if we just detected the wake phrase — startListening will take over
      if (wakeJustDetectedRef.current) {
        wakeJustDetectedRef.current = false
        return
      }
      if (hotwordEnabledRef.current && modeRef.current === 'idle' && !wakeRestartingRef.current) {
        wakeRestartingRef.current = true
        setTimeout(() => {
          wakeRestartingRef.current = false
          if (hotwordEnabledRef.current) startWakeListener()
        }, 500)
      }
    }
    rec.onerror = (ev: Any) => {
      wakeRecognitionRef.current = null
      if (ev?.error === 'not-allowed') {
        setWakeWordActive(false)
        setHotwordEnabled(false)
        hotwordEnabledRef.current = false
        localStorage.setItem('gf_hotword', 'false')
        setPermissionError('Microphone permission denied for wake word. Enable in browser settings.')
        setShowPermissionBanner(true)
        return
      }
      if (hotwordEnabledRef.current && !wakeRestartingRef.current) {
        wakeRestartingRef.current = true
        setTimeout(() => {
          wakeRestartingRef.current = false
          if (hotwordEnabledRef.current) startWakeListener()
        }, 700)
      }
    }
    try {
      rec.start()
      setWakeWordActive(true)
    } catch {
      wakeRecognitionRef.current = null
      setWakeWordActive(false)
    }
  }, [startListening, toast, speechLang])

  useEffect(() => {
    startWakeListenerRef.current = startWakeListener
    if (hotwordEnabled && mode === 'idle' && !listeningRequestedRef.current) {
      startWakeListener()
    }
  }, [hotwordEnabled, mode, startWakeListener])

  const toggleWakeWord = useCallback(async () => {
    const SR = getSR()
    if (!SR) { toast('error', 'Speech recognition not supported in this browser.'); return }

    if (hotwordEnabledRef.current) {
      hotwordEnabledRef.current = false
      setHotwordEnabled(false)
      setWakeWordActive(false)
      localStorage.setItem('gf_hotword', 'false')
      if (wakeRecognitionRef.current) {
        try { wakeRecognitionRef.current.abort() } catch { /* ignore */ }
        wakeRecognitionRef.current = null
      }
      return
    }

    // Verify mic API is available before enabling wake word
    if (!navigator.mediaDevices?.getUserMedia) {
      const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      toast('error', isLocal ? '🎤 Speech recognition not supported — use Chrome or Edge.' : '🎤 Mic requires HTTPS — use localhost:3001')
      return
    }

    setHotwordEnabled(true)
    hotwordEnabledRef.current = true
    localStorage.setItem('gf_hotword', 'true')
    wakeRestartingRef.current = false
    void startWakeListener()
  }, [startWakeListener, toast, stopCurrentAudio])

  // ── Form submit ───────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    markActivity()
    void sendToJarvis(input)
    setInput('')
  }

  const sendClipboardAction = (action: 'EXPLAIN' | 'SUMMARISE' | 'TRANSLATE' | 'FIX') => {
    const text = clipboardPanel.text.trim()
    if (!text) return
    markActivity()
    setClipboardPanel(prev => ({ ...prev, visible: false }))
    if (clipboardDismissRef.current) clearTimeout(clipboardDismissRef.current)
    const prompts: Record<'EXPLAIN' | 'SUMMARISE' | 'TRANSLATE' | 'FIX', string> = {
      EXPLAIN: `Explain this: ${text}`,
      SUMMARISE: `Summarise this: ${text}`,
      TRANSLATE: `Translate this: ${text}`,
      FIX: `Fix this: ${text}`,
    }
    setInput('')
    void sendToJarvis(prompts[action])
  }

  const stopSpeaking = useCallback(() => {
    stopCurrentAudio()
    resumeMic()
    setMode('idle')
  }, [resumeMic, stopCurrentAudio])

  const mc = MODE_COLORS[mode]

  // ── Quick commands ────────────────────────────────────────────────────────

  const activePersona = PERSONA_OPTIONS.find(option => option.id === persona) || PERSONA_OPTIONS[0]
  const currentModelName = liveModel?.model || selectedModel || 'auto'

  const QUICK_COMMANDS = useMemo(() => JARVIS_QUICK_ACTIONS.filter(action => {
    if (action.scope === 'mac') return hostCapabilities.macControl
    if (action.id === 'browser') return hostCapabilities.browserControl
    return true
  }), [hostCapabilities.macControl, hostCapabilities.browserControl])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <LLMfitAutoSwitch
        currentModel={currentModelName}
        enabled={autoSwitch}
        onSwitch={(nextModel, reason) => {
          const matchedModel = models.find(modelOption => modelOption.id === nextModel || modelOption.label === nextModel)
          if (matchedModel) {
            setSelectedProvider(matchedModel.provider)
            setSelectedModel(matchedModel.id)
          } else {
            setSelectedModel(nextModel)
          }
          toast('info', `Auto-switched to ${nextModel}: ${reason}`)
        }}
      />
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
            {currentUser ? (
              <span className="hidden sm:flex items-center gap-1.5 font-mono text-[10px]" style={{ color: currentUser.role === 'admin' ? '#fbbf24' : '#93c5fd' }}
                title={`Signed in as ${currentUser.name}`}>
                <span>👤</span>
                <span>{currentUser.username.toUpperCase()}</span>
                <span className="rounded px-1 py-px text-[9px] uppercase"
                  style={{ background: currentUser.role === 'admin' ? 'rgba(251,191,36,0.15)' : 'rgba(147,197,253,0.15)', border: currentUser.role === 'admin' ? '1px solid rgba(251,191,36,0.4)' : '1px solid rgba(147,197,253,0.4)' }}>
                  {currentUser.role}
                </span>
              </span>
            ) : (
              <span className="hidden font-mono text-[10px] text-blue-400/40 sm:block">👤</span>
            )}
            {memory.userName && (
              <span className="font-mono text-[10px] text-blue-300/50 hidden sm:block">
                {memory.userName.toUpperCase()}
              </span>
            )}
            {/* Platform + language indicator */}
            <span className="font-mono text-[10px] text-blue-400/40 hidden sm:block" title={`Device: ${platform.type} | Lang: ${detectedLang}`}>
              {platformLabel(platform)} {detectedLang !== 'en' ? `| ${detectedLang.toUpperCase()}` : ''}
            </span>
            <span className="hidden rounded border px-2 py-1 font-mono text-[10px] sm:block" style={{ borderColor: `${mc.ring}33`, color: mc.ring, background: `${mc.ring}12` }}>
              {activePersona.badge}
            </span>
            <Link href="/history"
              className="font-mono text-[10px] rounded px-2 py-1 border transition"
              style={{ borderColor: `${mc.ring}44`, color: '#67e8f9cc', background: 'transparent' }}>
              📜 HISTORY
            </Link>
            {currentUser?.role === 'admin' && (
              <Link href="/users"
                className="font-mono text-[10px] rounded px-2 py-1 border transition"
                style={{ borderColor: '#fbbf2444', color: '#fde68acc', background: 'transparent' }}>
                👥 USERS
              </Link>
            )}
            <button type="button" onClick={() => setShowSettings(s => !s)}
              className="font-mono text-[10px] rounded px-2 py-1 border transition"
              style={{ borderColor: `${mc.ring}44`, color: `${mc.ring}99`, background: showSettings ? `${mc.ring}18` : 'transparent' }}>
              ⚙ SETTINGS
            </button>
            <CollabShare />
            <button type="button" onClick={() => setShowAudit(s => !s)}
              className="font-mono text-[10px] rounded px-2 py-1 border transition"
              style={{ borderColor: `${mc.ring}44`, color: '#f59e0b99', background: showAudit ? 'rgba(245,158,11,0.08)' : 'transparent' }}
              title="View audit log of all tool actions">
              📋 AUDIT
            </button>
            <button type="button" onClick={() => { setShowMarkL(s => !s); if (!showMarkL) setShowSettings(false) }}
              className="font-mono text-[10px] rounded px-2 py-1 border transition"
              style={{ borderColor: showMarkL ? '#00ff88' : `${mc.ring}44`, color: showMarkL ? '#00ff88' : `${mc.ring}88`, background: showMarkL ? 'rgba(0,255,136,0.08)' : 'transparent' }}
              title="Mark-L features panel — 29 capabilities">
              ⚡ MARK-L
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

        {/* ── Permissions banner ── */}
        {showPermissionBanner && (
          <div className="gfai-fade relative z-20 border-b px-4 py-2 font-mono text-[10px]"
            style={{ borderColor: '#ff6b3522', background: 'rgba(255,107,53,0.05)' }}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="gfai-blink h-1.5 w-1.5 rounded-full" style={{ background: '#ff6b35' }} />
                <span style={{ color: '#ff6b35' }}>PERMISSIONS REQUIRED</span>
                <span className="text-blue-400/40">— mic &amp; camera needed for voice and vision</span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void requestAllPermissions()}
                  className="rounded px-3 py-1 border transition text-[10px]"
                  style={{ borderColor: '#ff6b3566', color: '#ff6b35', background: 'rgba(255,107,53,0.1)' }}>
                  GRANT PERMISSIONS
                </button>
                <button type="button" onClick={() => setShowPermissionBanner(false)}
                  className="text-blue-400/40 hover:text-blue-300 transition">✕</button>
              </div>
            </div>
            {permissionError && (
              <p className="mt-1 text-[9px] text-red-400/70">{permissionError}</p>
            )}
            <div className="mt-1 flex items-center gap-4 text-[9px]">
              <span className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full" style={{ background: permissions.mic ? '#00ff88' : '#ff444466' }} />
                <span style={{ color: permissions.mic ? '#00ff88' : 'rgba(255,100,100,0.5)' }}>
                  Microphone {permissions.mic ? '✓' : '✗'}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full" style={{ background: permissions.camera ? '#00ff88' : '#ff444466' }} />
                <span style={{ color: permissions.camera ? '#00ff88' : 'rgba(255,100,100,0.5)' }}>
                  Camera {permissions.camera ? '✓' : '✗'}
                </span>
              </span>
            </div>
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
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${offlineMode ? 'left-7' : 'left-1'}`} />
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
                    onClick={() => void toggleWakeWord()}
                    className={`relative h-6 w-12 rounded-full transition-colors ${hotwordEnabled ? 'bg-blue-600' : 'bg-zinc-700'}`}
                  >
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${hotwordEnabled ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-zinc-300">🎧 Hands-free Conversation</p>
                    <p className="text-xs text-zinc-500">Resume listening after each JARVIS response</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !handsFreeEnabled
                      setHandsFreeEnabled(next)
                      handsFreeEnabledRef.current = next
                      localStorage.setItem('gf_handsfree', String(next))
                      if (!next) listeningRequestedRef.current = false
                    }}
                    className={`relative h-6 w-12 rounded-full transition-colors ${handsFreeEnabled ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                  >
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${handsFreeEnabled ? 'left-7' : 'left-1'}`} />
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
              <div className="min-w-[300px]">
                <p className="text-blue-400/40 tracking-widest mb-1.5">N8N WORKFLOWS</p>
                <div className="flex items-center gap-2 mb-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: n8nReachable === null ? '#f59e0b' : n8nReachable ? '#00ff88' : '#ff4444' }} />
                  <span className="font-mono text-[10px]" style={{ color: n8nConnected ? '#00ff88' : 'rgba(255,100,100,0.5)' }}>
                    {n8nConnected ? `Connected — ${n8nWorkflows.length} workflows` : n8nReachable === false ? 'Unreachable' : 'Disconnected'}
                  </span>
                </div>
                <div className="flex gap-1.5 mb-2">
                  <input
                    type="text"
                    value={n8nUrl}
                    onChange={e => { setN8nUrl(e.target.value); setN8nUrlTouched(true) }}
                    placeholder="http://localhost:5678"
                    className="flex-1 rounded border px-2 py-1 font-mono text-[10px] bg-black/30 outline-none"
                    style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
                  />
                  <button
                    type="button"
                    disabled={n8nConnecting}
                    onClick={async () => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const api = (window as any).electron?.n8n
                      if (!api) { toast('error', 'n8n requires Electron app'); return }
                      setN8nConnecting(true)
                      try {
                        const res = await api.connect(n8nUrl)
                        setN8nConnected(res.connected)
                        if (res.connected) {
                          const wfs = await api.listWorkflows()
                          setN8nWorkflows(wfs)
                          toast('success', `Connected to n8n — ${wfs.length} workflows`)
                        } else {
                          toast('error', 'Cannot connect to n8n — is it running?')
                        }
                      } catch {
                        toast('error', 'n8n connection failed')
                      } finally {
                        setN8nConnecting(false)
                      }
                    }}
                    className="rounded px-2 py-1 border font-mono text-[10px] transition disabled:opacity-40"
                    style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}12` }}>
                    {n8nConnecting ? '...' : 'CONNECT'}
                  </button>
                </div>

                {/* Open n8n Editor button */}
                <button
                  type="button"
                  onClick={() => window.open(n8nUrl, '_blank')}
                  className="w-full rounded border px-3 py-1.5 font-mono text-[10px] transition flex items-center justify-center gap-2 mb-2"
                  style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}18` }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: n8nReachable === true ? '#00ff88' : n8nReachable === false ? '#ff4444' : '#f59e0b' }} />
                  Open n8n Editor
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </button>

                {/* Workflow list with webhook URLs */}
                {n8nConnected && n8nWorkflows.length > 0 && (
                  <div className="rounded border max-h-40 overflow-y-auto mb-2"
                    style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,0,0,0.18)' }}>
                    {n8nWorkflows.map(wf => (
                      <div key={wf.id} className="px-2 py-1.5 border-b last:border-b-0"
                        style={{ borderColor: `${mc.ring}11` }}>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[9px] truncate" style={{ color: wf.active ? '#00ff88' : `${mc.ring}88` }}>
                            {wf.active ? '🟢' : '⚪'} {wf.name}
                          </span>
                          <span className="font-mono text-[8px] text-blue-400/30 shrink-0">{wf.id}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <code
                            className="flex-1 font-mono text-[8px] px-1.5 py-0.5 rounded truncate select-all"
                            style={{ background: 'rgba(0,0,0,0.3)', color: `${mc.ring}cc`, border: `1px solid ${mc.ring}22` }}
                          >
                            {`${n8nUrl}/webhook/ghostforge-${wf.id}`}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              const url = `${n8nUrl}/webhook/ghostforge-${wf.id}`
                              navigator.clipboard.writeText(url).then(() => {
                                setN8nCopiedId(wf.id)
                                toast('success', 'Webhook URL copied')
                                setTimeout(() => setN8nCopiedId(null), 1500)
                              }).catch(() => toast('error', 'Failed to copy'))
                            }}
                            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[8px] transition"
                            style={{
                              borderColor: n8nCopiedId === wf.id ? '#00ff8866' : `${mc.ring}44`,
                              color: n8nCopiedId === wf.id ? '#00ff88' : `${mc.ring}aa`,
                              background: n8nCopiedId === wf.id ? 'rgba(0,255,136,0.1)' : 'transparent',
                              border: `1px solid ${n8nCopiedId === wf.id ? '#00ff8866' : `${mc.ring}44`}`,
                            }}>
                            {n8nCopiedId === wf.id ? '✓' : '⧉'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick Workflow Creator */}
                <div className="rounded border p-2 mb-2" style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,0,0,0.18)' }}>
                  <p className="font-mono text-[9px] tracking-widest text-blue-400/45 mb-1.5">CREATE WORKFLOW</p>
                  <input
                    type="text"
                    value={n8nNewName}
                    onChange={e => setN8nNewName(e.target.value)}
                    placeholder="Workflow name (required)"
                    className="w-full rounded border px-2 py-1 font-mono text-[10px] bg-black/30 outline-none mb-1.5"
                    style={{ borderColor: `${mc.ring}33`, color: mc.ring }}
                  />
                  <select
                    value={n8nNewType}
                    onChange={e => setN8nNewType(e.target.value as typeof n8nNewType)}
                    className="w-full rounded border px-2 py-1 font-mono text-[10px] bg-black/30 outline-none mb-1.5"
                    style={{ borderColor: `${mc.ring}33`, color: mc.ring }}>
                    <option value="deploy">🚀 Deploy — webhook + HTTP request</option>
                    <option value="notify">📢 Notify — webhook + email/Slack</option>
                    <option value="pr">🔀 PR Review — webhook + GitHub</option>
                    <option value="custom">⚙ Custom — webhook only</option>
                  </select>
                  <input
                    type="text"
                    value={n8nNewDesc}
                    onChange={e => setN8nNewDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="w-full rounded border px-2 py-1 font-mono text-[10px] bg-black/30 outline-none mb-1.5"
                    style={{ borderColor: `${mc.ring}33`, color: mc.ring }}
                  />
                  <button
                    type="button"
                    disabled={!n8nNewName.trim() || n8nCreating || !n8nConnected}
                    onClick={async () => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const api = (window as any).electron?.n8n
                      if (!api) { toast('error', 'n8n requires Electron app'); return }
                      setN8nCreating(true)
                      try {
                        const res = await api.createWorkflow({
                          name: n8nNewName.trim(),
                          type: n8nNewType,
                          description: n8nNewDesc.trim(),
                        })
                        if (res?.id) {
                          toast('success', `Workflow "${n8nNewName.trim()}" created — ${n8nUrl}/webhook/ghostforge-${res.id}`)
                        } else {
                          toast('success', `Workflow "${n8nNewName.trim()}" created`)
                        }
                        setN8nNewName('')
                        setN8nNewDesc('')
                        if (n8nConnected) {
                          const wfs = await api.listWorkflows()
                          setN8nWorkflows(wfs)
                        }
                      } catch (e) {
                        toast('error', `Create failed: ${(e as Error).message || 'unknown error'}`)
                      } finally {
                        setN8nCreating(false)
                      }
                    }}
                    className="w-full rounded px-2 py-1 border font-mono text-[10px] transition disabled:opacity-40"
                    style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}12` }}>
                    {n8nCreating ? 'CREATING…' : '+ CREATE'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'DEPLOY', action: 'deploy', icon: '🚀' },
                    { label: 'NOTIFY', action: 'notify', icon: '📢' },
                    { label: 'PR', action: 'pr', icon: '🔀' },
                    { label: 'IMPORT', action: 'import', icon: '📥' },
                  ].map(btn => (
                    <button
                      key={btn.action}
                      type="button"
                      disabled={!n8nConnected}
                      onClick={async () => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const api = (window as any).electron?.n8n
                        if (!api) { toast('error', 'n8n requires Electron app'); return }
                        if (btn.action === 'import') {
                          const res = await api.importWorkflows()
                          toast('success', `Imported ${res.count} workflows`)
                          if (n8nConnected) {
                            const wfs = await api.listWorkflows()
                            setN8nWorkflows(wfs)
                          }
                          return
                        }
                        if (btn.action === 'deploy') {
                          await api.deploy('deploy', 'ghostforge')
                          toast('success', 'Deploy workflow triggered')
                          return
                        }
                        if (btn.action === 'notify') {
                          await api.notify('general', 'Test notification from JARVIS', 'medium')
                          toast('success', 'Notify workflow triggered')
                          return
                        }
                        if (btn.action === 'pr') {
                          await api.pr('review', 1, 'ghostforge/ghostforge-agents')
                          toast('success', 'PR workflow triggered')
                          return
                        }
                      }}
                      className="rounded px-2 py-1 border font-mono text-[9px] transition disabled:opacity-30"
                      style={{ borderColor: `${mc.ring}33`, color: `${mc.ring}cc`, background: `${mc.ring}08` }}>
                      {btn.icon} {btn.label}
                    </button>
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

          {/* ── Mark-L Panel (overlay) ── */}
          {showMarkL && (
            <div className="absolute inset-y-0 left-0 z-30 w-72 overflow-y-auto border-r p-3 gfai-fade gfai-scroll"
              style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.96)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] tracking-widest" style={{ color: mc.ring }}>⚡ MARK-L</span>
                <button type="button" onClick={() => setShowMarkL(false)}
                  className="text-blue-400/50 hover:text-blue-300 transition text-[10px]">✕</button>
              </div>
              <MarkLPanel
                onRunAction={(prompt, id) => void sendToJarvis(prompt, id)}
                disabled={mode === 'thinking' || mode === 'listening'}
                ringColor={mc.ring}
              />
              {/* Mark-LIV engine registry — mirrors vendor/mark-liv actions */}
              <div className="mt-4 border-t pt-3" style={{ borderColor: `${mc.ring}22` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[10px] tracking-widest" style={{ color: mc.ring }}>🧠 MARK-LIV ENGINE</span>
                  <span className="rounded px-1.5 py-0.5 text-[8px]" style={{ background: `${mc.ring}18`, color: mc.ring }}>20 TOOLS</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {MARK_LIV_ACTIONS.map(action => (
                    <button
                      key={action.id}
                      type="button"
                      title={action.description}
                      onClick={() => void sendToJarvis(action.prompt, action.id)}
                      disabled={mode === 'thinking' || mode === 'listening'}
                      className="rounded border px-2 py-1 text-start text-[9px] transition disabled:opacity-30"
                      style={{ borderColor: `${mc.ring}22`, color: `${mc.ring}99`, background: `${mc.ring}08` }}
                    >
                      {action.icon} {action.label}
                      {action.scope === 'device' && <span className="ms-1 text-[7px] opacity-50">⚙</span>}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[8px] leading-snug" style={{ color: `${mc.ring}55` }}>
                  ⚙ = needs bridge / desktop engine (scripts/mark-liv.sh start)
                </p>
              </div>

              {/* OpenJarvis — local-first agent framework (opt-in, Apache-2.0) */}
              <div className="mt-4 border-t pt-3" style={{ borderColor: `${mc.ring}22` }}>
                <OpenJarvisPanel ringColor={mc.ring} />
              </div>
            </div>
          )}

          {/* ── Agent Dashboard Panel (overlay) ── */}
          {showAgent && (
            <div className="absolute inset-y-0 left-0 z-30 w-[min(640px,85vw)] overflow-y-auto border-r gfai-fade"
              style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.98)' }}>
              <div className="flex items-center justify-between px-4 py-2 border-b sticky top-0 z-10"
                style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.98)' }}>
                <span className="font-mono text-[10px] tracking-widest" style={{ color: mc.ring }}>🤖 AUTONOMOUS AGENT</span>
                <button type="button" onClick={() => setShowAgent(false)}
                  className="text-blue-400/50 hover:text-blue-300 transition text-[10px]">✕ CLOSE</button>
              </div>
              <div className="p-3" style={{ height: 'calc(100% - 40px)' }}>
                <AgentDashboard
                  onStart={() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const api = (window as any).electron?.autonomousAgent
                    if (api) {
                      api.start({}).then(() => {
                        toast('success', '🤖 Agent started')
                        setAgentStatus('MONITORING')
                      }).catch(() => toast('error', 'Failed to start agent'))
                    } else {
                      toast('error', 'Agent requires Electron app')
                    }
                  }}
                  onStop={() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const api = (window as any).electron?.autonomousAgent
                    if (api) {
                      api.stop().then(() => {
                        toast('info', '🤖 Agent stopped')
                        setAgentStatus('IDLE')
                      }).catch(() => toast('error', 'Failed to stop agent'))
                    }
                  }}
                  onPause={() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const api = (window as any).electron?.autonomousAgent
                    if (api) {
                      api.pause().then(() => {
                        toast('info', '🤖 Agent paused')
                        setAgentStatus('PAUSED')
                      }).catch(() => toast('error', 'Failed to pause agent'))
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Left panel ── */}
          <div className="hidden md:flex w-44 shrink-0 flex-col gap-3 border-r p-3 font-mono text-[10px]"
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
                { label: 'N8N', val: n8nConnected ? `${n8nWorkflows.length} WF` : 'OFF', ok: n8nConnected },
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

          {/* ── Center ── */}
          <div className="flex flex-1 flex-col items-center overflow-hidden">

            {/* Messages */}
            <div className="gfai-scroll flex-1 w-full max-w-2xl overflow-y-auto px-4 py-3 space-y-2">
              {messages.map(m => {
                const borderColor = m.role === 'user' ? '#1a6fff' : (m.emotion === 'alert' ? '#ff4444' : mc.ring)
                return (
                  <div key={m.id}
                    className={`gfai-fade rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'gfai-msg-user ms-8' : 'gfai-msg-ai me-8'}`}
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
                  mode === 'listening' ? stopListening :
                  mode === 'idle' ? () => { void startListening() } : undefined
                }
                disabled={mode === 'thinking'}
                className="relative cursor-pointer disabled:cursor-wait transition-transform active:scale-95"
                style={{
                  filter: `drop-shadow(0 0 24px ${mc.glow})`,
                  animation: mode === 'listening' ? 'orbPulse 1.5s ease-in-out infinite' : 'none',
                }}
                title={
                  mode === 'idle' ? 'Click to speak (or say "Hey GhostForge")' :
                  mode === 'listening' ? 'Listening… click to stop' :
                  mode === 'speaking' ? 'Click to stop speaking' : 'Processing…'
                }
              >
                <OrbSVG mode={mode} audioLevel={audioLevel} />
              </button>

              <HardwareMetrics isMobile={platform.isMobile} />

              {/* Voice controls */}
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

                {interruptFlash && (
                <div className="gfai-fade font-mono text-[11px] tracking-widest text-yellow-300">
                  ⚡ Interrupted
                </div>
              )}
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="shrink-0 w-full max-w-2xl px-4 pb-4 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => { markActivity(); setInput(e.target.value) }}
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
              <button type="button"
                onClick={handlePushToTalk}
                disabled={visionPending || mode === 'thinking'}
                title="Screen capture + Vision (Ctrl+Option)"
                className="shrink-0 rounded-lg border px-3 py-2.5 font-mono text-xs transition disabled:opacity-30 active:scale-95"
                style={{
                  borderColor: pushToTalkActive ? '#22c55e' : `${mc.ring}44`,
                  color: pushToTalkActive ? '#22c55e' : `${mc.ring}88`,
                  background: pushToTalkActive ? 'rgba(34,197,94,0.15)' : `${mc.ring}08`,
                }}>
                {visionPending ? '◎' : '◉'}
              </button>
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
          <span>{offlineMode ? 'OFFLINE · LOCAL ONLY · SECURE' : 'PRIVATE · LOCAL · SECURE'}</span>
        </div>

        {/* Toast container */}
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        {clipboardPanel.visible && (
          <ClipboardPanel
            text={clipboardPanel.text}
            onAction={sendClipboardAction}
            onClose={() => setClipboardPanel(prev => ({ ...prev, visible: false }))}
          />
        )}
        {/* Clicky blue cursor overlay */}
        <ClickyOverlay
          point={clickyPoint}
          highlight={clickyHighlight}
        />
      </div>
    </>
  )
}
