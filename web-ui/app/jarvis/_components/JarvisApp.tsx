'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import LLMfitAutoSwitch from '@/components/LLMfitAutoSwitch'
import { usePlatform, detectLanguage, getSpeechLang } from '@/lib/platform'
import { collectRecognitionTranscript, findWakePhrase } from '@/lib/voice-runtime'
import { JARVIS_QUICK_ACTIONS } from '@/lib/quick-actions'
import {
  getSR, GREETINGS, MODE_COLORS, PERSONA_OPTIONS,
  type Any, type Emotion, type HistoryPayloadSession, type HostCapabilities,
  type Memory, type Message, type Mode, type ModelInfo, type MorningBriefingResponse, type Toast, type TtsInfo, type VoiceEngine,
} from './types'
import LiveOrb from './LiveOrb'
import ToastHost from './ToastHost'
import ClipboardWatcher from './ClipboardWatcher'
import InboxWatcher, { type InboxMessage } from './InboxWatcher'
import { createStore } from './store'
import HardwareMetrics from './HardwareMetrics'
import TopBar from './TopBar'
import CopilotBanner from './CopilotBanner'
import PermissionBanner from './PermissionBanner'
import SystemsPanel from './SystemsPanel'
import MessageList from './MessageList'
import VoiceControls from './VoiceControls'
import QuickCommandsPanel from './QuickCommandsPanel'
import StatusBar from './StatusBar'
import { useN8nConnection } from './useN8nConnection'

// Panels that open on demand and the Clicky screen-capture overlay load as
// separate chunks after the page is interactive. Voice enrollment (mic
// recording) loads inside SettingsPanel the same way.
const SettingsPanel = dynamic(() => import('./SettingsPanel'), { ssr: false })
const AuditPanel = dynamic(() => import('./AuditPanel'), { ssr: false })
const MarkLOverlay = dynamic(() => import('./MarkLOverlay'), { ssr: false })
const AgentOverlay = dynamic(() => import('./AgentOverlay'), { ssr: false })
const ClickyOverlay = dynamic(() => import('@/components/ClickyOverlay'), { ssr: false })

// ── JARVIS client app ─────────────────────────────────────────────────────────

export default function JarvisApp() {
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
  const [toasts] = useState(() => createStore<Toast[]>([]))
  const [copilotMode, setCopilotMode]       = useState(false)
  const [pendingRiskMsg, setPendingRiskMsg] = useState<{ message: string; tool: string } | null>(null)
  const [speechLang, setSpeechLang]         = useState('en-US')
  const [detectedLang, setDetectedLang]     = useState('en')
  const [interruptFlash, setInterruptFlash] = useState(false)
  // ── Clicky state ──────────────────────────────────────────────────────────────
  const [clickyPoint, setClickyPoint] = useState<{ x: number; y: number; label?: string | null } | null>(null)
  const [clickyHighlight, setClickyHighlight] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [pushToTalkActive, setPushToTalkActive] = useState(false)
  const [visionPending, setVisionPending] = useState(false)
  const pushToTalkRef = useRef(false)
  const [audioLevel] = useState(() => createStore(0))
  const [showMarkL, setShowMarkL] = useState(false)
  const [bridgeStatus, setBridgeStatus] = useState<string>('stopped')
  // ── n8n workflow state ───────────────────────────────────────────────────────
  const n8n = useN8nConnection()
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
  const lastActivityRef    = useRef<number | null>(null)
  if (lastActivityRef.current === null) lastActivityRef.current = Date.now()
  const proactiveTriggeredRef = useRef(false)
  const proactiveTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionIdRef       = useRef<string | null>(null)
  if (sessionIdRef.current === null) sessionIdRef.current = `jarvis-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const sessionStartedAtRef = useRef<string | null>(null)
  if (sessionStartedAtRef.current === null) sessionStartedAtRef.current = new Date().toISOString()
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
      id: sessionIdRef.current!,
      startedAt: sessionStartedAtRef.current!,
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
    toasts.set(prev => [...prev, { id, type, msg }])
    setTimeout(() => toasts.set(prev => prev.filter(t => t.id !== id)), duration)
  }, [toasts])

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
        audioLevel.set(sum / bins / 255) // 0..1
        audioAnimFrameRef.current = requestAnimationFrame(tick)
      }
      audioAnimFrameRef.current = requestAnimationFrame(tick)
    } catch {
      // Mic access denied — no visual feedback, but still works
    }
  }, [audioLevel])

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
    audioLevel.set(0)
  }, [audioLevel])

  // ── Mic pause/resume — stop listening while JARVIS thinks/speaks (prevents echo) ──

  const pauseMic = useCallback(() => {
    if (micPausedRef.current) return
    micPausedRef.current = true
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch { /* already stopped */ }
      recognitionRef.current = null
    }
    releaseMicStream()
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

  const stopSpeaking = useCallback(() => {
    stopCurrentAudio()
    resumeMic()
    setMode('idle')
  }, [resumeMic, stopCurrentAudio])

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

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electron?.bridgeManager
    if (!api) return
    api.getStatus().then((res: { status: string }) => setBridgeStatus(res.status)).catch(() => {})
    api.onStatusChange((status: string) => setBridgeStatus(status))
  }, [])

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
      if (event.type === 'mousemove' && Date.now() - (lastActivityRef.current ?? 0) < 30_000) return
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
  }, [stopSpeaking])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const addAIMessage = useCallback((text: string, emotion: Emotion, tool: string | null, toolResult: string | null, usedModel?: string, domain?: string, confidence?: number, risk?: Message['risk'], requiresConfirmation?: boolean) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', text, emotion, tool, toolResult, usedModel, domain, confidence, risk, requiresConfirmation, ts: Date.now() }])
  }, [])

  const addUserMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text, ts: Date.now() }])
  }, [])

  const handleInboxMessage = useCallback((m: InboxMessage) => {
    const who = m.from ? ` from ${m.from}` : ''
    toast('info', `📨 Message${who}: ${m.text}`, 8000)
    addAIMessage(`📨 New message${who}: ${m.text}`, 'happy', null, null)
  }, [toast, addAIMessage])

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
      try {
        await audio.play()
      } catch (playErr) {
        cleanup()
        throw playErr
      }
      return { ok: true, usedEngine: actualEngine }
    } catch {
      ttsFailCountRef.current += 1
      resumeMic()
      return { ok: false, usedEngine: '' }
    }
  }, [voiceEngine, toast, pauseMic, resumeMic, stopCurrentAudio, persistVoiceEngine])

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
        try {
          await audio.play()
        } catch (playErr) {
          cleanup()
          throw playErr
        }
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
      try {
        await audio.play()
      } catch (playErr) {
        cleanup()
        throw playErr
      }
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
      const silenceMs = Date.now() - (lastActivityRef.current ?? 0)
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
          return result.image
        }
        return null
      }
      const res = await fetch('/api/jarvis/screen-capture', { method: 'POST' })
      const data = await res.json() as { image?: string; error?: string }
      if (data.image) {
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
  }, [captureScreen, memory, persona, addAIMessage, speak, handleClickyToolResult, toast])

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
  }, [messages, memory, selectedProvider, selectedModel, persona, offlineMode, copilotMode, detectedLang, platform.type, pendingRiskMsg, sendToCopilot, addUserMessage, addAIMessage, speak, toast, pauseMic, resumeMic, markActivity, recordModelResponse, handleClickyToolResult])

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

        const currentResult = e.results[e.results.length - 1]
        const delay = currentResult?.isFinal ? 350 : 1100
        silenceTimer = setTimeout(() => {
          silenceTimer = null
          const captured = latestTranscript.trim()
          if (!captured) return
          listeningRequestedRef.current = handsFreeEnabledRef.current
          setInput('')
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
  }, [startWakeListener, toast])

  // ── Form submit ───────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    markActivity()
    void sendToJarvis(input)
    setInput('')
  }

  const sendToJarvisRef = useRef(sendToJarvis)
  useEffect(() => { sendToJarvisRef.current = sendToJarvis }, [sendToJarvis])
  const handleClipboardPrompt = useCallback((prompt: string) => {
    markActivity()
    setInput('')
    void sendToJarvisRef.current(prompt)
  }, [markActivity])

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
        <TopBar
          mc={mc} mode={mode} lastToolUsed={lastToolUsed} currentUser={currentUser} memory={memory}
          platform={platform} detectedLang={detectedLang} activePersona={activePersona}
          showSettings={showSettings} setShowSettings={setShowSettings}
          showAudit={showAudit} setShowAudit={setShowAudit}
          showMarkL={showMarkL} setShowMarkL={setShowMarkL}
          copilotMode={copilotMode} setCopilotMode={setCopilotMode} toast={toast}
        />

        {/* ── Copilot CLI mode banner ── */}
        {copilotMode && (
          <CopilotBanner setCopilotMode={setCopilotMode} toast={toast} />
        )}

        {/* ── Permissions banner ── */}
        {showPermissionBanner && (
          <PermissionBanner
            permissions={permissions} permissionError={permissionError}
            requestAllPermissions={requestAllPermissions} setShowPermissionBanner={setShowPermissionBanner}
          />
        )}

        {/* ── Settings panel (collapsible) ── */}
        {showSettings && (
          <SettingsPanel
            mc={mc} toast={toast} models={models} liveModel={liveModel}
            offlineMode={offlineMode} setOfflineMode={setOfflineMode}
            selectedProvider={selectedProvider} setSelectedProvider={setSelectedProvider}
            selectedModel={selectedModel} setSelectedModel={setSelectedModel}
            persona={persona} setPersona={setPersona}
            hotwordEnabled={hotwordEnabled} toggleWakeWord={toggleWakeWord}
            handsFreeEnabled={handsFreeEnabled} setHandsFreeEnabled={setHandsFreeEnabled}
            handsFreeEnabledRef={handsFreeEnabledRef} listeningRequestedRef={listeningRequestedRef}
            ttsInfo={ttsInfo} voiceEngine={voiceEngine} persistVoiceEngine={persistVoiceEngine} ttsFailCountRef={ttsFailCountRef}
            integrations={integrations} n8n={n8n}
          />
        )}

        {/* ── Audit Log Panel ── */}
        {showAudit && (
          <AuditPanel onClose={() => setShowAudit(false)} />
        )}

        {/* ── Main body ── */}
        <div className="relative z-10 flex flex-1 overflow-hidden">

          {/* ── Mark-L Panel (overlay) ── */}
          {showMarkL && (
            <MarkLOverlay mc={mc} mode={mode} sendToJarvis={sendToJarvis} setShowMarkL={setShowMarkL} />
          )}

          {/* ── Agent Dashboard Panel (overlay) ── */}
          {showAgent && (
            <AgentOverlay mc={mc} toast={toast} setShowAgent={setShowAgent} setAgentStatus={setAgentStatus} />
          )}

          {/* ── Left panel ── */}
          <SystemsPanel
            mc={mc} liveModel={liveModel} hostCapabilities={hostCapabilities} platform={platform} memory={memory}
            geminiVoiceMode={geminiVoiceMode} geminiConnectionState={geminiConnectionState} voiceEngine={voiceEngine}
            voiceSupported={voiceSupported} hotwordEnabled={hotwordEnabled} wakeWordActive={wakeWordActive}
            integrations={integrations} bridgeStatus={bridgeStatus} n8nConnected={n8n.n8nConnected}
            n8nWorkflowCount={n8n.n8nWorkflows.length} agentStatus={agentStatus}
          />

          {/* ── Center ── */}
          <div className="flex flex-1 flex-col items-center overflow-hidden">

            {/* Messages */}
            <MessageList messages={messages} ringColor={mc.ring} />

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
                <LiveOrb mode={mode} audioLevel={audioLevel} />
              </button>

              <HardwareMetrics isMobile={platform.isMobile} />

              {/* Voice controls */}
              <VoiceControls
                mc={mc} mode={mode} toast={toast} voiceSupported={voiceSupported}
                geminiConnectionState={geminiConnectionState} geminiVoiceMode={geminiVoiceMode}
                geminiPlayActive={geminiPlayActive} geminiTranscript={geminiTranscript} geminiListening={geminiListening}
                hotwordEnabled={hotwordEnabled} wakeWordActive={wakeWordActive}
                startListening={startListening} stopListening={stopListening}
                toggleWakeWord={toggleWakeWord} stopSpeaking={stopSpeaking}
              />

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
          <QuickCommandsPanel
            mc={mc} mode={mode} QUICK_COMMANDS={QUICK_COMMANDS} sendToJarvis={sendToJarvis}
            showAgent={showAgent} setShowAgent={setShowAgent}
            agentStatus={agentStatus} agentCurrentTask={agentCurrentTask} agentIssueCount={agentIssueCount}
          />
        </div>

        {/* ── Bottom HUD bar ── */}
        <StatusBar
          mc={mc} liveModel={liveModel} selectedProvider={selectedProvider} selectedModel={selectedModel}
          activeModel={activeModel} offlineMode={offlineMode}
        />

        {/* Toast container */}
        <ToastHost toasts={toasts} />
        <ClipboardWatcher enabled={!platform.isMobile} onPrompt={handleClipboardPrompt} />
        <InboxWatcher onMessage={handleInboxMessage} />
        {/* Clicky blue cursor overlay */}
        <ClickyOverlay
          point={clickyPoint}
          highlight={clickyHighlight}
        />
      </div>
    </>
  )
}
