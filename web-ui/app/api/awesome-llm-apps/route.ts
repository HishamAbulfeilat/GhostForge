import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const GITHUB_RAW = 'https://api.github.com/repos/Shubhamsaboo/awesome-llm-apps/contents'
const GITHUB_API = 'https://api.github.com/repos/Shubhamsaboo/awesome-llm-apps'

interface GitHubContent {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
  download_url: string | null
}

interface AwesomeApp {
  id: string
  name: string
  path: string
  category: string
  description: string
  url: string
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'agents':      ['agent', 'autonomous', 'planner', 'react', 'tool-use'],
  'rag':         ['rag', 'retrieval', 'vector', 'embedding', 'knowledge', 'search'],
  'voice':       ['voice', 'speech', 'audio', 'tts', 'whisper', 'transcription'],
  'multi-agent': ['multi-agent', 'crew', 'swarm', 'orchestrat', 'collaborative'],
  'generative-ui':['generative', 'ui', 'interface', 'streaming', 'chat-ui', 'gradio', 'streamlit'],
  'computer-use':['computer', 'browser', 'screen', 'gui', 'desktop', 'control'],
  'code':        ['code', 'coding', 'programming', 'debug', 'developer'],
  'creative':    ['creative', 'writing', 'story', 'image', 'video', 'art', 'music'],
}

function categorize(name: string, description: string): string {
  const combined = `${name} ${description}`.toLowerCase()
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => combined.includes(kw))) return category
  }
  return 'other'
}

async function fetchReadme(): Promise<string> {
  try {
    const res = await fetch(`${GITHUB_RAW}/README.md`, {
      headers: { Accept: 'application/vnd.github.v3.raw' },
      next: { revalidate: 600 },
    })
    if (!res.ok) return ''
    return res.text()
  } catch {
    return ''
  }
}

function parseAppsFromReadme(readme: string): AwesomeApp[] {
  const apps: AwesomeApp[] = []
  const lines = readme.split('\n')
  let currentCategory = 'other'

  for (const line of lines) {
    const categoryMatch = line.match(/^#{2,3}\s+(.+)/)
    if (categoryMatch) {
      const raw = categoryMatch[1].trim().toLowerCase()
      currentCategory = Object.keys(CATEGORY_KEYWORDS).find(c => raw.includes(c)) ?? 'other'
    }

    const appMatch = line.match(/\*\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–—:]\s*(.*)/)
    if (!appMatch) {
      const simpleMatch = line.match(/\*\s+\*\*([^\*]+)\*\*[:\s]+(.*)/)
      if (simpleMatch) {
        const [, name, description] = simpleMatch
        apps.push({
          id: name.trim().toLowerCase().replace(/\s+/g, '-'),
          name: name.trim(),
          path: '',
          category: categorize(name, description),
          description: description.trim().replace(/\.$/, ''),
          url: GITHUB_API,
        })
      }
      continue
    }

    const [, name, url, description] = appMatch
    apps.push({
      id: name.trim().toLowerCase().replace(/\s+/g, '-'),
      name: name.trim(),
      path: url.trim(),
      category: categorize(name, description),
      description: description.trim().replace(/\.$/, ''),
      url: url.trim(),
    })
  }

  return apps
}

async function fetchDirectoryContents(dirPath: string): Promise<GitHubContent[]> {
  try {
    const res = await fetch(`${GITHUB_RAW}/${dirPath}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      next: { revalidate: 600 },
    })
    if (!res.ok) return []
    return res.json() as Promise<GitHubContent[]>
  } catch {
    return []
  }
}

async function fetchRepoTree(): Promise<GitHubContent[]> {
  try {
    const res = await fetch(`${GITHUB_API}/contents`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      next: { revalidate: 600 },
    })
    if (!res.ok) return []
    return res.json() as Promise<GitHubContent[]>
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('mode') ?? 'catalog'
  const category = searchParams.get('category') ?? undefined
  const query = searchParams.get('q')?.toLowerCase() ?? undefined

  try {
    if (mode === 'tree') {
      const tree = await fetchRepoTree()
      const dirs = tree.filter(e => e.type === 'dir')
      return NextResponse.json({
        type: 'tree',
        items: dirs.map(d => ({
          name: d.name,
          path: d.path,
          type: d.type,
        })),
      })
    }

    if (mode === 'directory' && category) {
      const contents = await fetchDirectoryContents(category)
      return NextResponse.json({
        type: 'directory',
        category,
        items: contents.map(c => ({
          name: c.name,
          path: c.path,
          type: c.type,
          size: c.size,
        })),
      })
    }

    const readme = await fetchReadme()
    let apps = parseAppsFromReadme(readme)

    if (category && category !== 'all') {
      apps = apps.filter(a => a.category === category)
    }
    if (query) {
      apps = apps.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query)
      )
    }

    const categories = [...new Set(apps.map(a => a.category))].sort()
    const grouped = categories.reduce<Record<string, AwesomeApp[]>>((acc, cat) => {
      acc[cat] = apps.filter(a => a.category === cat)
      return acc
    }, {})

    return NextResponse.json({
      type: 'catalog',
      count: apps.length,
      categories,
      grouped,
      items: apps,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
