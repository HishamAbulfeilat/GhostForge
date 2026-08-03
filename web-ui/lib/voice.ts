import { getLiveBridgeToken } from '@/lib/bridge-token'

export const VOICE_URL = process.env.GHOSTFORGE_VOICE_URL ?? 'http://localhost:8766'

function voiceToken(): string {
  return getLiveBridgeToken()
}

function headers(json = false): Record<string, string> {
  return {
    'X-Bridge-Token': voiceToken(),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

export interface VoiceHealth {
  ok: boolean
  service?: string
  version?: string
  stt?: Record<string, boolean>
  tts?: Record<string, boolean>
  wake?: Record<string, unknown>
}

/** Whether the local voice pipeline is up (non-throwing). */
export async function getVoiceHealth(timeoutMs = 1500): Promise<VoiceHealth> {
  try {
    const res = await fetch(`${VOICE_URL}/api/voice/health`, {
      headers: headers(),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as VoiceHealth
    return { ...data, ok: true }
  } catch {
    return { ok: false }
  }
}

export interface SttResult {
  text?: string
  engine?: string
  error?: string
}

/**
 * Transcribe local audio bytes. Resolves { text, engine } on success, or an
 * { error } when the voice pipeline is down / no STT engine installed — the
 * caller is expected to degrade to cloud STT or Web Speech.
 */
export async function localStt(
  audio: Buffer | Uint8Array,
  opts: { language?: string; engine?: string } = {},
): Promise<SttResult> {
  try {
    const body = new FormData()
    const blob = new Blob([audio as BlobPart])
    body.append('audio', blob, 'audio.webm')
    if (opts.language) body.append('language', opts.language)
    if (opts.engine) body.append('engine', opts.engine)

    const res = await fetch(`${VOICE_URL}/api/voice/stt`, {
      method: 'POST',
      headers: { 'X-Bridge-Token': voiceToken() },
      body,
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { detail?: string } | null
      return { error: detail?.detail || `STT failed (${res.status})` }
    }
    const data = (await res.json()) as { text?: string; engine?: string }
    if (!data.text) return { error: 'STT returned no text' }
    return { text: data.text, engine: data.engine }
  } catch (e) {
    return { error: (e as Error).message || 'STT request failed' }
  }
}

export interface TtsResult {
  audio?: Buffer
  engine?: string
  error?: string
}

/**
 * Synthesize speech locally. Returns audio bytes or an { error } so the
 * caller can fall back to cloud TTS / browser Web Speech.
 */
export async function localTts(
  text: string,
  opts: { voice?: string; engine?: string } = {},
): Promise<TtsResult> {
  try {
    const res = await fetch(`${VOICE_URL}/api/voice/tts`, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({
        text: text.trim().slice(0, 500),
        ...(opts.voice ? { voice: opts.voice } : {}),
        ...(opts.engine ? { engine: opts.engine } : {}),
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { detail?: string } | null
      return { error: detail?.detail || `TTS failed (${res.status})` }
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    return { audio: buffer, engine: res.headers.get('X-TTS-Engine') || undefined }
  } catch (e) {
    return { error: (e as Error).message || 'TTS request failed' }
  }
}

/** Human-readable health summary for JARVIS tool output. */
export async function formatVoiceStatus(): Promise<string> {
  const health = await getVoiceHealth(2000)
  if (!health.ok) {
    return 'Local voice pipeline is offline (port 8766). Start it with voice-pipeline/start.sh. Cloud STT/TTS still works.'
  }
  const sttOn = Object.entries(health.stt || {}).filter(([, v]) => v).map(([k]) => k)
  const ttsOn = Object.entries(health.tts || {}).filter(([, v]) => v).map(([k]) => k)
  const wake = health.wake?.installed ? (health.wake.model_ready ? 'ready' : 'model missing') : 'not installed'
  const parts = [
    `STT: ${sttOn.length ? sttOn.join(', ') : 'none installed (cloud STT active)'}`,
    `TTS: ${ttsOn.length ? ttsOn.join(', ') : 'none (macOS say / cloud active)'}`,
    `Wake word: ${wake}`,
  ]
  return `Local voice pipeline online (v${health.version}):\n${parts.map(p => `  • ${p}`).join('\n')}`
}
