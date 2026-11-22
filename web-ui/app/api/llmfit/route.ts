import { NextRequest, NextResponse } from 'next/server'
import { MODEL_DATABASE, scoreModels, detectHardware, tryLLMFitCLI } from '@/lib/llmfit-models'
import { chooseBestInstalledModel } from '@/lib/local-runtime'
import { isAuthorizedRequest, isAdmin } from '@/lib/auth'
import { requirePermission } from '@/lib/access'
import { SAFE_MODEL_NAME, isCatalogOllamaModel, startOllamaPull } from '@/lib/ollama-pull'

export const dynamic = 'force-dynamic'

// ── GET /api/llmfit — return scored model recommendations ────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const filter = url.searchParams.get('filter') || 'all' // 'all' | 'installed' | 'best'
  const useCase = url.searchParams.get('useCase') || ''  // 'code' | 'general' | 'reasoning'

  const [hw, llmfitCLI] = await Promise.all([
    detectHardware(),
    tryLLMFitCLI(),
  ])

  let models = scoreModels(MODEL_DATABASE, hw)

  // Apply filters
  if (filter === 'installed') models = models.filter(m => m.isInstalled)
  if (filter === 'best') models = models.filter(m => m.recommendation === 'best' || m.recommendation === 'good')
  if (useCase) models = models.filter(m => m.tags.includes(useCase) || m.useCase.toLowerCase().includes(useCase))

  // Sort: installed first, then by composite score
  models.sort((a, b) => {
    if (a.isInstalled !== b.isInstalled) return a.isInstalled ? -1 : 1
    return b.compositeScore - a.compositeScore
  })

  // Find the single best recommendation for this hardware
  const bestModel = models.filter(m => m.canRun).sort((a, b) => b.compositeScore - a.compositeScore)[0]
  const selectedInstalled = chooseBestInstalledModel(hw.ollamaModels, hw.ramGB, useCase || 'tools')
  const bestInstalled = selectedInstalled
    ? models.find(model => model.id === selectedInstalled.name)
    : models.filter(m => m.isInstalled && m.canRun).sort((a, b) => b.compositeScore - a.compositeScore)[0]

  return NextResponse.json({
    hardware: hw,
    models,
    recommendation: {
      best: bestModel?.id || null,
      bestInstalled: bestInstalled?.id || null,
      pullFirst: bestModel && !bestModel.isInstalled ? `ollama pull ${bestModel.id}` : null,
      summary: bestInstalled
        ? `Best available now: ${bestInstalled.name} (${bestInstalled.params}B params, ~${bestInstalled.ramGB}GB RAM)`
        : `Recommended to install: ${bestModel?.name || 'qwen2.5-coder:7b'}`,
    },
    llmfitCLI: llmfitCLI ? 'available' : 'not-installed',
    source: 'ghostforge-llmfit-scorer',
    version: '1.0',
  })
}

// ── POST /api/llmfit — trigger ollama pull ────────────────────────────────────
// Downloads onto the host, so it needs `ai_models`. Regular users can pull only
// models from the app's catalogs (as /api/models/install); admins may also pull
// a custom model name.

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, 'ai_models')
  if (user instanceof NextResponse) return user

  const { modelId, customModel } = await req.json().catch(() => ({})) as { modelId?: unknown; customModel?: unknown }
  const targetModel = customModel || modelId
  if (!targetModel) return NextResponse.json({ error: 'modelId or customModel required' }, { status: 400 })

  // Only a plain ollama model reference: no shell, no option flags
  if (typeof targetModel !== 'string' || !SAFE_MODEL_NAME.test(targetModel)) {
    return NextResponse.json({ error: 'Invalid model name format' }, { status: 400 })
  }
  if (!isCatalogOllamaModel(targetModel) && !isAdmin(user)) {
    return NextResponse.json({ error: 'Unknown model selection: only models from the catalog can be installed (an admin can pull a custom model)' }, { status: 400 })
  }

  const started = await startOllamaPull(targetModel)
  if (!started.ok) {
    return NextResponse.json({ error: started.error, status: 'failed' }, { status: 503 })
  }

  const known = MODEL_DATABASE.find(m => m.id === targetModel)
  return NextResponse.json({
    status: 'pulling',
    message: `Pulling ${targetModel}... Check 'ollama list' in a few minutes or run: ollama list`,
    model: known || { id: targetModel, name: targetModel, custom: true },
  })
}
