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
// Health-aware routing: providers sorted by latency*success-rate, so the
// free chain prefers whichever provider is responding best right now.
// New endpoints: /__switch/status (with health), /__switch/health (all providers).
// Bound to 127.0.0.1 only. Never logs headers or bodies.
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
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

// ── Provider health monitoring ────────────────────────────────────────────────
// Tracks per-provider latency, success rate, and last-checked timestamp so the
// free chain can prefer providers that are actually responding well right now.
const providerHealth = new Map() // provider -> { latencyMs, successes, failures, lastCheck }

function recordHealth(name, latencyMs, ok) {
  const h = providerHealth.get(name) ?? { latencyMs: 0, successes: 0, failures: 0, lastCheck: 0 }
  h.latencyMs = h.latencyMs ? Math.round(h.latencyMs * 0.7 + latencyMs * 0.3) : latencyMs
  if (ok) h.successes++; else h.failures++
  h.lastCheck = Date.now()
  providerHealth.set(name, h)
}

/** Failures as a fraction of attempts (0 when never tried) — drives sortByHealth. */
const failureRate = name => {
  const h = providerHealth.get(name)
  if (!h) return 0
  const total = h.successes + h.failures
  return total > 0 ? h.failures / total : 0
}

/** Sort chain providers by health score (lower = better): failure rate only.
 *  Latency is deliberately NOT part of the score: the chain order is already
 *  quality-ranked, and demoting a good-but-slower model in favour of a fast weak
 *  one made `deep` requests fall through to the weakest model in the pool.
 *  A provider that is failing sinks; healthy providers keep their ranked order. */
function sortByHealth(chain) {
  return [...chain].sort((a, b) => failureRate(a) - failureRate(b))
}

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

// ── Response cache ────────────────────────────────────────────────────────────
// Free providers meter by requests/day, and the agent team re-sends near-identical
// prompts constantly — task prompts, reviews, health checks — so an identical
// request burns another slice of an already-exhausted quota. Cache the answer and
// replay it for free. Only non-streaming, non-tool-calling replies are cached:
// a cached tool call would silently change what the agent does next.
const CACHE_FILE = path.join(DIR, 'response-cache.json')
const cacheCfg = () => ({ enabled: true, ttlMs: 3600_000, maxEntries: 200, ...(cfg().responseCache ?? {}) })
let cache = readJSON(CACHE_FILE, {})
let cacheStats = { hits: 0, misses: 0, saved: 0 } // saved = provider calls avoided

function cacheKey(oa) {
  // Keyed on the request only, NOT the provider: the round-robin rotation picks a
  // different provider each call, so including it would make identical requests
  // miss every time. The provider/model that answered is stored alongside.
  return crypto.createHash('sha256').update(JSON.stringify([
    oa.messages, oa.tools ?? null, oa.tool_choice ?? null,
    oa.max_tokens ?? null, oa.temperature ?? null, oa.stop ?? null,
  ])).digest('hex')
}

function cacheGet(key) {
  const c = cacheCfg()
  if (!c.enabled) return null
  const hit = cache[key]
  if (!hit) return null
  if (Date.now() - hit.at > c.ttlMs) { delete cache[key]; return null }
  return hit
}

function cachePut(key, openaiResponse, provider, model) {
  const c = cacheCfg()
  if (!c.enabled) return
  cache[key] = { at: Date.now(), openai: openaiResponse, provider, model }
  // Drop the oldest entries past the cap so the file stays bounded.
  const keys = Object.keys(cache)
  if (keys.length > c.maxEntries) {
    keys.sort((a, b) => cache[a].at - cache[b].at)
    for (const k of keys.slice(0, keys.length - c.maxEntries)) delete cache[k]
  }
  try {
    const tmp = `${CACHE_FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(cache))
    fs.renameSync(tmp, CACHE_FILE)
  } catch { /* disk full etc. — caching is best-effort */ }
}

/** True when a reply is safe to replay later (no tool calls the agent would act on). */
const cacheableReply = (oa, j) => {
  if (oa.stream) return false
  const msg = j?.choices?.[0]?.message ?? {}
  if ((msg.tool_calls ?? []).length) return false
  return true
}

// Bumped on every free-mode call and used to rotate which provider is tried
// first (see `serveFree`). Several concurrent agents (boss.mjs's worker swarm
// plus your own interactive session) all share this one proxy; always trying
// providers in the same fixed order means they all pile onto the same
// provider's daily quota at once. Round-robining the starting point spreads
// concurrent requests across openrouter/kilo/llm7/pollinations instead.
let rrCounter = 0

/** Serve a single provider/model slot (used for per-agent model pinning). */
async function serveFreeSingle(name, p, key, model, body, res, why) {
  const slot = `${name}/${model}`
  const startedAt = Date.now()
  const oa = toOpenAI(body, model)
  if (oa.tools && !(p.keepMcpTools ?? cfg().keepMcpTools)) {
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
  } catch (e) {
    providerCooldown.set(name, Date.now() + 60_000)
    sendError(res, 529, 'overloaded_error', `claude-switch: ${slot} failed (${e.name})`)
    return
  }
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ')
    log(`free ${slot} -> ${r.status} ${detail}`)
    if (r.status === 401) { providerCooldown.set(key ? name : slot, Date.now() + (key ? 3600_000 : 24 * 3600_000)) }
    if (r.status === 403) { providerCooldown.set(slot, Date.now() + 3600_000) }
    if (r.status === 400 && /not a valid model|model_not_found|does not exist|maximum context length/i.test(detail)) {
      providerCooldown.set(slot, Date.now() + 24 * 3600_000)
    }
    const after = Number(r.headers.get('retry-after') || detail.match(/retry.after\D{0,4}(\d+)/i)?.[1])
    const wait = r.status === 429 ? (after > 0 ? after * 1000 : 120_000) : 30_000
    const quota = r.status === 429 && /quota/i.test(detail)
    providerCooldown.set(quota ? name : slot, Date.now() + wait)
    sendError(res, r.status === 429 ? 429 : 502, 'api_error', `claude-switch: ${slot} -> ${r.status} ${detail}`)
    return
  }
  const banner = `⟦claude-switch: ${why} → ${name}/${model}⟧`
  // Serve from cache before spending a request on the provider.
  if (!oa.stream) {
    const hit = cacheGet(cacheKey(oa))
    if (hit) {
      cacheStats.hits++
      cacheStats.saved++
      log(`cache hit ${name}/${model} (${why}) — provider call avoided`)
      saveState({ last: { via: 'cache', provider: name, model, why, at: Date.now() } })
      recordHealth(name, 0, true)
      res.writeHead(200, { 'content-type': 'application/json', 'x-claude-switch-cache': 'hit' })
      return res.end(JSON.stringify(fromOpenAI(hit.openai, body.model, `⟦claude-switch: cached → ${name}/${model}⟧`)))
    }
    cacheStats.misses++
  }
  if (!oa.stream) {
    const j = await r.json().catch(() => null)
    const msg = j?.choices?.[0]?.message ?? {}
    const hasContent = !!msg.content || (msg.tool_calls ?? []).some(c => c.function?.name) || !!(msg.reasoning || msg.reasoning_content)
    if (!j || !hasContent) {
      providerCooldown.set(slot, Date.now() + 60_000)
      sendError(res, 529, 'overloaded_error', `claude-switch: ${slot} returned an empty reply`)
      return
    }
    log(`${why} -> free ${name}/${model}`)
    saveState({ last: { via: 'free', provider: name, model, why, at: Date.now() } })
    recordHealth(name, Date.now() - startedAt, true)
    if (cacheableReply(oa, j)) cachePut(cacheKey(oa), j, name, model)
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(fromOpenAI(j, body.model, banner)))
  }
  const t = streamTranslator(body.model, banner)
  const dec = new TextDecoder()
  let sse = ''
  try {
    for await (const chunk of r.body) sse += t.push(dec.decode(chunk, { stream: true }))
  } catch (e) { log(`free ${slot} stream broke: ${e.message}`) }
  sse += t.end()
  if (!t.hadContent()) {
    providerCooldown.set(slot, Date.now() + 60_000)
    sendError(res, 529, 'overloaded_error', `claude-switch: ${slot} returned an empty stream`)
    return
  }
  log(`${why} -> free ${name}/${model} (stream)`)
  saveState({ last: { via: 'free', provider: name, model, why, at: Date.now() } })
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  res.write(sse)
  return res.end()
}

/** Try each provider in `chain` until one answers; write an Anthropic-format response. */
async function serveFree(chain, body, res, why, agentName) {
  const c = cfg()
  const { forceModel } = state()
  const tried = []
  // Per-agent model pinning: if config.agentModels[agentName] exists, use only
  // that provider+model instead of the full chain. This is how the boss assigns
  // specific free models to specific workers.
  if (agentName) {
    const agentCfg = c.agentModels?.[agentName]
    if (agentCfg) {
      const p = c.providers?.[agentCfg.provider]
      if (p && p.enabled !== false) {
        const key = keyFor(agentCfg.provider, p)
        if (!p.needsKey || key) {
          return await serveFreeSingle(agentCfg.provider, p, key, agentCfg.model, body, res, why)
        }
        tried.push(`${agentCfg.provider}: no key`)
      } else {
        tried.push(`${agentCfg.provider}: not configured`)
      }
      sendError(res, 529, 'overloaded_error', `claude-switch: agent '${agentName}' provider unavailable (${tried.join('; ')})`)
      return
    }
  }
  // Health-aware ordering: sort by latency*success-rate, then round-robin within
  // the sorted order so the best-performing providers get tried first.
  const healthSorted = sortByHealth(chain)
  const offset = healthSorted.length ? rrCounter++ % healthSorted.length : 0
  const rotated = [...healthSorted.slice(offset), ...healthSorted.slice(0, offset)]
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
    const startedAt = Date.now()
    const oa = toOpenAI(body, model)
    // MCP tool schemas can be most of a Claude Code request (hundreds of KB);
    // free models choke on them and they burn free daily token quotas.
    if (oa.tools && !(p.keepMcpTools ?? c.keepMcpTools)) {
      oa.tools = oa.tools.filter(t => !t.function.name.startsWith('mcp__'))
      if (!oa.tools.length) { delete oa.tools; delete oa.tool_choice }
    }
    if (oa.max_tokens) oa.max_tokens = Math.min(oa.max_tokens, p.maxTokens ?? 8192)
    // Cache check before the provider call: an identical request must not cost
    // another slice of an exhausted free daily quota.
    if (!oa.stream) {
      const hit = cacheGet(cacheKey(oa))
      if (hit) {
        cacheStats.hits++
        cacheStats.saved++
        log(`cache hit ${name}/${model} (${why}) — provider call avoided`)
        saveState({ last: { via: 'cache', provider: name, model, why, at: Date.now() } })
        recordHealth(name, 0, true)
        res.writeHead(200, { 'content-type': 'application/json', 'x-claude-switch-cache': 'hit' })
        return res.end(JSON.stringify(fromOpenAI(hit.openai, body.model, `⟦claude-switch: cached → ${name}/${model}⟧`)))
      }
      cacheStats.misses++
    }
    let r
    try {
      r = await fetch(p.baseURL.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
        body: JSON.stringify(oa),
        signal: AbortSignal.timeout(p.timeoutMs ?? 300_000),
      })
    } catch (e) { tried.push(`${name}: ${e.name}`); providerCooldown.set(name, Date.now() + 60_000); recordHealth(name, Date.now() - startedAt, false); continue }
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
      recordHealth(name, Date.now() - startedAt, true)
      if (cacheableReply(oa, j)) cachePut(cacheKey(oa), j, name, model)
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
    recordHealth(name, Date.now() - startedAt, true)
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
      return res.end(JSON.stringify({ ...state(), providerCooldown: Object.fromEntries(providerCooldown), providerHealth: Object.fromEntries(providerHealth), cache: { ...cacheStats, entries: Object.keys(cache).length, ...cacheCfg() } }))
    }
    if (req.url === '/__switch/cache' && req.method === 'DELETE') {
      const n = Object.keys(cache).length
      cache = {}
      try { fs.rmSync(CACHE_FILE, { force: true }) } catch { /* already gone */ }
      cacheStats = { hits: 0, misses: 0, saved: 0 }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ cleared: n }))
    }
    if (req.url === '/__switch/health') {
      // Lightweight provider health check — tests each provider with a tiny request
      const c = cfg()
      const results = {}
      const chain = c.freeChain ?? Object.keys(c.providers ?? {}).filter(n => n !== 'omniroute')
      await Promise.all(chain.map(async name => {
        const p = c.providers?.[name]
        if (!p || p.enabled === false) { results[name] = { status: 'disabled' }; return }
        const key = keyFor(name, p)
        if (p.needsKey && !key) { results[name] = { status: 'no-key' }; return }
        const h = providerHealth.get(name)
        results[name] = h ? { status: 'ok', ...h } : { status: 'untested' }
      }))
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(results, null, 2))
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
    // Per-agent model pinning: boss.mjs workers send x-claude-switch-agent: <name>;
    // the proxy looks up config.agentModels[name] and routes to that exact provider/model.
    const agent = String(req.headers['x-claude-switch-agent'] ?? '').trim().toLowerCase()
    delete req.headers['x-claude-switch-agent'] // never forward it to Anthropic
    const routeFree = route === 'free' || route.startsWith('free:')
    // 'best' is the same chain as 'free' but ordered by measured provider health,
    // which `serveFree` already does — so it behaves identically to free here.
    const useFree = mode === 'free' || mode === 'best' || !!cfg().providers?.[mode] || proResting || routeFree

    if (useFree && isCount) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ input_tokens: estimateTokens(json() ?? {}) }))
    }
    if (useFree && isMessages) {
      const b = json()
      if (!b) return sendError(res, 400, 'invalid_request_error', 'claude-switch: body is not JSON')
      if (routeFree && !cfg().providers?.[mode]) return await serveFree(tierChain(route.slice(5)), b, res, `worker ${route}`, agent)
      return await serveFree(chainFor(mode), b, res, proResting ? 'pro limit (until ' + new Date(proCooldownUntil).toLocaleTimeString() + ')' : `mode ${mode}`, agent)
    }

    let up
    try { up = await toAnthropic(req, body) } catch (e) {
      // Anthropic unreachable: in auto mode serve this one request from free models.
      const b = isMessages && mode === 'auto' && json()
      if (!b) throw e
      log(`Anthropic unreachable (${e.message}) -> free for this request`)
      return await serveFree(chainFor('free'), b, res, 'anthropic unreachable', agent)
    }
    if ((up.statusCode === 529 || up.statusCode >= 500) && isMessages && mode === 'auto') {
      // Overloaded / outage: fall back for this request only, no cooldown.
      const b = json()
      if (b) {
        up.resume()
        log(`Anthropic ${up.statusCode} -> free for this request`)
        return await serveFree(chainFor('free'), b, res, `anthropic ${up.statusCode}`, agent)
      }
    }
    if (up.statusCode === 429 && isMessages && mode === 'auto') {
      up.resume() // discard Anthropic's 429 body
      const until = resetFrom(up.headers)
      saveState({ proCooldownUntil: until })
      log(`Claude Pro limit hit (429) -> free models until ${new Date(until).toISOString()}`)
      const b = json()
      if (b) return await serveFree(chainFor('free'), b, res, 'pro limit just hit', agent)
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
