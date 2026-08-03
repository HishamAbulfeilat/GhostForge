import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'
import { localStt } from '@/lib/voice'

export const dynamic = 'force-dynamic'

/**
 * Local STT endpoint — accepts raw audio (webm/wav/mp3) bytes and returns the
 * transcribed text from the local voice pipeline. Falls back to a friendly
 * 503 so the client can switch to the Web Speech API.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ct = req.headers.get('content-type') || ''
  const lang = req.headers.get('x-language') || undefined
  const engine = req.headers.get('x-engine') || undefined

  const body = Buffer.from(await req.arrayBuffer())
  if (!body.length) return NextResponse.json({ error: 'No audio' }, { status: 400 })

  // Clients post raw audio bytes (wav/webm/ogg). The local pipeline normalizes
  // whatever we forward; the leading MIME type is only used for logging.
  void ct

  const result = await localStt(body, { language: lang || undefined, engine: engine || undefined })

  if (result.error || !result.text) {
    return NextResponse.json(
      {
        fallback: true,
        reason: 'local_stt_unavailable',
        error: result.error || 'No transcription',
        hint: 'Start voice-pipeline/start.sh and install faster-whisper for local STT; otherwise Web Speech API will be used.',
      },
      { status: 503 },
    )
  }

  return NextResponse.json({ text: result.text, engine: result.engine })
}