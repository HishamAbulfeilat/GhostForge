import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { MODEL_DATABASE, scoreModels, detectHardware, tryLLMFitCLI } from '@/lib/llmfit-models'

export const dynamic = 'force-dynamic'

const execAsync = promisify(exec)

// ── GET /api/llmfit — return scored model recommendations ────────────────────

export async function GET(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
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
  const bestInstalled = models.filter(m => m.isInstalled && m.canRun).sort((a, b) => b.compositeScore - a.compositeScore)[0]

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
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
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

  // Fire and forget — ollama pull can take minutes
  execAsync(`ollama pull ${targetModel}`, {
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:${process.env.PATH || ''}` },
  }).catch(() => {})

  const known = MODEL_DATABASE.find(m => m.id === targetModel)
  return NextResponse.json({
    status: 'pulling',
    message: `Pulling ${targetModel}... Check 'ollama list' in a few minutes or run: ollama list`,
    model: known || { id: targetModel, name: targetModel, custom: true },
  })
}
