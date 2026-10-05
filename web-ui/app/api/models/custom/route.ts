import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isAdmin, isAuthorizedRequest } from '@/lib/auth'
import { generateOpenAICompatible } from '@/lib/ai'
import { deleteCustomModel, getCustomModel, listCustomModels, runWithAIUser, saveCustomModel } from '@/lib/providers'
import { isHostedMode, isPublicHttpsUrl } from '@/lib/hosted'

/** Hosted mode: any signed-in user manages their own custom models; otherwise admins only */
async function customModelUser(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me || (!isHostedMode() && !isAdmin(me))) return null
  return me
}

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Custom models — any OpenAI-compatible endpoint (LM Studio, vLLM, LocalAI,
 * a company gateway, another provider…). Keys are never returned.
 *   GET                                  list
 *   POST { name, baseURL, model, apiKey?, free?, id? }   add / edit (admin)
 *   POST { action: 'test', id }          send a one-line prompt (admin)
 *   DELETE ?id=                          remove (admin)
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await getCurrentUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ models: runWithAIUser(me.id, () => listCustomModels()) })
}

export async function POST(req: NextRequest) {
  const me = await customModelUser(req)
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return runWithAIUser(me.id, () => saveOrTest(req))
}

async function saveOrTest(req: NextRequest) {

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.action === 'test') {
    const custom = typeof body.id === 'string' ? getCustomModel(body.id) : undefined
    if (!custom) return NextResponse.json({ error: 'Unknown model' }, { status: 404 })
    const started = Date.now()
    try {
      const reply = await generateOpenAICompatible(custom.name, custom.baseURL, custom.apiKey, custom.model, {
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        maxTokens: 20,
      })
      return NextResponse.json({ ok: true, reply: reply.slice(0, 200), ms: Date.now() - started })
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const name = str(body.name, 80)
  const baseURL = str(body.baseURL, 300)
  const model = str(body.model, 200)
  const apiKey = str(body.apiKey, 500)
  if (!name || !baseURL || !model) {
    return NextResponse.json({ error: 'Name, base URL and model are required' }, { status: 400 })
  }
  try {
    const url = new URL(baseURL)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol')
  } catch {
    return NextResponse.json({ error: 'Base URL must be an http(s) URL, e.g. http://localhost:1234/v1' }, { status: 400 })
  }
  if (/\s/.test(apiKey)) return NextResponse.json({ error: 'That does not look like an API key' }, { status: 400 })
  if (isHostedMode() && !isPublicHttpsUrl(baseURL)) {
    return NextResponse.json({ error: 'On the hosted version a custom model needs a public https:// URL' }, { status: 400 })
  }

  const saved = saveCustomModel({
    id: str(body.id, 60) || undefined,
    name,
    baseURL,
    model,
    apiKey: apiKey || undefined,
    free: body.free === true,
  })
  return NextResponse.json({ ok: true, model: saved })
}

export async function DELETE(req: NextRequest) {
  const me = await customModelUser(req)
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!runWithAIUser(me.id, () => deleteCustomModel(id))) return NextResponse.json({ error: 'Unknown model' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
