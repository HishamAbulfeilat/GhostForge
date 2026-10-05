import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { isAuthorizedRequest } from '@/lib/auth'
import { LOCAL_MODELS, getLLMFitLabel, getLLMFitWeight, type LocalModel, type RunnerId } from '@/lib/local-models'
import { detectHardware } from '@/lib/llmfit-models'

export const dynamic = 'force-dynamic'

interface RecommendationModel {
  runner: RunnerId
  model: LocalModel
  score: number
  fitsNow: boolean
}

function scoreModel(model: LocalModel, availableGB: number) {
  const fitRatio = availableGB > 0 ? model.sizeGB / availableGB : Number.POSITIVE_INFINITY
  const fitScore = fitRatio <= 0.6 ? 20 : fitRatio <= 0.85 ? 14 : fitRatio <= 1 ? 8 : 0
  const llmfitScore = getLLMFitWeight(model.llmfit) * 22
  const featuredBonus = model.recommended ? 8 : 0
  const score = llmfitScore + fitScore + featuredBonus

  return {
    score,
    fitsNow: fitRatio <= 1,
  }
}

function pickRecommendation(models: LocalModel[], availableGB: number) {
  const scored: RecommendationModel[] = models.map((model) => ({
    runner: model.runner,
    model,
    ...scoreModel(model, availableGB),
  }))

  scored.sort((left, right) => right.score - left.score)
  return scored.find(entry => entry.fitsNow) ?? scored[0]
}

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hardware = await detectHardware()
  const recommended = pickRecommendation(LOCAL_MODELS, hardware.availableGB)

  return NextResponse.json({
    machine: {
      ramGB: hardware.ramGB,
      availableGB: hardware.availableGB,
      cpuBrand: hardware.cpuBrand,
      appleSilicon: hardware.isAppleSilicon,
    },
    recommendation: recommended
      ? {
          runner: recommended.runner,
          model: recommended.model.name,
          score: recommended.score,
          llmfit: getLLMFitLabel(recommended.model.llmfit),
          summary: recommended.fitsNow
            ? `${recommended.model.name} is the best fit for your current memory budget.`
            : `${recommended.model.name} is top-ranked, but your machine may prefer a smaller model right now.`,
          reason: `${recommended.model.description} · ${recommended.model.size} · ${recommended.model.contextLength} context`,
        }
      : null,
  })
}
