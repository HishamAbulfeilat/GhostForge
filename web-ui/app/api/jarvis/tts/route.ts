import { NextRequest, NextResponse } from 'next/server'

// ── Fish Audio — JARVIS voice model ───────────────────────────────────────────

async function fishAudioTTS(text: string, voiceId: string, apiKey: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        reference_id: voiceId,
        model: 's2.1-pro-free',   // in body (not header) — fixes 400 Bad Request
        format: 'mp3',
        mp3_bitrate: 128,
        temperature: 0.65,
        top_p: 0.7,
        prosody: { speed: 0.92, volume: 0, normalize_loudness: true },
        latency: 'normal',
        repetition_penalty: 1.2,
        chunk_length: 300,
        normalize: true,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[Fish Audio] ${res.status}:`, body.slice(0, 200))
      return null
    }

    return res.arrayBuffer()
  } catch (e) {
    console.error('[Fish Audio] request failed:', e)
    return null
  }
}

// ── ElevenLabs voices ─────────────────────────────────────────────────────────

const ELEVENLABS_VOICES: Record<string, string> = {
  adam:   'pNInz6obpgDQGcFmaJgB',
  daniel: 'onwK4e9ZLuTAKqWW03F9',
  josh:   'TxGEqnHWrfWFTfGW9XjX',
}

async function elevenLabsTTS(text: string, voiceKey: string, apiKey: string): Promise<ArrayBuffer | null> {
  const voiceId = ELEVENLABS_VOICES[voiceKey] || ELEVENLABS_VOICES.adam
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.15, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[ElevenLabs] ${res.status}:`, errBody.slice(0, 200))
      return null
    }
    return res.arrayBuffer()
  } catch {
    return null
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { text?: string; voice?: string; engine?: string }
  try { body = await req.json() } catch { body = {} }
  const { text = '', voice = 'jarvis', engine } = body

  if (!text.trim()) return NextResponse.json({ error: 'No text' }, { status: 400 })

  // Truncate very long texts to avoid slow TTS
  const ttsText = text.trim().slice(0, 500)

  const fishKey  = process.env.FISH_AUDIO_API_KEY
  const elKey    = process.env.ELEVENLABS_API_KEY
  const jarvisId = process.env.FISH_AUDIO_JARVIS_MODEL || '612b878b113047d9a770c069c8b4fdfe'

  // Explicit engine override
  if ((engine === 'fish' || engine === 'fish-audio') && fishKey) {
    const audio = await fishAudioTTS(ttsText, jarvisId, fishKey)
    if (audio) return new NextResponse(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-TTS-Engine': 'fish-audio' } })
  }
  if (engine === 'elevenlabs' && elKey) {
    const audio = await elevenLabsTTS(ttsText, voice, elKey)
    if (audio) return new NextResponse(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-TTS-Engine': 'elevenlabs' } })
  }
  // 'browser' requested but still try cloud first if keys available
  // Only pure browser-only if no API keys configured at all

  // Auto chain: Fish Audio → ElevenLabs → browser fallback
  if (fishKey) {
    const audio = await fishAudioTTS(ttsText, jarvisId, fishKey)
    if (audio) return new NextResponse(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-TTS-Engine': 'fish-audio' } })
  }

  if (elKey) {
    const audio = await elevenLabsTTS(ttsText, 'adam', elKey)
    if (audio) return new NextResponse(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-TTS-Engine': 'elevenlabs' } })
  }

  // No TTS keys configured — fall back to browser Web Speech API
  return NextResponse.json({
    fallback: true,
    reason: fishKey ? 'fish_audio_error' : elKey ? 'elevenlabs_error' : 'no_keys',
    hint: fishKey || elKey ? 'TTS API temporarily unavailable' : 'Add FISH_AUDIO_API_KEY or ELEVENLABS_API_KEY to .env.local',
  })
}
