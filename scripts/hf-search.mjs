#!/usr/bin/env node
// Read-only search of the public Hugging Face models API.
// Usage: ghostforge models search <query> [--limit N] [--json]
// Optional HF_TOKEN (env) is sent as a bearer header and never printed.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HF_API = 'https://huggingface.co/api/models'
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100
const MAX_QUERY = 200
const TIMEOUT_MS = 15000

export class HfSearchError extends Error {}

function usage() {
  return [
    'Usage: ghostforge models search <query> [--limit N] [--json]',
    '',
    `  --limit N   Number of results (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})`,
    '  --json      Print results as JSON',
    '',
    'Env: HF_TOKEN (optional) for higher rate limits.',
    '',
  ].join('\n')
}

export function parseArgs(argv) {
  const opts = { help: false, json: false, limit: DEFAULT_LIMIT, sub: null, query: '' }
  const words = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--json') opts.json = true
    else if (a === '--limit' || a.startsWith('--limit=')) {
      const raw = a === '--limit' ? argv[++i] : a.slice('--limit='.length)
      if (raw === undefined || !/^\d+$/.test(raw)) throw new HfSearchError('--limit must be a positive integer')
      const n = Number(raw)
      if (n < 1 || n > MAX_LIMIT) throw new HfSearchError(`--limit must be between 1 and ${MAX_LIMIT}`)
      opts.limit = n
    } else if (a.startsWith('-')) throw new HfSearchError(`Unknown option: ${a}`)
    else words.push(a)
  }
  opts.sub = words.shift() || null
  opts.query = words.join(' ').trim()
  return opts
}

export async function searchModels(query, { limit = DEFAULT_LIMIT, token, fetchImpl = globalThis.fetch } = {}) {
  if (typeof query !== 'string' || !query.trim()) throw new HfSearchError('Search query is required')
  if (query.length > MAX_QUERY) throw new HfSearchError(`Query too long (max ${MAX_QUERY} characters)`)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(query)) throw new HfSearchError('Query contains control characters')
  if (typeof fetchImpl !== 'function') throw new HfSearchError('fetch is not available (Node 18+ required)')

  const url = new URL(HF_API)
  url.searchParams.set('search', query.trim())
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('sort', 'downloads')
  url.searchParams.set('direction', '-1')

  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetchImpl(url.toString(), { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new HfSearchError(timedOut ? 'Hugging Face request timed out' : 'Could not reach Hugging Face (network error)')
  }
  if (res.status === 401 || res.status === 403) throw new HfSearchError('Hugging Face rejected the request (check HF_TOKEN)')
  if (res.status === 429) throw new HfSearchError('Hugging Face rate limit reached; set HF_TOKEN or retry later')
  if (!res.ok) throw new HfSearchError(`Hugging Face returned HTTP ${res.status}`)

  let data
  try {
    data = await res.json()
  } catch {
    throw new HfSearchError('Hugging Face returned an invalid response')
  }
  if (!Array.isArray(data)) throw new HfSearchError('Hugging Face returned an unexpected response shape')

  return data.slice(0, limit).map(m => {
    const id = String((m && (m.id || m.modelId)) || '')
    return {
      id,
      downloads: Number.isFinite(m.downloads) ? m.downloads : 0,
      likes: Number.isFinite(m.likes) ? m.likes : 0,
      pipeline_tag: m.pipeline_tag ? String(m.pipeline_tag) : null,
      url: `https://huggingface.co/${id}`,
    }
  })
}

// Strip ANSI/control chars from remote text before printing to a terminal.
// eslint-disable-next-line no-control-regex
const clean = s => String(s).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/[\u0000-\u001f\u007f]/g, '')

export async function main(argv, { env = process.env, fetchImpl, io = {} } = {}) {
  const out = io.out || (s => process.stdout.write(s))
  const err = io.err || (s => process.stderr.write(s))
  try {
    const opts = parseArgs(argv)
    if (opts.help || !opts.sub) {
      out(usage())
      return opts.help ? 0 : 1
    }
    if (opts.sub !== 'search') throw new HfSearchError(`Unknown models command: ${opts.sub}`)
    const results = await searchModels(opts.query, { limit: opts.limit, token: env.HF_TOKEN, fetchImpl })
    if (opts.json) out(`${JSON.stringify(results, null, 2)}\n`)
    else if (!results.length) out('No models found.\n')
    else out(results.map(m => `${clean(m.id)}\t${m.pipeline_tag ? clean(m.pipeline_tag) : '-'}\t↓${m.downloads}\t♥${m.likes}`).join('\n') + '\n')
    return 0
  } catch (e) {
    if (!(e instanceof HfSearchError)) throw e
    err(`${e.message}\n`)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => process.exit(code))
}
