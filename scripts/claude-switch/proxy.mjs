#!/usr/bin/env node
// claude-switch proxy: Claude Code -> (Claude Pro subscription | free LLM APIs).
// Claude Code points ANTHROPIC_BASE_URL here. Your claude.ai login keeps flowing
// to Anthropic untouched; only when Anthropic answers 429 (usage limit) does the
// same request get served by free OpenAI-compatible providers, until the reset.
// Mode (auto | pro | free | <any provider name>) is read from state.json on
// every request, so `claude-mode <mode>` switches instantly, no restart.
// `claude-mode pick <provider> <model>` additionally pins one exact model.
// Each served reply is tagged with which provider/model answered (see BANNER_RE
// in translate.mjs) and the choice is recorded in state.json as `last`, so
// `claude-mode status` always shows what actually ran.
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

/** Pick a free model on OpenRouter that supports tool calling (cached 1h).
 *  Some free models have no ":free" suffix (e.g. stealth/space-bunny-alpha), so
 *  go by price rather than by name, and skip openrouter/free itself (a router,
 *  not a model, which would defeat per-model cooldown). */
let orCache = { at: 0, model: null }
async function openRouterFreeModel(p) {
  if (p.model && p.model !== 'auto-free') return p.model
  if (orCache.model && Date.now() - orCache.at < 3600_000) return orCache.model
  const key = keyFor('openrouter', p)
  const r = await fetch('https://openrouter.ai/api/v1/models', {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  })
  const { data = [] } = await r.json()
  const free = data.filter(m => m.id !== 'openrouter/free'
      && `${m.pricing?.prompt}` === '0' && `${m.pricing?.completion}` === '0'
      && (m.supported_parameters ?? []).includes('tools'))
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
  orCache = { at: Date.now(), model: free[0]?.id ?? 'openrouter/free' }
  return orCache.model
}

function keyFor(name, p) {
  return p.key || (p.keyEnv && process.env[p.keyEnv]) || ''
}

// Bumped on every free-mode call and used to rotate which provider is tried
// first (see `serveFree`). Several concurrent agents (boss.mjs's worker swarm
// plus your own interactive session) all share this one proxy; always trying
// providers in the same fixed order means they all pile onto the same
// provider's daily quota at once. Round-robining the starting point spreads
// concurrent requests across openrouter/kilo/llm7/pollinations instead.
let rrCounter = 0

/** Try each provider in `chain` until one answers; write an Anthropic-format response. */
async function serveFree(chain, body, res, why) {
  const c = cfg()
  const { forceModel } = state()
  const tried = []
  const offset = chain.length ? rrCounter++ % chain.length : 0
  const rotated = [...chain.slice(offset), ...chain.slice(0, offset)]
  // Expand providers into (provider, model) slots: a provider with `models: [...]`
  // gets one slot per model, so one rate-limited model doesn't sink the provider.
  const slots = []
  for (const name of rotated) {
    const p = c.providers?.[name]
    if (!p || p.enabled === false) continue
    const key = keyFor(name, p)
    if (p.needsKey && !key) { tried.push(`${name}: no key`); continue }
    if ((providerCooldown.get(name) ?? 0) > Date.now()) { tried.push(`${name}: cooling down`); continue }
    // `claude-mode pick <provider> <model>` pins an exact model: skip the
    // provider's own model list and try only the pinned one.
    if (forceModel && forceModel.provider === name) { slots.push({ name, p, key, model: forceModel.model }); continue }
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
      // A bad key sinks the whole provider — but only if we actually sent one;
      // a 401 with no key just means this particular model needs a key we
      // don't have (some providers mix free-anonymous and key-gated models in
      // one `models` list), so bench only that slot, and for a long time since
      // it'll never succeed without a key being added.
      // 403 is often model-specific too (e.g. a model restricted to certain
      // apps), so it only benches that model.
      if (r.status === 401) { providerCooldown.set(key ? name : slot, Date.now() + (key ? 3600_000 : 24 * 3600_000)); continue }
      if (r.status === 403) { providerCooldown.set(slot, Date.now() + 3600_000); continue }
      // 400 means this request is malformed for this model; benching the model
      // would also block the next, well-formed request. But some 400s are
      // permanent (bad model id, context window too small for Claude Code's
      // typical MCP-tool-schema-heavy requests) and would otherwise be retried
      // on every single turn forever, wasting a round trip each time.
      if (r.status === 400) {
        if (/not a valid model|model_not_found|does not exist|maximum context length/i.test(detail)) {
          providerCooldown.set(slot, Date.now() + 24 * 3600_000)
        }
        continue
      }
      const after = Number(r.headers.get('retry-after') || detail.match(/retry.after\D{0,4}(\d+)/i)?.[1])
      const wait = r.status === 429 ? (after > 0 ? after * 1000 : 120_000) : 30_000
      // A daily/account quota covers every model on the provider.
      const quota = r.status === 429 && /quota/i.test(detail)
      providerCooldown.set(quota ? name : slot, Date.now() + wait)
      continue
    }
    // Tag the reply so the user can see, right in Claude Code, which free
    // provider/model actually answered (stripped back out of history before
    // it's replayed upstream — see BANNER_RE in translate.mjs).
    const banner = `⟦claude-switch: ${why} → ${name}/${model}⟧`
    if (!oa.stream) {
      const j = await r.json().catch(() => null)
      const msg = j?.choices?.[0]?.message ?? {}
      const hasContent = !!msg.content || (msg.tool_calls ?? []).some(c => c.function?.name) || !!(msg.reasoning || msg.reasoning_content)
      if (!j || !hasContent) {
        // A 200 with nothing in it (provider quietly rate-limited or cut the
        // request short): don't show the user silence or a dead end — try the
        // next model/provider instead, same as any other failure.
        tried.push(`${slot}: empty reply`)
        log(`free ${slot} -> 200 but empty, trying next`)
        providerCooldown.set(slot, Date.now() + 60_000)
        continue
      }
      log(`${why} -> free ${name}/${model}`)
      saveState({ last: { via: 'free', provider: name, model, why, at: Date.now() } })
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(fromOpenAI(j, body.model, banner)))
    }
    // Stream: buffer the whole translated reply (don't commit to the client)
    // so an empty reply can still fall through to the next model/provider,
    // exactly like the non-stream path above.
    const t = streamTranslator(body.model, banner)
    const dec = new TextDecoder()
    let sse = ''
    try {
      for await (const chunk of r.body) sse += t.push(dec.decode(chunk, { stream: true }))
    } catch (e) { log(`free ${slot} stream broke: ${e.message}`) }
    sse += t.end()
    if (!t.hadContent()) {
      tried.push(`${slot}: empty reply (stream)`)
      log(`free ${slot} -> empty stream, trying next`)
      providerCooldown.set(slot, Date.now() + 60_000)
      continue
    }
    log(`${why} -> free ${name}/${model} (stream)`)
    saveState({ last: { via: 'free', provider: name, model, why, at: Date.now() } })
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.write(sse)
    return res.end()
  }
  log(`${why}: every free provider failed (${tried.join('; ')})`)
  sendError(res, 529, 'overloaded_error', `claude-switch: no free provider available (${tried.join('; ')}). Add keys with: claude-mode key <provider> <key>`)
}

/** Free chain for a task tier (deep | balanced | fast) from config `tierChains`,
 *  falling back to the normal free chain. Lets the boss pick models per task. */
function tierChain(tier) {
  const chains = cfg().tierChains ?? {}
  return chains[tier] ?? chainFor('free')
}

function chainFor(mode) {
  const c = cfg()
  // Any mode matching a provider name forces that single provider's own
  // model list (still with auto-fallback across that provider's models,
  // unless a model is also pinned via `claude-mode pick <provider> <model>`).
  if (c.providers?.[mode]) return [mode]
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
    // A client can ask for free models per request (the GhostForge boss sends
    // this for its workers so Pro is kept for the boss): "free" or "free:<tier>".
    const route = String(req.headers['x-claude-switch-route'] ?? '').trim().toLowerCase()
    delete req.headers['x-claude-switch-route'] // never forward it to Anthropic
    const routeFree = route === 'free' || route.startsWith('free:')
    const useFree = mode === 'free' || !!cfg().providers?.[mode] || proResting || routeFree

    if (useFree && isCount) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ input_tokens: estimateTokens(json() ?? {}) }))
    }
    if (useFree && isMessages) {
      const b = json()
      if (!b) return sendError(res, 400, 'invalid_request_error', 'claude-switch: body is not JSON')
      if (routeFree && !cfg().providers?.[mode]) return await serveFree(tierChain(route.slice(5)), b, res, `worker ${route}`)
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
    if (isMessages && up.statusCode < 400) {
      const b = json()
      if (b) saveState({ last: { via: 'pro', provider: 'anthropic', model: b.model ?? 'claude', at: Date.now() } })
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
