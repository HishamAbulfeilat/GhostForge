#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const README_URL = 'https://raw.githubusercontent.com/Shubhamsaboo/awesome-llm-apps/main/README.md'
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

By default, lists the Awesome LLM Apps catalog from GitHub.

Options:
  --category <name>  Filter by category (agents, rag, voice, multi-agent,
                     generative-ui, computer-use, code, creative, other)
  --search <query>   Search app names and descriptions
  --json             Print matching apps as JSON
  -h, --help         Show this help

The catalog is fetched from:
  https://github.com/Shubhamsaboo/awesome-llm-apps`
}

function parseArgs(argv) {
  const options = { category: 'all', search: '', json: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      return { ...options, help: true }
    }
    if (arg === '--json') {
      options.json = true
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

function filterApps(apps, { category = 'all', search = '' } = {}) {
  const query = search.trim().toLowerCase()
  return apps.filter(app =>
    (category === 'all' || app.category === category) &&
    (!query || app.name.toLowerCase().includes(query) || app.description.toLowerCase().includes(query))
  )
}

async function fetchCatalog() {
  let response
  try {
    response = await fetch(README_URL, { signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    throw new Error(`Could not fetch the Awesome LLM Apps README: ${error.message}`)
  }
  if (!response.ok) {
    throw new Error(`Could not fetch the Awesome LLM Apps README (HTTP ${response.status})`)
  }
  return parseReadme(await response.text())
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
  const apps = filterApps(await fetchCatalog(), options)
  console.log(options.json ? JSON.stringify(apps, null, 2) : formatApps(apps))
}

export { filterApps, formatApps, parseArgs, parseReadme, usage }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exitCode = 1
  }
}
