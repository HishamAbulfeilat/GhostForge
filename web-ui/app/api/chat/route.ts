import { NextRequest, NextResponse } from 'next/server'
import type { CoreMessage } from 'ai'
import { isAuthorizedRequest } from '@/lib/auth'
import { generateGhostforgeReply } from '@/lib/ai'

function toCoreMessages(payload: unknown): CoreMessage[] {
  if (!Array.isArray(payload)) {
    return []
  }

  return payload.flatMap(item => {
    if (!item || typeof item !== 'object') {
      return []
    }

    const role = 'role' in item ? item.role : undefined
    const content = 'content' in item ? item.content : undefined

    if (
      (role === 'user' || role === 'assistant' || role === 'system') &&
      typeof content === 'string' &&
      content.trim().length > 0
    ) {
      return [{ role, content } satisfies CoreMessage]
    }

    return []
  })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await req.json()) as { messages?: unknown }
    const messages = toCoreMessages(body.messages)
    const message = await generateGhostforgeReply(messages)
    return NextResponse.json({ message })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
