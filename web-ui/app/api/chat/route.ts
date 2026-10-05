import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isAuthorizedRequest } from '@/lib/auth'
import { generateWithFallback, GHOSTFORGE_SYSTEM } from '@/lib/ai'
import type { ModelMessage } from 'ai'

export const dynamic = 'force-dynamic'

function toModelMessages(payload: unknown): ModelMessage[] {
  if (!Array.isArray(payload)) return []
  return payload.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const role = 'role' in item ? (item as Record<string,unknown>).role : undefined
    const content = 'content' in item ? (item as Record<string,unknown>).content : undefined
    if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) {
      return [{ role, content } as ModelMessage]
    }
    return []
  })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = (await req.json()) as { messages?: unknown }
    const messages = toModelMessages(body.messages).slice(-10)
    const { text, usedModel, usedProvider } = await generateWithFallback({
      system: GHOSTFORGE_SYSTEM,
      messages,
      maxTokens: 800,
    }, { userId: user.id })
    // Strip thinking tokens from thinking models (qwen3:14b, deepseek-r1)
    const reply = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, '')
      .trim()
    return NextResponse.json({ reply, usedModel, usedProvider })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
