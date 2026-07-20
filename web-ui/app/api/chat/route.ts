import { NextRequest, NextResponse } from 'next/server'
import { streamText, type CoreMessage } from 'ai'
import { isAuthorizedRequest } from '@/lib/auth'
import { selectAIModel, GHOSTFORGE_SYSTEM } from '@/lib/ai'
import fs from 'fs'
import path from 'path'
import os from 'os'

function toCoreMessages(payload: unknown): CoreMessage[] {
  if (!Array.isArray(payload)) return []
  return payload.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const role = 'role' in item ? item.role : undefined
    const content = 'content' in item ? item.content : undefined
    if (
      (role === 'user' || role === 'assistant' || role === 'system') &&
      typeof content === 'string' && content.trim().length > 0
    ) {
      return [{ role, content } satisfies CoreMessage]
    }
    return []
  })
}

function getActiveModelSettings() {
  try {
    const p = path.join(os.homedir(), '.ghostforge/settings.json')
    return JSON.parse(fs.readFileSync(p, 'utf8')) as { activeModel?: string; activeProvider?: string }
  } catch { return {} }
}

function isQuotaError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('quota') || msg.includes('exceeded') || msg.includes('429') || msg.includes('rate')
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await req.json()) as { messages?: unknown }
    const messages = toCoreMessages(body.messages)
    const settings = getActiveModelSettings()
    const { model, fallbackModel } = await selectAIModel(settings)

    // Try primary model (streamed)
    try {
      const result = streamText({ model, system: GHOSTFORGE_SYSTEM, messages })
      return result.toTextStreamResponse()
    } catch (err) {
      // Quota/rate-limit → fallback to OpenRouter and stream that
      if (fallbackModel && isQuotaError(err)) {
        console.warn('Primary model quota exceeded, falling back to OpenRouter (streaming)')
        const result = streamText({ model: fallbackModel, system: GHOSTFORGE_SYSTEM, messages })
        return result.toTextStreamResponse()
      }
      throw err
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
