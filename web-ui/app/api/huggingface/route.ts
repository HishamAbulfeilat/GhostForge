import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

interface HFModel {
  id: string
  modelId?: string
  author?: string
  pipeline_tag?: string
  tags?: string[]
  downloads?: number
  likes?: number
  last_modified?: string
  cardData?: { license?: string | string[]; language?: string[] }
}

interface HFSpace {
  id: string
  author?: string
  title?: string
  description?: string
  tags?: string[]
  likes?: number
  last_modified?: string
  sdk?: string
}

async function fetchHFModels(params: {
  query?: string
  limit?: number
  sort?: string
  filter?: string
  author?: string
}): Promise<HFModel[]> {
  const searchParams = new URLSearchParams()
  if (params.query) searchParams.set('search', params.query)
  if (params.author) searchParams.set('author', params.author)
  if (params.limit) searchParams.set('limit', String(Math.min(params.limit, 50)))
  else searchParams.set('limit', '24')
  if (params.sort) searchParams.set('sort', params.sort)
  if (params.filter) searchParams.set('filter', params.filter)

  const res = await fetch(`https://huggingface.co/api/models?${searchParams.toString()}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 300 },
  })

  if (!res.ok) return []
  return res.json() as Promise<HFModel[]>
}

async function fetchHFSpaces(params: {
  query?: string
  limit?: number
  sort?: string
  filter?: string
}): Promise<HFSpace[]> {
  const searchParams = new URLSearchParams()
  if (params.query) searchParams.set('search', params.query)
  if (params.limit) searchParams.set('limit', String(Math.min(params.limit, 50)))
  else searchParams.set('limit', '24')
  if (params.sort) searchParams.set('sort', params.sort)
  if (params.filter) searchParams.set('filter', params.filter)

  const res = await fetch(`https://huggingface.co/api/spaces?${searchParams.toString()}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 300 },
  })

  if (!res.ok) return []
  return res.json() as Promise<HFSpace[]>
}

function classifyModel(model: HFModel): string {
  const pipeline = model.pipeline_tag ?? ''
  const tags = model.tags ?? []

  if (['text-generation', 'text2text-generation', 'conversational'].includes(pipeline)) return 'LLM'
  if (['image-classification', 'object-detection', 'image-segmentation', 'zero-shot-image-classification'].includes(pipeline)) return 'Vision'
  if (['automatic-speech-recognition', 'audio-classification', 'text-to-speech', 'text-to-audio'].includes(pipeline)) return 'Audio'
  if (pipeline === 'text-to-video' || tags.includes('video-generation')) return 'Video'
  if (pipeline === 'fill-mask' || pipeline === 'token-classification' || pipeline === 'question-answering') return 'NLP'
  if (pipeline === 'diffusion' || tags.some(t => t.includes('diffusers'))) return 'Diffusion'
  return 'Other'
}

function extractLicense(model: HFModel): string {
  const raw = model.cardData?.license
  if (!raw) return 'Unknown'
  if (Array.isArray(raw)) return raw[0] ?? 'Unknown'
  return raw
}

function estimateSize(model: HFModel): string {
  const tags = model.tags ?? []
  for (const tag of tags) {
    if (/^\d+(\.\d+)?[bB]$/.test(tag)) return tag.toUpperCase()
    if (/^\d+(\.\d+)?t$/i.test(tag)) return tag.toUpperCase()
  }
  return 'Unknown'
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const endpoint = searchParams.get('endpoint') ?? 'models'
  const query = searchParams.get('q') ?? searchParams.get('query') ?? undefined
  const limit = searchParams.has('limit') ? Number(searchParams.get('limit')) : 24
  const sort = searchParams.get('sort') ?? 'downloads'
  const filter = searchParams.get('filter') ?? undefined

  try {
    if (endpoint === 'spaces') {
      const spaces = await fetchHFSpaces({ query, limit, sort, filter })
      return NextResponse.json({
        type: 'spaces',
        count: spaces.length,
        items: spaces.map(s => ({
          id: s.id,
          author: s.id.split('/')[0],
          title: s.title ?? s.id,
          description: s.description ?? '',
          tags: s.tags ?? [],
          likes: s.likes ?? 0,
          sdk: s.sdk ?? 'unknown',
          lastModified: s.last_modified ?? null,
        })),
      })
    }

    if (endpoint === 'recommendations') {
      const task = searchParams.get('task') ?? 'text-generation'
      const taskFilterMap: Record<string, string> = {
        'text-generation': 'text-generation',
        'chat': 'text-generation',
        'image': 'image-classification',
        'vision': 'image-classification',
        'audio': 'automatic-speech-recognition',
        'embedding': 'feature-extraction',
        'summarization': 'summarization',
        'translation': 'translation',
        'code': 'text-generation',
      }
      const pipelineFilter = taskFilterMap[task] ?? task
      const models = await fetchHFModels({ limit, sort: 'downloads', filter: pipelineFilter })

      const enriched = models.map(m => ({
        id: m.id,
        author: m.id.split('/')[0],
        name: m.id.split('/').pop() ?? m.id,
        type: classifyModel(m),
        downloads: m.downloads ?? 0,
        likes: m.likes ?? 0,
        license: extractLicense(m),
        size: estimateSize(m),
        pipelineTag: m.pipeline_tag ?? 'unknown',
        tags: (m.tags ?? []).slice(0, 5),
        lastModified: m.last_modified ?? null,
      }))

      return NextResponse.json({
        type: 'recommendations',
        task,
        count: enriched.length,
        items: enriched,
      })
    }

    const models = await fetchHFModels({ query, limit, sort, filter })

    const enriched = models.map(m => ({
      id: m.id,
      author: m.id.split('/')[0],
      name: m.id.split('/').pop() ?? m.id,
      type: classifyModel(m),
      downloads: m.downloads ?? 0,
      likes: m.likes ?? 0,
      license: extractLicense(m),
      size: estimateSize(m),
      pipelineTag: m.pipeline_tag ?? 'unknown',
      tags: (m.tags ?? []).slice(0, 5),
      lastModified: m.last_modified ?? null,
    }))

    return NextResponse.json({
      type: 'models',
      count: enriched.length,
      items: enriched,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
