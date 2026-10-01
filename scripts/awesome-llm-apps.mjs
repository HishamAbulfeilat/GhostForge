#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const README_URL = 'https://raw.githubusercontent.com/Shubhamsaboo/awesome-llm-apps/main/README.md'
const API_URL = process.env.GF_AWESOME_LLM_API_URL || README_URL
const CATEGORY_KEYWORDS = {
  agents: ['agent', 'autonomous', 'planner', 'react', 'tool-use'],
  rag: ['rag', 'retrieval', 'vector', 'embedding', 'knowledge', 'search'],
  voice: ['voice', 'speech', 'audio', 'tts', 'whisper', 'transcription'],
  'multi-agent': ['multi-agent', 'crew', 'swarm', 'orchestrat', 'collaborative'],
  'generative-ui': ['generative', 'ui', 'interface', 'streaming', 'chat-ui', 'gradio', 'streamlit'],
  'computer-use': ['computer', 'browser', 'screen', 'gui', 'desktop', 'control'],
  code: ['code', 'coding', 'programming', 'debug', 'developer'],
  creative: ['creative', 'writing', 'story', 'image', 'video', 'art', 'music'],
}

function usage() {
  return `Awesome LLM Apps catalog

Usage:
  npm run awesome-llm-apps
  node scripts/awesome-llm-apps.mjs [options]
  bash scripts/awesome-llm-apps.sh list
  bash scripts/awesome-llm-apps.sh search "agent"

By default, lists the Awesome LLM Apps catalog from the configured source.

Options:
  list               List apps (default)
  search <query>     Search app names and descriptions
  --category <name>  Filter by category (agents, rag, voice, multi-agent,
                     generative-ui, computer-use, code, creative, other)
  --search <query>   Search app names and descriptions
  --api-url <url>    Override the catalog fetch URL
  --fixture <path>   Read a local JSON/README fixture instead of fetching
  --json             Print matching apps as JSON
  -h, --help         Show this help

The default catalog is fetched from:
  https://github.com/Shubhamsaboo/awesome-llm-apps`
}

function parseArgs(argv) {
  const options = { category: 'all', search: '', json: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === 'list') {
      options.command = 'list'
      continue
    }
    if (arg === 'search') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('search requires a query')
      options.command = 'search'
      options.search = value
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      return { ...options, help: true }
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--api-url' || arg === '--source-url') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      options.apiUrl = value
      index += 1
      continue
    }
    if (arg === '--fixture' || arg === '--fixture-file') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      options.fixture = value
      index += 1
      continue
    }
    if (arg === '--category' || arg === '--search') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      if (arg === '--category') {
        const category = value.toLowerCase()
        if (category !== 'all' && category !== 'other' && !Object.hasOwn(CATEGORY_KEYWORDS, category)) {
          throw new Error(`Unknown category "${value}". Use --help to see available categories.`)
        }
        options.category = category
      } else {
        options.search = value
      }
      index += 1
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    }
    if (options.command === 'search') {
      options.search = arg
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

function categorize(name, description) {
  const text = `${name} ${description}`.toLowerCase()
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(keyword => text.includes(keyword))) return category
  }
  return 'other'
}

function categorizeHeading(heading) {
  const text = heading.toLowerCase()
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (text.includes(category) || text.includes(category.replaceAll('-', ' '))) return category
    if (keywords.some(keyword => keyword.length > 3 && text.includes(keyword))) return category
  }
  return 'other'
}

function makeApp(name, description, url, sectionCategory) {
  const cleanName = name.trim()
  const cleanDescription = description.trim().replace(/\.$/, '')
  const inferredCategory = categorize(cleanName, cleanDescription)
  return {
    id: cleanName.toLowerCase().replace(/\s+/g, '-'),
    name: cleanName,
    category: sectionCategory === 'other' ? inferredCategory : sectionCategory,
    description: cleanDescription,
    url: url || 'https://github.com/Shubhamsaboo/awesome-llm-apps',
  }
}

function parseReadme(readme) {
  const apps = []
  let currentCategory = 'other'

  for (const line of readme.split(/\r?\n/)) {
    const heading = line.match(/^(#{2,3})\s+(.+)/)
    if (heading) {
      const category = categorizeHeading(heading[2].trim())
      if (category !== 'other' || heading[1].length === 2) currentCategory = category
    }

    const linkedApp = line.match(/^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–—:]\s*(.*)/)
    if (linkedApp) {
      const [, name, url, description] = linkedApp
      apps.push(makeApp(name, description, url.trim(), currentCategory))
      continue
    }

    const boldApp = line.match(/^\s*[-*]\s+\*\*([^*]+)\*\*[:\s]+(.*)/)
    if (boldApp) {
      const [, name, description] = boldApp
      apps.push(makeApp(name, description, '', currentCategory))
    }
  }

  return apps
}

function coerceApps(raw) {
  if (Array.isArray(raw)) return raw.map(app => ({
    id: app.id || (app.name || 'app').toLowerCase().replace(/\s+/g, '-'),
    name: app.name || 'Untitled app',
    category: app.category || categorize(app.name || '', app.description || ''),
    description: app.description || '',
    url: app.url || 'https://github.com/Shubhamsaboo/awesome-llm-apps',
  }))

  if (!raw || typeof raw !== 'object') return []

  if (Array.isArray(raw.items)) return coerceApps(raw.items)
  if (raw.grouped && typeof raw.grouped === 'object') {
    return Object.values(raw.grouped).flatMap(value => coerceApps(Array.isArray(value) ? value : []))
  }

  return []
}

function readFixture(filePath) {
  const fileText = fs.readFileSync(filePath, 'utf8')
  const trimmed = fileText.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(fileText)
    return coerceApps(parsed)
  } catch {
    return parseReadme(fileText)
  }
}

function filterApps(apps, { category = 'all', search = '' } = {}) {
  const query = search.trim().toLowerCase()
  return apps.filter(app =>
    (category === 'all' || app.category === category) &&
    (!query || app.name.toLowerCase().includes(query) || app.description.toLowerCase().includes(query))
  )
}

async function fetchCatalog(options = {}) {
  const apiUrl = options.apiUrl || API_URL

  if (options.fixture) {
    return readFixture(path.resolve(process.cwd(), options.fixture))
  }

  let response
  try {
    response = await fetch(apiUrl, {
      headers: { Accept: 'application/json, text/plain;q=0.9' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new Error(`Could not fetch the Awesome LLM Apps catalog: ${error.message}`)
  }
  if (!response.ok) {
    throw new Error(`Could not fetch the Awesome LLM Apps catalog (HTTP ${response.status})`)
  }

  const text = await response.text()
  const trimmed = text.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(text)
    const normalized = coerceApps(parsed)
    if (normalized.length > 0) return normalized
    return parseReadme(trimmed)
  } catch {
    if (apiUrl !== README_URL) {
      return parseReadme(trimmed)
    }
    return parseReadme(trimmed)
  }
}

function formatApps(apps) {
  if (apps.length === 0) return 'No apps found.'
  const categories = [...new Set(apps.map(app => app.category))].sort()
  const sections = categories.map(category => {
    const rows = apps
      .filter(app => app.category === category)
      .map(app => `  - ${app.name}: ${app.description}\n    ${app.url}`)
    return `${category} (${rows.length})\n${rows.join('\n')}`
  })
  return `Awesome LLM Apps (${apps.length})\n\n${sections.join('\n\n')}`
}

async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return
  }
  const apps = filterApps(await fetchCatalog(options), options)
  console.log(options.json ? JSON.stringify(apps, null, 2) : formatApps(apps))
}

export { coerceApps, fetchCatalog, filterApps, formatApps, parseArgs, parseReadme, readFixture, usage }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exitCode = 1
  }
}
