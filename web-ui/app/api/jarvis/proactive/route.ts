import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { generateWithFallback } from '@/lib/ai'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

interface JarvisMemory {
  userName: string
  preferences?: { city?: string; music?: string; language?: string }
}

const MEMORY_FILE = join(homedir(), '.ghostforge', 'jarvis', 'memory.json')
const MIN_SILENCE_MS = 15 * 60 * 1000

async function readMemory(): Promise<JarvisMemory | null> {
  try {
    const raw = await readFile(MEMORY_FILE, 'utf8')
    return JSON.parse(raw) as JarvisMemory
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const silenceMs = Number(req.nextUrl.searchParams.get('silenceMs') || '0')
  if (!Number.isFinite(silenceMs) || silenceMs < MIN_SILENCE_MS) {
    return NextResponse.json({ suggestion: '', shouldPrompt: false })
  }

  const memory = await readMemory()
  const name = memory?.userName?.trim() || 'sir'
  const city = memory?.preferences?.city || 'Riyadh'
  const lastTopic = req.nextUrl.searchParams.get('lastTopic')?.trim() || ''
  const now = new Date()
  const hour = now.getHours()
  const timeOfDay = hour < 12 ? 'morning' : hour >= 18 ? 'evening' : 'daytime'

  try {
    const result = await generateWithFallback({
      system: `You are G.F.A.I., a proactive JARVIS-style assistant. Generate one genuinely useful check-in sentence, maximum two sentences. Avoid generic lines like "how can I help". If it is morning, lean toward a briefing. If evening, lean toward a recap. Otherwise, offer concrete help tied to the most recent topic when available. Mention ${city} only if it adds value. Address the user as ${name}. Return plain text only.`,
      messages: [{
        role: 'user',
        content: `The user has been silent for ${Math.round(silenceMs / 60000)} minutes. Time of day: ${timeOfDay}. Last topic: ${lastTopic || 'unknown'}.`,
      }],
      maxTokens: 120,
    })

    const suggestion = result.text.replace(/\s+/g, ' ').trim()
    if (suggestion) {
      return NextResponse.json({ suggestion, shouldPrompt: true })
    }
  } catch {
    // Fall through to deterministic fallback.
  }

  const suggestion = timeOfDay === 'morning'
    ? `You've been quiet a while, ${name}. I can give you a quick morning briefing for ${city} or line up your first priority.`
    : timeOfDay === 'evening'
      ? `Quiet spell detected, ${name}. I can help you wrap the day with a short recap and set tomorrow's first move.`
      : `You've been away for a bit, ${name}. If you want, I'll pick up the ${lastTopic || 'last thread'} and move it forward.`

  return NextResponse.json({ suggestion, shouldPrompt: true })
}
