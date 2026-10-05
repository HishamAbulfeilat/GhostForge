import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isAdmin, isAuthorizedRequest } from '@/lib/auth'
import { isOmniRouteUp } from '@/lib/ai'
import { isHostedMode } from '@/lib/hosted'
import {
  PROVIDERS, clearSelection, getSavedSelection, isSelectableProvider, keySource, listCustomModels, listProviderModels,
  omniRouteBaseURL, runWithAIUser, saveSelection, type ProviderId,
} from '@/lib/providers'

export const dynamic = 'force-dynamic'

async function ollamaModels(): Promise<string[] | null> {
  if (isHostedMode()) return null // the host's local models are not offered when hosted
  const base = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/v1\/?$/, '')
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    const data = await res.json() as { models?: Array<{ name?: string }> }
    return (data.models || []).map(m => m.name || '').filter(Boolean)
  } catch {
    return null
  }
}

/**
 * GET  /api/models[?refresh=1] — every AI provider (key status + live model
 *      list, or its known-free list when there is no key yet), custom models,
 *      local Ollama models, OmniRoute status, and the active selection.
 * POST /api/models { provider, modelId } — save the model chat and JARVIS use.
 * DELETE /api/models — clear the choice (back to automatic free models).
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const me = await getCurrentUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Hosted mode: keys, model choice and custom models are the caller's own
  return runWithAIUser(me.id, () => listModels(req, me))
}

async function listModels(req: NextRequest, me: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  const refresh = req.nextUrl.searchParams.get('refresh') === '1'
  const [omniUp, ollama] = await Promise.all([isOmniRouteUp(), ollamaModels()])

  const providers = await Promise.all((Object.keys(PROVIDERS) as ProviderId[]).map(async id => {
    const info = PROVIDERS[id]
    const source = keySource(id)
    const available = id === 'omniroute' ? omniUp : source !== 'missing'
    const list = id === 'omniroute' && !omniUp
      ? { models: [], error: undefined }
      : await listProviderModels(id, { refresh })
    return {
      id,
      name: info.name,
      keyEnv: info.keyEnv,
      keyUrl: info.keyUrl ?? null,
      paid: info.paid,
      keySource: source,
      available,
      defaultModel: info.defaultModel,
      models: list.models,
      error: available ? (list.error ?? null) : null,
    }
  }))

  const saved = getSavedSelection()
  return NextResponse.json({
    providers,
    custom: listCustomModels(),
    ollama: { running: ollama !== null, models: ollama ?? [] },
    omniroute: { up: omniUp, url: omniRouteBaseURL(), dashboard: omniRouteBaseURL().replace(/\/v1$/, '/dashboard') },
    active: saved ?? { provider: 'auto', model: 'free models' },
    isDefault: !saved,
    // Hosted: every user manages their own keys; otherwise the admin's server-wide keys
    canEditKeys: isHostedMode() || isAdmin(me),
    hosted: isHostedMode(),
  })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: { modelId?: unknown; provider?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
  if (!isSelectableProvider(body.provider) || !modelId || modelId.length > 200) {
    return NextResponse.json({ error: 'provider and modelId are required' }, { status: 400 })
  }
  const me = await getCurrentUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    runWithAIUser(me.id, () => saveSelection({ provider: body.provider as Parameters<typeof saveSelection>[0]['provider'], model: modelId }))
  } catch (e) {
    const hostedError = isHostedMode() && e instanceof Error ? e.message : null
    return NextResponse.json({ error: hostedError || 'Cannot write settings' }, { status: hostedError ? 400 : 500 })
  }
  return NextResponse.json({ ok: true, active: { provider: body.provider, model: modelId } })
}

export async function DELETE(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const me = await getCurrentUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  runWithAIUser(me.id, () => clearSelection())
  return NextResponse.json({ ok: true })
}
