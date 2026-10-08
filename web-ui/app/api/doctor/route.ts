import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { isAuthorizedRequest } from '@/lib/auth'

function findRoot(): string {
  const candidates = [
    path.join(os.homedir(), 'Desktop', 'GhostForge', 'GhostForge-public'),
    path.join(os.homedir(), 'GhostForge'),
    path.join(os.homedir(), 'Desktop', 'GhostForge'),
  ]
  for (const dir of candidates) {
    try { if (fs.existsSync(path.join(dir, 'web-ui'))) return dir } catch { /* next */ }
  }
  return candidates[candidates.length - 1]
}

const ROOT = findRoot()
const WEBUI = path.join(ROOT, 'web-ui')
const BRIDGE_DIR = path.join(os.homedir(), '.ghostforge/bridge')
const ROUTES_CONFIG = path.join(WEBUI, 'routes.config.json')

type RoutesConfig = { routes: { page: string; path: string; hidden?: boolean }[] }
let _routesConfig: RoutesConfig | null = null
function getRoutesConfig(): RoutesConfig {
  if (!_routesConfig) {
    try {
      _routesConfig = JSON.parse(fs.readFileSync(ROUTES_CONFIG, 'utf8')) as RoutesConfig
    } catch { _routesConfig = { routes: [] } }
  }
  return _routesConfig
}

function fileExists(p: string) {
  try { fs.accessSync(p); return true } catch { return false }
}

function isPlaceholder(v: string): boolean {
  return /^(your-|\.\.\.$|sk-or-\.\.\.|AIza\.\.\.|x{2,})/.test(v.trim()) || v.includes('...')
}

function envVal(key: string): string {
  for (const name of ['.env.local', '.env']) {
    try {
      const content = fs.readFileSync(path.join(WEBUI, name), 'utf8')
      const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
      const v = match?.[1]?.trim() ?? ''
      if (v && !isPlaceholder(v)) return v
    } catch { /* try next file */ }
  }
  return ''
}

async function checkUrl(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const id = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(id)
    return res.status < 500
  } catch { return false }
}

async function testGemini(key: string, model: string): Promise<{ ok: boolean; status: number }> {
  try {
    const ctrl = new AbortController()
    const id = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 5 } }),
      }
    )
    clearTimeout(id)
    return { ok: res.status === 200, status: res.status }
  } catch { return { ok: false, status: 0 } }
}

export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const checks: { category: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string; fix?: string }[] = []

  const add = (
    category: string, label: string,
    status: 'pass' | 'warn' | 'fail',
    detail: string, fix?: string
  ) => checks.push({ category, label, status, detail, fix })

  // ── Folders ──
  for (const dir of ['web-ui', 'scripts', 'tui', 'marketplace']) {
    if (fileExists(path.join(ROOT, dir))) add('Folders', dir, 'pass', 'exists')
    else add('Folders', dir, 'fail', 'missing', `Missing ${ROOT}/${dir}`)
  }

  if (fileExists(ROUTES_CONFIG)) add('Folders', 'routes.config.json', 'pass', 'found')
  else add('Folders', 'routes.config.json', 'warn', 'missing', 'Run: ghostforge doctor')

  // ── .env / .env.local ──
  const envLocalPath = path.join(WEBUI, '.env.local')
  const envPath = path.join(WEBUI, '.env')
  const hasEnv = fileExists(envLocalPath) || fileExists(envPath)
  if (hasEnv) {
    add('Config', '.env(.local)', 'pass', fileExists(envLocalPath) ? '.env.local exists' : '.env exists')
    for (const key of ['ACCESS_PIN', 'AUTH_SECRET']) {
      const v = envVal(key)
      if (v) add('Config', `env:${key}`, 'pass', `set (${v.length} chars)`)
      else add('Config', `env:${key}`, 'fail', 'not set', `Add ${key} to web-ui/.env.local`)
    }
    for (const key of ['GOOGLE_GENERATIVE_AI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_MODEL']) {
      const v = envVal(key)
      if (v) add('Config', `env:${key}`, 'pass', 'set')
      else add('Config', `env:${key}`, 'warn', 'not set (optional — free Pollinations chain is used)', `Add ${key} to web-ui/.env.local for a more reliable free tier`)
    }
  } else {
    add('Config', '.env', 'fail', 'missing', `Create ${envPath}`)
  }

  // ── Web UI pages ──
  if (fileExists(ROUTES_CONFIG)) {
    const config = getRoutesConfig()
    for (const route of config.routes.filter(r => !r.hidden)) {
      const p = path.join(WEBUI, 'app', route.page)
      if (fileExists(p)) add('Pages', `page:${route.path}`, 'pass', route.page)
      else add('Pages', `page:${route.path}`, 'warn', 'missing', `Create ${p}`)
    }
  }

  // ── node_modules ──
  if (fileExists(path.join(WEBUI, 'node_modules')))
    add('Web UI', 'node_modules', 'pass', 'installed')
  else
    add('Web UI', 'node_modules', 'fail', 'not installed', `cd ${WEBUI} && npm install`)

  // ── Bridge ──
  const tokenFile = path.join(BRIDGE_DIR, 'token')
  if (fileExists(tokenFile)) {
    const age = Math.round((Date.now() - fs.statSync(tokenFile).mtimeMs) / 60000)
    add('Bridge', 'token file', 'pass', `exists (~${age}m old)`)
  } else {
    add('Bridge', 'token file', 'warn', 'no token', `Run: node ${path.join(ROOT, 'scripts', 'bridge-server.js')}`)
  }

  const bridgeOk = await checkUrl('http://localhost:4747/health')
  add('Bridge', 'bridge:4747', bridgeOk ? 'pass' : 'warn', bridgeOk ? 'online' : 'offline (optional — for remote access)',
    bridgeOk ? undefined : `Run: node ${path.join(ROOT, 'scripts', 'bridge-server.js')}`)

  const ttydOk = await checkUrl('http://localhost:4748')
  add('Bridge', 'ttyd:4748', ttydOk ? 'pass' : 'warn', ttydOk ? 'online' : 'offline (optional — web terminal)',
    ttydOk ? undefined : 'Start bridge to also launch ttyd')

  // ── AI Models ──
  const geminiKey = envVal('GOOGLE_GENERATIVE_AI_API_KEY') || (process.env.GOOGLE_GENERATIVE_AI_API_KEY && !isPlaceholder(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ? process.env.GOOGLE_GENERATIVE_AI_API_KEY : '')
  const geminiModel = envVal('GEMINI_MODEL') || process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  if (geminiKey) {
    const { ok, status } = await testGemini(geminiKey, geminiModel)
    if (ok) add('AI', `Gemini (${geminiModel})`, 'pass', 'API responding 200')
    else if (status === 429) add('AI', `Gemini (${geminiModel})`, 'pass', 'configured (quota limited today — using fallback models)')
    else add('AI', `Gemini (${geminiModel})`, 'warn', `HTTP ${status}`, 'Check GOOGLE_GENERATIVE_AI_API_KEY')
  } else {
    add('AI', 'Gemini', 'warn', 'no API key (optional — OpenRouter/Ollama will be used)', 'Add GOOGLE_GENERATIVE_AI_API_KEY to .env.local')
  }

  const orKey = envVal('OPENROUTER_API_KEY') || (process.env.OPENROUTER_API_KEY && !isPlaceholder(process.env.OPENROUTER_API_KEY) ? process.env.OPENROUTER_API_KEY : '')
  if (orKey) {
    const ok = await checkUrl('https://openrouter.ai/api/v1/models')
    add('AI', 'OpenRouter', ok ? 'pass' : 'fail', ok ? 'reachable' : 'unreachable',
      ok ? undefined : 'Check OPENROUTER_API_KEY')
  } else {
    add('AI', 'OpenRouter', 'warn', 'no key (fallback unavailable)', 'Add OPENROUTER_API_KEY to .env.local')
  }

  // ── Ollama (local AI) ──
  const ollamaOk = await checkUrl('http://localhost:11434/api/tags', 2000)
  if (ollamaOk) {
    try {
      const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) })
      const d = await r.json() as { models: Array<{ name: string }> }
      const models = d.models?.map(m => m.name) || []
      add('AI', 'Ollama', 'pass', `running — models: ${models.join(', ') || 'none'}`)
    } catch {
      add('AI', 'Ollama', 'pass', 'running')
    }
  } else {
    add('AI', 'Ollama', 'warn', 'not running', 'Install/start Ollama from ollama.com (optional — Pollinations free chain is used by default)')
  }

  // ── G.F.A.I. specific ──
  const fishKey     = envVal('FISH_AUDIO_API_KEY')
  const elevenKey   = envVal('ELEVENLABS_API_KEY')
  const xaiKey      = envVal('XAI_API_KEY')
  const githubToken = envVal('GITHUB_TOKEN')

  add('GFAI', 'Fish Audio TTS', fishKey ? 'pass' : 'warn', fishKey ? 'JARVIS voice ready' : 'not configured (optional)', 'Add FISH_AUDIO_API_KEY to .env.local')
  add('GFAI', 'ElevenLabs TTS', elevenKey ? 'pass' : 'warn', elevenKey ? 'configured' : 'not configured (optional)', 'Add ELEVENLABS_API_KEY to .env.local')
  add('GFAI', 'Grok (xAI)', xaiKey ? 'pass' : 'pass', xaiKey ? 'configured ⚡' : 'optional — add XAI_API_KEY to enable Grok models')
  add('GFAI', 'GitHub Token', githubToken ? 'pass' : 'pass', githubToken ? 'set' : 'optional — add GITHUB_TOKEN for GitHub features')

  // ── CLI tools ──
  const checkCmd = (cmd: string): boolean => {
    try {
      const locator = process.platform === 'win32' ? 'where' : 'which'
      execSync(`${locator} ${cmd}`, { timeout: 2000, stdio: 'ignore' })
      return true
    } catch { return false }
  }
  add('Tools', 'gh (GitHub CLI)', checkCmd('gh') ? 'pass' : 'warn', checkCmd('gh') ? 'installed' : 'not found', 'https://cli.github.com')
  add('Tools', 'cliclick (mouse ctrl)', checkCmd('cliclick') ? 'pass' : 'warn', checkCmd('cliclick') ? 'installed' : 'not found (macOS only — optional)', 'macOS only: brew install cliclick')
  add('Tools', 'git', checkCmd('git') ? 'pass' : 'fail', checkCmd('git') ? 'installed' : 'not found', 'Install Git from git-scm.com')
  add('Tools', 'node', checkCmd('node') ? 'pass' : 'fail', checkCmd('node') ? 'installed' : 'not found', 'Install Node.js from nodejs.org')

  // ── Audit log ──
  const auditFile = path.join(os.homedir(), '.ghostforge', 'audit.log')
  if (fileExists(auditFile)) {
    const size = fs.statSync(auditFile).size
    add('Security', 'Audit log', 'pass', `active (${Math.round(size/1024)}KB)`)
  } else {
    add('Security', 'Audit log', 'pass', 'ready — will auto-create on first G.F.A.I. usage')
  }

  const pass = checks.filter(c => c.status === 'pass').length
  const warn = checks.filter(c => c.status === 'warn').length
  const fail = checks.filter(c => c.status === 'fail').length
  // Score = pass / (pass + fail) — warns are informational, don't reduce score
  // This accurately reflects "how broken is the system" vs "how many optional features are set up"
  const scorable = pass + fail
  const healthScore = scorable === 0 ? 100 : Math.round((pass / scorable) * 100)

  return NextResponse.json({
    pass, warn, fail,
    total: checks.length,
    healthScore,                  // always reflects critical failures only
    healthy: fail === 0,
    checks,
    ts: new Date().toISOString(),
  })
}
