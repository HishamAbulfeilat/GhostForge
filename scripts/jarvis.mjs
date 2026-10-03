#!/usr/bin/env node
// Talk to the local JARVIS bridge (mark-l-bridge, :8765).
// Usage: ghostforge jarvis health [--json]
//        ghostforge jarvis ask <prompt> [--json]
// Env: MARKL_BRIDGE_URL (default http://127.0.0.1:8765), MARKL_BRIDGE_TOKEN
// (else ~/.ghostforge/bridge/token). The token is sent as a bearer header and never printed.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_URL = 'http://127.0.0.1:8765'
const HEALTH_PATH = '/api/mark-l/health'
const CHAT_PATH = '/api/mark-l/chat/unified'
const MAX_PROMPT = 4000
const MAX_OUTPUT = 8000
const TIMEOUT_MS = { health: 8000, ask: 70000 }

export class JarvisError extends Error {}

function usage() {
  return [
    'Usage: ghostforge jarvis health [--json]',
    '       ghostforge jarvis ask <prompt> [--json]',
    '',
    '  health   Check the JARVIS bridge (/api/mark-l/health)',
    '  ask      Send a prompt to the bridge unified chat endpoint',
    '  --json   Print the raw bridge response as JSON',
    '',
    'Env: MARKL_BRIDGE_URL (default http://127.0.0.1:8765), MARKL_BRIDGE_TOKEN',
    '     (else ~/.ghostforge/bridge/token). Non-loopback URLs need GF_ALLOW_REMOTE_BRIDGE=1.',
    '',
  ].join('\n')
}

export function parseArgs(argv) {
  const opts = { help: false, json: false, sub: null, prompt: '' }
  const words = []
  for (const a of argv) {
    if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--json') opts.json = true
    else if (a.startsWith('-')) throw new JarvisError(`Unknown option: ${a}`)
    else words.push(a)
  }
  opts.sub = words.shift() || null
  opts.prompt = words.join(' ').trim()
  return opts
}

export function bridgeConfig(env = process.env, readToken = f => readFileSync(f, 'utf8')) {
  let url
  try {
    url = new URL(env.MARKL_BRIDGE_URL?.trim() || DEFAULT_URL)
  } catch {
    throw new JarvisError('MARKL_BRIDGE_URL must be an absolute http(s) URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new JarvisError('MARKL_BRIDGE_URL must contain only an http(s) scheme, host, and optional port.')
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
  if (!loopback && env.GF_ALLOW_REMOTE_BRIDGE !== '1') {
    throw new JarvisError('MARKL_BRIDGE_URL is not loopback; set GF_ALLOW_REMOTE_BRIDGE=1 to opt in.')
  }
  let token = env.MARKL_BRIDGE_TOKEN?.trim()
  if (!token) {
    const tokenPath = path.join(homedir(), '.ghostforge', 'bridge', 'token')
    try {
      token = readToken(tokenPath).trim()
    } catch (e) {
      if (e.code === 'ENOENT') throw new JarvisError(`Bridge token not found. Set MARKL_BRIDGE_TOKEN or create ${tokenPath}.`)
      throw new JarvisError(`Could not read bridge token at ${tokenPath}: ${e.message}`)
    }
  }
  if (!token) throw new JarvisError('Bridge token is empty. Set MARKL_BRIDGE_TOKEN or check the bridge token file.')
  if (/[\r\n]/.test(token)) throw new JarvisError('Bridge token contains invalid characters.')
  return { baseUrl: url.origin, token }
}

export async function bridgeRequest(pathname, { config, method = 'GET', body, timeoutMs, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new JarvisError('fetch is not available (Node 18+ required)')
  const headers = { Accept: 'application/json', Authorization: `Bearer ${config.token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetchImpl(`${config.baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new JarvisError(timedOut
      ? 'The JARVIS bridge request timed out.'
      : `Bridge offline: cannot reach the JARVIS bridge at ${config.baseUrl}. Start it with mark-l-bridge/start.sh and retry.`)
  }
  if (res.status === 401 || res.status === 403) throw new JarvisError('Bridge rejected the token (401). Check MARKL_BRIDGE_TOKEN or ~/.ghostforge/bridge/token.')
  if (res.status === 503) throw new JarvisError('Bridge reported the requested module or token is unavailable (503).')
  if (!res.ok) throw new JarvisError(`Bridge returned HTTP ${res.status}`)
  try {
    return await res.json()
  } catch {
    throw new JarvisError('Bridge returned an invalid response')
  }
}

// Strip ANSI/control chars from bridge text before printing to a terminal.
// eslint-disable-next-line no-control-regex
const clean = s => String(s).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ')
const cap = s => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated]` : s)

function replyText(data) {
  const r = data && typeof data === 'object' && data.data !== undefined ? data.data : data
  const inner = r && typeof r === 'object' && r.response !== undefined ? r.response : r
  if (typeof inner === 'string') return inner
  if (inner && typeof inner === 'object') {
    for (const k of ['reply', 'text', 'message', 'response', 'answer', 'output']) {
      if (typeof inner[k] === 'string') return inner[k]
    }
  }
  return JSON.stringify(inner ?? null, null, 2)
}

export async function main(argv, { env = process.env, fetchImpl, readToken, io = {} } = {}) {
  const out = io.out || (s => process.stdout.write(s))
  const err = io.err || (s => process.stderr.write(s))
  try {
    const opts = parseArgs(argv)
    if (opts.help || !opts.sub) {
      out(usage())
      return opts.help ? 0 : 1
    }
    if (!['health', 'ask'].includes(opts.sub)) throw new JarvisError(`Unknown jarvis command: ${opts.sub}`)
    if (opts.sub === 'ask') {
      if (!opts.prompt) throw new JarvisError('Prompt is required: ghostforge jarvis ask <prompt>')
      if (opts.prompt.length > MAX_PROMPT) throw new JarvisError(`Prompt too long (max ${MAX_PROMPT} characters)`)
    }
    const config = bridgeConfig(env, readToken)
    if (opts.sub === 'health') {
      const data = await bridgeRequest(HEALTH_PATH, { config, timeoutMs: TIMEOUT_MS.health, fetchImpl })
      if (opts.json) out(`${JSON.stringify(data, null, 2)}\n`)
      else {
        const missing = Array.isArray(data.unavailable_modules) ? data.unavailable_modules : []
        out(`${data.ok ? 'OK' : 'NOT OK'}\t${clean(data.service || 'bridge')} ${clean(data.version || '')}\tunavailable modules: ${missing.length}\n`)
      }
      return data.ok ? 0 : 1
    }
    const data = await bridgeRequest(CHAT_PATH, {
      config, method: 'POST', body: { message: opts.prompt }, timeoutMs: TIMEOUT_MS.ask, fetchImpl,
    })
    if (opts.json) out(`${JSON.stringify(data, null, 2)}\n`)
    else out(`${cap(clean(replyText(data)))}\n`)
    return 0
  } catch (e) {
    if (!(e instanceof JarvisError)) throw e
    err(`${e.message}\n`)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => process.exit(code))
}
