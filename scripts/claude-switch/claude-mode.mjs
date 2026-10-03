#!/usr/bin/env node
// claude-mode: manual/status control for the claude-switch proxy.
// Usage:
//   claude-mode                 show current mode + provider cooldowns
//   claude-mode auto            Pro first, auto-fallback to free chain on 429 (default)
//   claude-mode pro             force Anthropic only, never fall back
//   claude-mode free            force the free provider chain (skip Pro entirely)
//   claude-mode openrouter      force OpenRouter's free models only
//   claude-mode omniroute       force the local OmniRoute gateway only
//   claude-mode key <provider> <apiKey>   store a provider API key in config.json
//   claude-mode start | stop    manage the background proxy process
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const CONFIG = path.join(DIR, 'config.json')
const STATE = path.join(DIR, 'state.json')
const PIDFILE = path.join(DIR, 'proxy.pid')
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const cfg = () => readJSON(CONFIG, {})
const state = () => ({ mode: 'auto', proCooldownUntil: 0, ...readJSON(STATE, {}) })
const saveState = patch => fs.writeFileSync(STATE, JSON.stringify({ ...state(), ...patch }, null, 2))

const MODES = ['auto', 'pro', 'free', 'openrouter', 'omniroute']
const [cmd, a, b] = process.argv.slice(2)
const port = () => process.env.CLAUDE_SWITCH_PORT || cfg().port || 3457

function printStatus() {
  const s = state()
  const until = s.proCooldownUntil > Date.now() ? new Date(s.proCooldownUntil).toLocaleString() : null
  console.log(`mode: ${s.mode}`)
  if (until) console.log(`Pro resting until: ${until} (auto mode serves free providers until then)`)
  const c = cfg()
  console.log('providers:')
  for (const name of c.freeChain ?? []) {
    const p = c.providers?.[name] ?? {}
    const hasKey = !p.needsKey || !!(p.key || (p.keyEnv && process.env[p.keyEnv]))
    const models = (p.models ?? [p.model]).join(', ')
    console.log(`  - ${name}: ${hasKey ? (p.needsKey ? 'ready' : 'ready (no key needed)') : 'NO KEY (set with: claude-mode key ' + name + ' <apiKey>)'}  [${models}]`)
  }
  console.log(`\nPoint Claude Code here: ANTHROPIC_BASE_URL=http://127.0.0.1:${port()}`)
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

if (!cmd || cmd === 'status') {
  printStatus()
} else if (MODES.includes(cmd)) {
  saveState({ mode: cmd, ...(cmd !== 'auto' && { proCooldownUntil: 0 }) })
  console.log(`mode set to ${cmd}`)
} else if (cmd === 'key') {
  if (!a || !b) { console.error('usage: claude-mode key <provider> <apiKey>'); process.exit(1) }
  const c = cfg()
  if (!c.providers?.[a]) { console.error(`unknown provider: ${a}. known: ${Object.keys(c.providers ?? {}).join(', ')}`); process.exit(1) }
  c.providers[a].key = b
  fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2))
  console.log(`key stored for ${a}`)
} else if (cmd === 'start') {
  start()
} else if (cmd === 'stop') {
  stop()
} else {
  console.error(`unknown command: ${cmd}\nknown commands: status, ${MODES.join(', ')}, key, start, stop`)
  process.exit(1)
}
