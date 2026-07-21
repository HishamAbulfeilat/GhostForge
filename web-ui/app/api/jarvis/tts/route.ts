import { NextRequest, NextResponse } from 'next/server'

// ElevenLabs voice IDs (free tier)
const VOICES: Record<string, string> = {
  adam:   'pNInz6obpgDQGcFmaJgB', // Deep, professional — most JARVIS-like
  daniel: 'onwK4e9ZLuTAKqWW03F9', // British male
  josh:   'TxGEqnHWrfWFTfGW9XjX', // Young American male
  arnold: 'VR6AewLTigWG4xSOukaG', // Confident American male
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ fallback: true, reason: 'no_key' })
  }

  let body: { text?: string; voice?: string }
  try { body = await req.json() } catch { body = {} }
  const { text = '', voice = 'adam' } = body

  if (!text.trim()) {
    return NextResponse.json({ error: 'No text' }, { status: 400 })
  }

  const voiceId = VOICES[voice] || VOICES.adam

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
      const errText = await res.text().catch(() => '')
      if (res.status === 401) return NextResponse.json({ fallback: true, reason: 'invalid_key' })
      if (res.status === 429) return NextResponse.json({ fallback: true, reason: 'quota_exceeded' })
      console.error('[TTS] ElevenLabs error:', res.status, errText)
      return NextResponse.json({ fallback: true, reason: 'api_error' })
    }

    const audio = await res.arrayBuffer()
    return new NextResponse(audio, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('[TTS] fetch error:', e)
    return NextResponse.json({ fallback: true, reason: 'network_error' })
  }
}
