// Shared types and constants for the JARVIS page and its client components.

// Web Speech API type shims
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any
export const getSR = (): (new () => Any) | null => {
  if (typeof window === 'undefined') return null
   
  const w = window as Any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type Mode = 'idle' | 'listening' | 'thinking' | 'speaking'
export type Emotion = 'neutral' | 'happy' | 'thinking' | 'alert' | 'processing' | 'done'
export type VoiceEngine = 'browser' | 'elevenlabs' | 'fish-audio'

export interface HostCapabilities {
  platform: string
  macControl: boolean
  screenCapture: boolean
  browserControl: boolean
  shell: boolean
  remoteClientControl: boolean
  freeLocalAI: boolean
}

export interface Message {
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

export interface Memory {
  userName: string
  preferences: { city: string; music: string }
  facts: string[]
  conversationCount: number
}

export interface HistoryPayloadMessage {
  role: 'user' | 'ai'
  content: string
  ts: number
}

export interface HistoryPayloadSession {
  id: string
  startedAt: string
  endedAt: string
  messages: HistoryPayloadMessage[]
}

export interface ModelInfo {
  provider: string; id: string; label: string; free: boolean; available: boolean
}

export interface TtsInfo {
  engine: VoiceEngine; fishAudio: boolean; elevenLabs: boolean; jarvisVoice: boolean; jarvisModelId: string
}

export interface Toast {
  id: string; type: 'info' | 'warn' | 'error' | 'success'; msg: string
}

export interface ClipboardPanelState {
  text: string
  visible: boolean
}

export interface MorningBriefingResponse {
  greeting: string
  weather: string
  news: string[]
  time: string
  advice: string
}

// ── Orb colors ────────────────────────────────────────────────────────────────

export const MODE_COLORS: Record<Mode, { ring: string; glow: string }> = {
  idle:      { ring: '#1a6fff', glow: 'rgba(26,111,255,0.25)' },
  listening: { ring: '#00ff88', glow: 'rgba(0,255,136,0.30)' },
  thinking:  { ring: '#ffaa00', glow: 'rgba(255,170,0,0.28)'  },
  speaking:  { ring: '#aa44ff', glow: 'rgba(170,68,255,0.28)' },
}

export const GREETINGS = [
  'All systems operational.',
  'Systems fully operational.',
  "Ready for your command.",
  'Initialized. Standing by.',
]

export const PERSONA_OPTIONS = [
  { id: 'default', label: '🤖 Default', desc: 'Standard JARVIS', badge: 'DEFAULT' },
  { id: 'dev', label: '👨‍💻 Dev', desc: 'Senior engineer', badge: 'DEV' },
  { id: 'manager', label: '📋 Manager', desc: 'Tech lead', badge: 'MANAGER' },
  { id: 'creative', label: '🎨 Creative', desc: 'Brainstorm mode', badge: 'CREATIVE' },
  { id: 'security', label: '🔒 Security', desc: 'Security focus', badge: 'SECURITY' },
] as const
