import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { spawn } from 'child_process'
import { MODEL_DATABASE, scoreModels, detectHardware, tryLLMFitCLI } from '@/lib/llmfit-models'
import { chooseBestInstalledModel } from '@/lib/local-runtime'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ── GET /api/llmfit — return scored model recommendations ────────────────────

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
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

// ── POST /api/llmfit/pull — trigger ollama pull ───────────────────────────────

export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { modelId, customModel } = await req.json().catch(() => ({}))
  const targetModel = customModel || modelId
  if (!targetModel) return NextResponse.json({ error: 'modelId or customModel required' }, { status: 400 })

  // Sanitize model name — only allow safe ollama model format (no shell injection)
  const SAFE_MODEL_RE = /^[a-zA-Z0-9_./:@-]{1,120}$/
  if (!SAFE_MODEL_RE.test(targetModel)) {
    return NextResponse.json({ error: 'Invalid model name format' }, { status: 400 })
  }

  try {
    const child = spawn('ollama', ['pull', targetModel], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:${process.env.PATH || ''}` },
    })
    child.unref()
  } catch (error) {
    return NextResponse.json({ error: `Could not start Ollama: ${String(error).slice(0, 120)}` }, { status: 503 })
  }

  const known = MODEL_DATABASE.find(m => m.id === targetModel)
  return NextResponse.json({
    status: 'pulling',
    message: `Pulling ${targetModel}... Check 'ollama list' in a few minutes or run: ollama list`,
    model: known || { id: targetModel, name: targetModel, custom: true },
  })
}
