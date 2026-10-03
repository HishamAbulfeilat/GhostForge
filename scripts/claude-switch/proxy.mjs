#!/usr/bin/env node
// claude-switch proxy: Claude Code -> (Claude Pro subscription | free LLM APIs).
// Claude Code points ANTHROPIC_BASE_URL here. Your claude.ai login keeps flowing
// to Anthropic untouched; only when Anthropic answers 429 (usage limit) does the
// same request get served by free OpenAI-compatible providers, until the reset.
// Mode (auto | pro | free | openrouter | omniroute) is read from state.json on
// every request, so `claude-mode <mode>` switches instantly, no restart.
// Bound to 127.0.0.1 only. Never logs headers or bodies.
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toOpenAI, fromOpenAI, streamTranslator, estimateTokens } from './translate.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const CONFIG = path.join(DIR, 'config.json')
const STATE = path.join(DIR, 'state.json')
const LOG = path.join(DIR, 'proxy.log')
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const cfg = () => readJSON(CONFIG, {})
const state = () => ({ mode: 'auto', proCooldownUntil: 0, ...readJSON(STATE, {}) })
const saveState = patch => fs.writeFileSync(STATE, JSON.stringify({ ...state(), ...patch }, null, 2))
const log = msg => { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`) } catch { /* disk full etc. */ } }
const providerCooldown = new Map() // provider -> epoch ms

const HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'proxy-connection', 'upgrade'])

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject)
  })
}

/** Forward to Anthropic as-is. Resolves with the upstream response (not yet consumed). */
function toAnthropic(req, body) {
  const base = new URL(cfg().anthropicBaseURL || 'https://api.anthropic.com')
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v
  headers['content-length'] = body.length
  return new Promise((resolve, reject) => {
    const lib = base.protocol === 'http:' ? http : https
    const up = lib.request({ host: base.hostname, port: base.port || (lib === http ? 80 : 443), path: req.url, method: req.method, headers }, resolve)
    up.on('error', reject)
    up.end(body)
  })
}

function sendError(res, status, type, message) {
  if (res.headersSent) return res.end()
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ type: 'error', error: { type, message } }))
}

/** Pick a free model on OpenRouter that supports tool calling (cached 1h). */
let orCache = { at: 0, model: null }
async function openRouterFreeModel(p) {
  if (p.model && p.model !== 'auto-free') return p.model
  if (orCache.model && Date.now() - orCache.at < 3600_000) return orCache.model
  const r = await fetch('https://openrouter.ai/api/v1/models')
  const { data = [] } = await r.json()
  const free = data.filter(m => m.id.endsWith(':free') && (m.supported_parameters ?? []).includes('tools'))
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
  orCache = { at: Date.now(), model: free[0]?.id ?? 'openrouter/free' }
  return orCache.model
}

function keyFor(name, p) {
  return p.key || (p.keyEnv && process.env[p.keyEnv]) || ''
}

/** Try each provider in `chain` until one answers; write an Anthropic-format response. */
async function serveFree(chain, body, res, why) {
  const c = cfg()
  const tried = []
  // Expand providers into (provider, model) slots: a provider with `models: [...]`
  // gets one slot per model, so one rate-limited model doesn't sink the provider.
  const slots = []
  for (const name of chain) {
    const p = c.providers?.[name]
    if (!p || p.enabled === false) continue
    const key = keyFor(name, p)
    if (p.needsKey && !key) { tried.push(`${name}: no key`); continue }
    if ((providerCooldown.get(name) ?? 0) > Date.now()) { tried.push(`${name}: cooling down`); continue }
    if (p.models?.length) { for (const m of p.models) slots.push({ name, p, key, model: m }); continue }
    let model
    try { model = name === 'openrouter' ? await openRouterFreeModel(p) : p.model } catch { model = p.model }
    slots.push({ name, p, key, model })
  }
  for (const { name, p, key, model } of slots) {
    const slot = `${name}/${model}`
    if ((providerCooldown.get(name) ?? 0) > Date.now()) continue // provider went down mid-loop
    if ((providerCooldown.get(slot) ?? 0) > Date.now()) { tried.push(`${slot}: cooling down`); continue }
    const oa = toOpenAI(body, model)
    // MCP tool schemas can be most of a Claude Code request (hundreds of KB);
    // free models choke on them and they burn free daily token quotas.
    if (oa.tools && !(p.keepMcpTools ?? c.keepMcpTools)) {
      oa.tools = oa.tools.filter(t => !t.function.name.startsWith('mcp__'))
      if (!oa.tools.length) { delete oa.tools; delete oa.tool_choice }
    }
    if (oa.max_tokens) oa.max_tokens = Math.min(oa.max_tokens, p.maxTokens ?? 8192)
    let r
    try {
      r = await fetch(p.baseURL.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
        body: JSON.stringify(oa),
        signal: AbortSignal.timeout(p.timeoutMs ?? 300_000),
      })
    } catch (e) { tried.push(`${name}: ${e.name}`); providerCooldown.set(name, Date.now() + 60_000); continue }
    if (!r.ok) {
      const detail = (await r.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ')
      tried.push(`${slot}: ${r.status}`)
      log(`free ${slot} -> ${r.status} ${detail}`)
      // Auth failures sink the whole provider; rate limits and errors only this model.
      if (r.status === 401 || r.status === 403) { providerCooldown.set(name, Date.now() + 3600_000); continue }
      const after = Number(r.headers.get('retry-after') || detail.match(/retry.afterD{0,4}(d+)/i)?.[1])
      const wait = r.status === 429 ? (after > 0 ? after * 1000 : 120_000) : 30_000
      // A daily/account quota covers every model on the provider.
      const quota = r.status === 429 && /quota/i.test(detail)
      providerCooldown.set(quota ? name : slot, Date.now() + wait)
      continue
    }
    log(`${why} -> free ${name}/${model}${oa.stream ? ' (stream)' : ''}`)
    if (!oa.stream) {
      const j = await r.json()
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(fromOpenAI(j, body.model)))
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const t = streamTranslator(body.model)
    const dec = new TextDecoder()
    try {
      for await (const chunk of r.body) res.write(t.push(dec.decode(chunk, { stream: true })))
    } catch (e) { log(`free ${name} stream broke: ${e.message}`) }
    res.write(t.end())
    return res.end()
  }
  log(`${why}: every free provider failed (${tried.join('; ')})`)
  sendError(res, 529, 'overloaded_error', `claude-switch: no free provider available (${tried.join('; ')}). Add keys with: claude-mode key <provider> <key>`)
}

function chainFor(mode) {
  const c = cfg()
  if (mode === 'openrouter') return ['openrouter']
  if (mode === 'omniroute') return ['omniroute']
  return c.freeChain ?? Object.keys(c.providers ?? {}).filter(n => n !== 'omniroute')
}

/** Seconds-until-reset from Anthropic's 429 headers, as an epoch-ms deadline. */
function resetFrom(h) {
  const unified = Number(h['anthropic-ratelimit-unified-reset'])
  if (unified > 1e9) return unified * 1000
  const iso = Date.parse(h['anthropic-ratelimit-tokens-reset'] || h['anthropic-ratelimit-requests-reset'] || '')
  if (iso) return iso
  const after = Number(h['retry-after'])
  return Date.now() + (after > 0 ? after * 1000 : 30 * 60_000)
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/__switch/status') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ...state(), providerCooldown: Object.fromEntries(providerCooldown) }))
    }
    const body = await readBody(req)
    const isMessages = req.method === 'POST' && req.url.split('?')[0] === '/v1/messages'
    const isCount = req.method === 'POST' && req.url.startsWith('/v1/messages/count_tokens')
    const { mode, proCooldownUntil } = state()
    const json = () => { try { return JSON.parse(body.toString('utf8')) } catch { return null } }
    const proResting = mode === 'auto' && proCooldownUntil > Date.now()
    const useFree = mode === 'free' || mode === 'openrouter' || mode === 'omniroute' || proResting

    if (useFree && isCount) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ input_tokens: estimateTokens(json() ?? {}) }))
    }
    if (useFree && isMessages) {
      const b = json()
      if (!b) return sendError(res, 400, 'invalid_request_error', 'claude-switch: body is not JSON')
      return await serveFree(chainFor(mode), b, res, proResting ? 'pro limit (until ' + new Date(proCooldownUntil).toLocaleTimeString() + ')' : `mode ${mode}`)
    }

    let up
    try { up = await toAnthropic(req, body) } catch (e) {
      // Anthropic unreachable: in auto mode serve this one request from free models.
      const b = isMessages && mode === 'auto' && json()
      if (!b) throw e
      log(`Anthropic unreachable (${e.message}) -> free for this request`)
      return await serveFree(chainFor('free'), b, res, 'anthropic unreachable')
    }
    if ((up.statusCode === 529 || up.statusCode >= 500) && isMessages && mode === 'auto') {
      // Overloaded / outage: fall back for this request only, no cooldown.
      const b = json()
      if (b) {
        up.resume()
        log(`Anthropic ${up.statusCode} -> free for this request`)
        return await serveFree(chainFor('free'), b, res, `anthropic ${up.statusCode}`)
      }
    }
    if (up.statusCode === 429 && isMessages && mode === 'auto') {
      up.resume() // discard Anthropic's 429 body
      const until = resetFrom(up.headers)
      saveState({ proCooldownUntil: until })
      log(`Claude Pro limit hit (429) -> free models until ${new Date(until).toISOString()}`)
      const b = json()
      if (b) return await serveFree(chainFor('free'), b, res, 'pro limit just hit')
    }
    const headers = {}
    for (const [k, v] of Object.entries(up.headers)) if (!HOP.has(k)) headers[k] = v
    res.writeHead(up.statusCode, headers)
    up.pipe(res)
  } catch (e) {
    log(`proxy error: ${e.message}`)
    sendError(res, 502, 'api_error', `claude-switch proxy error: ${e.message}`)
  }
})

const port = Number(process.env.CLAUDE_SWITCH_PORT || cfg().port || 3457)
server.listen(port, '127.0.0.1', () => {
  fs.writeFileSync(path.join(DIR, 'proxy.pid'), String(process.pid))
  log(`listening on 127.0.0.1:${port} (mode ${state().mode})`)
})
server.on('error', e => { log(`listen failed: ${e.message}`); process.exit(1) })
