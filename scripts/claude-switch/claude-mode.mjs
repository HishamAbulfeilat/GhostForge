#!/usr/bin/env node
// claude-mode: control + inspect the claude-switch proxy.
//
// Modes (where Claude Code's requests go):
//   (none)    show mode, effective model, pinned model, agent assignments
//   auto      Pro first, auto-fallback to free chain on 429 (default)
//   pro       Anthropic directly, never falls back
//   free      the free provider chain, in configured order
//   best      the free chain, re-ordered live by measured health (fastest + most reliable first)
//   <name>    force one provider's own models (e.g. openrouter, kilo, gemini)
//
// Free models:
//   models                 list every configured free model with its live status
//   probe [--apply]        test every model now, rank by speed, optionally re-order the chain
//   use <n|query>          switch to one model by list number, "provider/model", or partial name
//   unpin                  stop pinning; go back to the chain
//
// Keys & agents:
//   key <provider> <key>   store a provider API key in config.json
//   agent [name]           show/set per-agent model assignment
//
// Proxy:
//   start | stop           manage the background proxy process
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const CONFIG = path.join(DIR, 'config.json')
const STATE = path.join(DIR, 'state.json')
const PIDFILE = path.join(DIR, 'proxy.pid')
const PROBE = path.join(DIR, 'probe.json')
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const cfg = () => readJSON(CONFIG, {})
const state = () => ({ mode: 'auto', proCooldownUntil: 0, ...readJSON(STATE, {}) })
const saveState = patch => fs.writeFileSync(STATE, JSON.stringify({ ...state(), ...patch }, null, 2))
const writeJSON = (f, data) => {
  const tmp = `${f}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, f)
}

const MODES = ['auto', 'pro', 'free', 'best', 'openrouter', 'omniroute']
const [cmd, a, b] = process.argv.slice(2)
const port = () => process.env.CLAUDE_SWITCH_PORT || cfg().port || 3457
const ANTHROPIC_URL = 'https://api.anthropic.com'
const SETTINGS = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'settings.json')
const PROBE_TTL = 6 * 3600_000 // a probe result older than 6h is stale

// Plain ASCII only: this runs in a Windows console where unicode renders as mojibake.
const c = {
  bold: s => `\x1b[1m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m`,
}

const keyFor = (name, p) => p?.key || (p?.keyEnv && process.env[p.keyEnv]) || ''

/** Every (provider, model) the config can serve, in chain order. */
function allModels() {
  const conf = cfg()
  const chain = conf.freeChain ?? Object.keys(conf.providers ?? {}).filter(n => n !== 'omniroute')
  const seen = new Set()
  const out = []
  for (const name of chain) {
    const p = conf.providers?.[name]
    if (!p) continue
    for (const model of (p.models ?? [p.model])) {
      const slot = `${name}/${model}`
      if (!model || seen.has(slot)) continue
      seen.add(slot)
      out.push({ provider: name, model, slot, needsKey: !!p.needsKey, hasKey: !!keyFor(name, p) })
    }
  }
  return out
}

function statusOf(entry, probe) {
  const r = probe?.results?.[entry.slot]
  if (r) return r
  if (entry.needsKey && !entry.hasKey) return { status: 'no-key', note: 'needs an API key' }
  return { status: 'unknown', note: 'run: claude-mode probe' }
}

const STATUS_STYLE = {
  200: s => c.green(s), ok: s => c.green(s),
  429: s => c.yellow(s), 'no-key': s => c.dim(s), unknown: s => c.dim(s),
  404: s => c.red(s), 401: s => c.red(s), 403: s => c.red(s), 402: s => c.red(s),
}

function printModels() {
  const models = allModels()
  const probe = readJSON(PROBE, null)
  const age = probe ? Math.round((Date.now() - probe.at) / 60000) : null
  const s = state()
  const pinned = s.forceModel ? `${s.forceModel.provider}/${s.forceModel.model}` : null
  console.log(c.bold(`\nFree models (${models.length})`))
  if (pinned) console.log(c.yellow(`PINNED: ${pinned} -- every free request uses this. Clear with: claude-mode unpin`))
  console.log(c.dim(probe ? `live status from ${age} min ago (refresh: claude-mode probe)` : 'not probed yet -- run: claude-mode probe') + '\n')
  const rows = models.map((m, i) => {
    const st = statusOf(m, probe)
    const style = STATUS_STYLE[String(st.status)] ?? (x => x)
    const speed = st.ms != null ? `${String(st.ms).padStart(6)}ms` : '      -'
    const q = ((cfg().modelQuality ?? {})[m.slot] ?? 50)
    const note = st.note ? `  ${st.note}` : ''
    return `  ${String(i + 1).padStart(2)}. ${style(String(st.status).padEnd(6))} q${String(q).padStart(3)} ${speed}  ${c.bold(m.slot)}${note}`
  })
  console.log(rows.join('\n'))
  console.log(c.dim(`\nSwitch:  claude-mode use <number>   e.g.  claude-mode use 3`))
  console.log(c.dim(`      or claude-mode use <query>     e.g.  claude-mode use nemotron`))
  console.log(c.dim(`Re-test all + re-order the chain best-first:  claude-mode probe --apply`))
  console.log(c.dim(`Let the proxy pick the best available every request:  claude-mode best`))
}

// pro talks to Anthropic directly; every other mode goes through the proxy.
const baseURLFor = mode => mode === 'pro' ? ANTHROPIC_URL : `http://127.0.0.1:${port()}`

/** Set env.ANTHROPIC_BASE_URL in ~/.claude/settings.json (other keys untouched). */
function setBaseURL(url) {
  let s = {}
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) } catch (e) {
    if (fs.existsSync(SETTINGS)) { console.error(`cannot parse ${SETTINGS}: ${e.message} (left unchanged)`); return false }
  }
  if (s.env?.ANTHROPIC_BASE_URL === url) return true
  s.env = { ...s.env, ANTHROPIC_BASE_URL: url }
  const tmp = SETTINGS + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n')
  fs.renameSync(tmp, SETTINGS)
  return true
}

function currentBaseURL() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).env?.ANTHROPIC_BASE_URL ?? '(unset)' } catch { return '(unreadable)' }
}

function isRunning() {
  const pid = Number(readJSON(PIDFILE, NaN))
  if (!pid) return false
  try { process.kill(pid, 0); return pid } catch { return false }
}

function start() {
  const running = isRunning()
  if (running) return console.log(`proxy already running (pid ${running})`)
  const child = spawn(process.execPath, [path.join(DIR, 'proxy.mjs')], { detached: true, stdio: 'ignore' })
  child.unref()
  console.log(`proxy starting (pid ${child.pid}) on 127.0.0.1:${port()}`)
}

function stop() {
  const pid = isRunning()
  if (!pid) return console.log('proxy is not running')
  try { process.kill(pid) } catch { /* already gone */ }
  fs.rmSync(PIDFILE, { force: true })
  console.log('proxy stopped')
}

function printStatus() {
  const s = state()
  const c0 = cfg()
  const until = s.proCooldownUntil > Date.now() ? new Date(s.proCooldownUntil).toLocaleString() : null
  console.log(`mode: ${c.bold(s.mode)}`)
  if (s.mode === 'best') console.log(c.dim('  best = quality-ranked free chain, re-ordered live by measured health'))
  if (s.mode === 'auto') console.log(c.dim('  auto = Claude Pro first, free chain when Pro rate-limits'))
  if (until) console.log(`Pro resting until: ${until} (auto mode serves free providers until then)`)
  if (s.forceModel) console.log(`pinned model: ${c.yellow(`${s.forceModel.provider}/${s.forceModel.model}`)}  (clear: claude-mode unpin)`)
  else console.log('pinned model: none (using the chain order)')

  const chain = c0.freeChain ?? Object.keys(c0.providers ?? {}).filter(n => n !== 'omniroute')
  console.log('\nfree chain:')
  for (const name of chain) {
    const p = c0.providers?.[name] ?? {}
    const hasKey = !p.needsKey || !!(p.key || (p.keyEnv && process.env[p.keyEnv]))
    const models = (p.models ?? [p.model]).join(', ')
    const tag = hasKey ? c.green('ready') : c.red('NO KEY')
    console.log(`  - ${name}: ${tag}  [${models}]`)
  }

  const last = s.last
  if (last) console.log(`\nlast served: ${c.cyan(`${last.provider}/${last.model}`)} (${last.why})`)

  const am = c0.agentModels ?? {}
  if (Object.keys(am).length) {
    console.log('\nagent model assignments:')
    for (const [name, acfg] of Object.entries(am)) {
      const p = c0.providers?.[acfg.provider] ?? {}
      const hasKey = !p.needsKey || !!(p.key || (p.keyEnv && process.env[p.keyEnv]))
      console.log(`  - ${name}: ${acfg.provider}/${acfg.model}${hasKey ? '' : '  [NO KEY]'}`)
    }
  }

  const current = currentBaseURL(), want = baseURLFor(s.mode)
  console.log(`\nANTHROPIC_BASE_URL: ${current}${current === want ? '' : `  (expected ${want} -- run: claude-mode ${s.mode})`}`)
  console.log(`proxy: ${isRunning() ? c.green('running') : c.red('stopped')}`)
  console.log(c.dim(`\nSee every free model + its live status:  claude-mode models`))
}

/** Resolve a user's query to one entry of the model list. */
function resolveModel(query, models) {
  const q = String(query ?? '').trim()
  if (/^\d+$/.test(q)) {
    const i = Number(q) - 1
    return models[i] ? { entry: models[i] } : { error: `no model #${q} -- the list has ${models.length} entries (claude-mode models)` }
  }
  const slot = q.toLowerCase()
  let hits = models.filter(m => m.slot.toLowerCase() === slot)
  if (!hits.length) hits = models.filter(m => m.slot.toLowerCase().endsWith('/' + slot))
  if (!hits.length) hits = models.filter(m => m.model.toLowerCase().includes(slot) || m.provider.toLowerCase().includes(slot))
  if (!hits.length) return { error: `no model matches "${q}". Run: claude-mode models` }
  if (hits.length > 1) {
    const lines = hits.slice(0, 8).map((m, i) => `    ${m.slot}`).join('\n')
    return { error: `"${q}" matches ${hits.length} models -- be more specific:\n${lines}` }
  }
  return { entry: hits[0] }
}

/** Test every configured model once; write probe.json. */
async function probeModels(apply) {
  const models = allModels()
  const c0 = cfg()
  console.log(c.dim(`\nTesting ${models.length} models...\n`))
  const results = {}
  const queue = [...models]
  async function one(m) {
    const p = c0.providers[m.provider]
    const key = keyFor(m.provider, p)
    if (p.needsKey && !key) { results[m.slot] = { status: 'no-key', note: 'needs an API key' }; return }
    const started = Date.now()
    try {
      const r = await fetch(p.baseURL.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
        body: JSON.stringify({ model: m.model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 24 }),
        signal: AbortSignal.timeout(45_000),
      })
      const text = await r.text()
      results[m.slot] = { provider: m.provider, model: m.model, status: String(r.status), ms: Date.now() - started }
      if (!r.ok) results[m.slot].note = text.slice(0, 110).replace(/\s+/g, ' ')
    } catch (e) {
      results[m.slot] = { provider: m.provider, model: m.model, status: e.name === 'AbortError' ? 'timeout' : e.name, ms: Date.now() - started }
    }
  }
  async function worker() { while (queue.length) await one(queue.shift()) }
  await Promise.all(Array.from({ length: 6 }, worker))

  writeJSON(PROBE, { at: Date.now(), results })
  printModels()

  if (apply) {
    // Re-order the chain so the best model that is *currently answering* comes
    // first: explicit `modelQuality` (0-100, how good it is at agentic coding
    // work) decides, with measured latency breaking ties. Ranking by speed alone
    // would promote small, weak models that reply first — the opposite of "best".
    const quality = c0.modelQuality ?? {}
    const best = new Map() // provider -> { slot, quality, ms }
    for (const [slot, r] of Object.entries(results)) {
      if (r.status !== '200') continue
      const q = quality[slot] ?? 50
      const prev = best.get(r.provider)
      const better = !prev || q > prev.quality || (q === prev.quality && (r.ms ?? 1e9) < prev.ms)
      if (better) best.set(r.provider, { slot, quality: q, ms: r.ms })
    }
    const ranked = [...best.entries()]
      .sort((x, y) => y[1].quality - x[1].quality || (x[1].ms ?? 1e9) - (y[1].ms ?? 1e9))
      .map(([p]) => p)
    const rest = (c0.freeChain ?? []).filter(p => !ranked.includes(p))
    const next = [...ranked, ...rest]
    if (next.join(',') === (c0.freeChain ?? []).join(',')) {
      console.log(c.dim('\nchain order already matches the measured ranking -- unchanged'))
    } else {
      writeJSON(CONFIG, { ...c0, freeChain: next })
      console.log(`\n${c.green('chain re-ordered best-first:')}`)
      for (const p of ranked) console.log(`  ${String(best.get(p).quality).padStart(3)}  ${String(best.get(p).ms + 'ms').padStart(8)}  ${best.get(p).slot}`)
      console.log(c.dim(`\n  chain: ${next.join(' -> ')}`))
    }
    console.log(c.dim('restart the proxy to pick up the new order: claude-mode stop && claude-mode start'))
  }
}

// ── Command handling ─────────────────────────────────────────────────────────
(async () => {
  if (!cmd || cmd === 'status') return printStatus()

  if (cmd === 'models') return printModels()

  if (cmd === 'probe') {
    const apply = a === '--apply' || a === 'apply'
    if (!isRunning()) console.log(c.yellow('(proxy is stopped -- the probe talks to providers directly, so this still works)'))
    return await probeModels(apply)
  }

  if (cmd === 'unpin') {
    if (!state().forceModel) return console.log('nothing is pinned')
    saveState({ forceModel: null })
    return console.log('pin cleared -- free requests follow the chain order again')
  }

  if (cmd === 'use') {
    if (!a) { console.error('usage: claude-mode use <number|provider/model|partial-name>'); process.exit(1) }
    const { entry, error } = resolveModel(a, allModels())
    if (error) { console.error(error); process.exit(1) }
    saveState({ forceModel: { provider: entry.provider, model: entry.model } })
    const url = baseURLFor('free')
    if (state().mode === 'pro' || state().mode === 'auto') saveState({ mode: 'free' })
    setBaseURL(url)
    console.log(`${c.green('now using')} ${c.bold(entry.slot)} for every request`)
    console.log(c.dim(`mode: ${state().mode} -- ANTHROPIC_BASE_URL=${url}`))
    console.log(c.dim('applies to new Claude Code sessions; restart a running one to switch'))
    return
  }

  if (cmd === 'cache') {
    const base = `http://127.0.0.1:${port()}`
    if (a === 'clear' || a === 'reset') {
      await fetch(`${base}/__switch/cache`, { method: 'DELETE' }).catch(() => null)
      return console.log('response cache cleared')
    }
    let st = null
    try { st = JSON.parse(await (await fetch(`${base}/__switch/status`, { signal: AbortSignal.timeout(4000) })).text()).cache } catch { /* proxy down */ }
    if (!st) return console.log(c.red('proxy is not running -- start it with: claude-mode start'))
    const total = (st.hits ?? 0) + (st.misses ?? 0)
    const rate = total ? Math.round(st.hits / total * 100) : 0
    console.log(c.bold('\nresponse cache'))
    console.log(`  enabled:   ${st.enabled ? c.green('yes') : c.red('no')}`)
    console.log(`  entries:   ${st.entries} / ${st.maxEntries}`)
    console.log(`  ttl:       ${Math.round((st.ttlMs ?? 0) / 60000)} min`)
    console.log(`  hits:      ${c.green(st.hits)}   misses: ${st.misses}   (${rate}% hit rate)`)
    console.log(`  ${c.green(`${st.saved} provider call(s) avoided`)} -- that is ${st.saved} slice(s) of your free daily quota saved`)
    console.log(c.dim('\nclear it:  claude-mode cache clear'))
    return
  }

  if (cmd === 'best') {
    saveState({ forceModel: null, mode: 'best' })
    const url = baseURLFor('best')
    if (!isRunning()) start()
    setBaseURL(url)
    console.log(`${c.green('mode set to best')}`)
    console.log(c.dim('the chain is quality-ranked (see "claude-mode models"); the proxy also'))
    console.log(c.dim('re-orders it live by measured latency and failure rate, so a provider'))
    console.log(c.dim('that is slow or erroring right now drops to the back automatically.'))
    console.log(c.dim('\nrefresh the ranking any time:  claude-mode probe --apply'))
    console.log(c.dim(`ANTHROPIC_BASE_URL=${url}`))
    return
  }

  if (cmd === 'key') {
    if (!a || !b) { console.error('usage: claude-mode key <provider> <apiKey>'); process.exit(1) }
    const c0 = cfg()
    if (!c0.providers?.[a]) { console.error(`unknown provider: ${a}. known: ${Object.keys(c0.providers ?? {}).join(', ')}`); process.exit(1) }
    c0.providers[a].key = b
    writeJSON(CONFIG, c0)
    console.log(`key stored for ${a}`)
    return
  }

  if (cmd === 'agent') {
    const c0 = cfg()
    c0.agentModels = c0.agentModels ?? {}
    if (!a) {
      if (!Object.keys(c0.agentModels).length) { console.log('no agent model assignments configured'); return }
      for (const [name, acfg] of Object.entries(c0.agentModels)) console.log(`  ${name}: ${acfg.provider}/${acfg.model}`)
      return
    }
    if (!b) {
      const existing = c0.agentModels[a]
      console.log(existing ? `${a}: ${existing.provider}/${existing.model}` : `${a}: not assigned (uses the chain)`)
      return
    }
    const model = process.argv[5]
    if (!model) { console.error('usage: claude-mode agent <name> <provider> <model>'); process.exit(1) }
    if (!c0.providers?.[b]) { console.error(`unknown provider: ${b}. known: ${Object.keys(c0.providers ?? {}).join(', ')}`); process.exit(1) }
    c0.agentModels[a] = { provider: b, model }
    writeJSON(CONFIG, c0)
    console.log(`agent '${a}' assigned to ${b}/${model}`)
    return
  }

  if (cmd === 'pick') {
    if (!a || !b) { console.error('usage: claude-mode pick <provider> <model>   (or: claude-mode use <query>)'); process.exit(1) }
    const c0 = cfg()
    if (!c0.providers?.[a]) { console.error(`unknown provider: ${a}. known: ${Object.keys(c0.providers ?? {}).join(', ')}`); process.exit(1) }
    saveState({ forceModel: { provider: a, model: b } })
    console.log(`free requests pinned to ${a}/${b} (cleared on mode change or: claude-mode unpin)`)
    return
  }

  if (cmd === 'start') return start()
  if (cmd === 'stop') return stop()

  console.error(`unknown command: ${cmd}\n\n` + [
    'modes:    ' + MODES.join(' | '),
    'models:   models | probe [--apply] | use <n|query> | unpin',
    'keys:     key <provider> <apiKey>',
    'agents:   agent [name] [provider] [model]',
    'proxy:    start | stop',
    'status:   (no arguments)',
  ].join('\n'))
  process.exit(1)
})().catch(e => { console.error(c.red(e instanceof Error ? e.message : String(e))); process.exit(1) })
