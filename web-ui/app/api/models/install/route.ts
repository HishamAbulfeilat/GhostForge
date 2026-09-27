import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { requirePermission } from '@/lib/access'
import { LOCAL_MODELS, RUNNER_META, type RunnerId } from '@/lib/local-models'

export const dynamic = 'force-dynamic'

interface InstallBody {
  runner?: RunnerId
  model?: string
  action?: 'install' | 'open'
}

const RUNNER_LINKS: Record<Exclude<RunnerId, 'ollama'>, string> = {
  llamafile: 'https://huggingface.co/models?search=llamafile',
  'lm-studio': 'https://lmstudio.ai/models',
  jan: 'https://jan.ai',
}

export async function POST(req: NextRequest) {
  const access = await requirePermission(req, 'ai_models')
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => ({})) as InstallBody
  const runner = body.runner
  const modelId = body.model

  if (!runner || !modelId) {
    return NextResponse.json({ error: 'runner and model are required' }, { status: 400 })
  }

  const model = LOCAL_MODELS.find(entry => entry.runner === runner && entry.id === modelId)
  if (!model) {
    return NextResponse.json({ error: 'Unknown model selection' }, { status: 400 })
  }

  if (runner === 'ollama') {
    const child = spawn('ollama', ['pull', model.name], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()

    return NextResponse.json({
      ok: true,
      runner,
      model: model.name,
      status: 'installing',
      message: `Started ${model.name}.`,
      command: model.installCommand,
    })
  }

  return NextResponse.json({
    ok: true,
    runner,
    model: model.name,
    status: 'external',
    message: `${RUNNER_META[runner].installLabel} to finish setup.`,
    externalUrl: model.externalUrl ?? RUNNER_LINKS[runner],
  })
}
