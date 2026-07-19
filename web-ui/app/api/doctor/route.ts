import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import fs from 'fs'
import path from 'path'
import os from 'os'

const ROOT = path.join(os.homedir(), 'GhostForge')
const WEBUI = path.join(ROOT, 'web-ui')
const BRIDGE_DIR = path.join(os.homedir(), '.ghostforge/bridge')
const ROUTES_CONFIG = path.join(WEBUI, 'routes.config.json')

function fileExists(p: string) {
  try { fs.accessSync(p); return true } catch { return false }
}

function envVal(key: string): string {
  try {
    const content = fs.readFileSync(path.join(WEBUI, '.env.local'), 'utf8')
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
    return match?.[1]?.trim() ?? ''
  } catch { return '' }
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

export async function GET() {
  const cookieStore = await cookies()
  const auth = cookieStore.get('gf_token')
  if (!auth?.value || auth.value !== process.env.AUTH_SECRET) {
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

  // ── .env.local ──
  const envPath = path.join(WEBUI, '.env.local')
  if (fileExists(envPath)) {
    add('Config', '.env.local', 'pass', 'exists')
    for (const key of ['ACCESS_PIN', 'AUTH_SECRET']) {
      const v = envVal(key)
      if (v) add('Config', `env:${key}`, 'pass', `set (${v.length} chars)`)
      else add('Config', `env:${key}`, 'fail', 'not set', `Add ${key} to .env.local`)
    }
    for (const key of ['GOOGLE_GENERATIVE_AI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_MODEL']) {
      const v = envVal(key)
      if (v) add('Config', `env:${key}`, 'pass', 'set')
      else add('Config', `env:${key}`, 'warn', 'not set', `Add ${key} to .env.local`)
    }
  } else {
    add('Config', '.env.local', 'fail', 'missing', `Create ${envPath}`)
  }

  // ── Web UI pages ──
  if (fileExists(ROUTES_CONFIG)) {
    const config = JSON.parse(fs.readFileSync(ROUTES_CONFIG, 'utf8')) as { routes: { page: string; path: string; hidden?: boolean }[] }
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
    add('Bridge', 'token file', 'warn', 'no token', 'Run: bash ~/GhostForge/scripts/bridge.sh start')
  }

  const bridgeOk = await checkUrl('http://localhost:4747/health')
  add('Bridge', 'bridge:4747', bridgeOk ? 'pass' : 'fail', bridgeOk ? 'online' : 'offline',
    bridgeOk ? undefined : 'Run: bash ~/GhostForge/scripts/bridge.sh start')

  const ttydOk = await checkUrl('http://localhost:4748')
  add('Bridge', 'ttyd:4748', ttydOk ? 'pass' : 'warn', ttydOk ? 'online' : 'offline',
    ttydOk ? undefined : 'Start bridge to also launch ttyd')

  // ── AI Models ──
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const geminiModel = process.env.GEMINI_MODEL ?? 'gemini-2.5-pro'
  if (geminiKey) {
    const { ok, status } = await testGemini(geminiKey, geminiModel)
    if (ok) add('AI', `Gemini (${geminiModel})`, 'pass', 'API responding 200')
    else if (status === 429) add('AI', `Gemini (${geminiModel})`, 'warn', 'quota exceeded (429)', 'Check quota at aistudio.google.com')
    else add('AI', `Gemini (${geminiModel})`, 'fail', `HTTP ${status}`, 'Check GOOGLE_GENERATIVE_AI_API_KEY')
  } else {
    add('AI', 'Gemini', 'warn', 'no API key', 'Add GOOGLE_GENERATIVE_AI_API_KEY to .env.local')
  }

  const orKey = process.env.OPENROUTER_API_KEY
  if (orKey) {
    const ok = await checkUrl('https://openrouter.ai/api/v1/models')
    add('AI', 'OpenRouter', ok ? 'pass' : 'fail', ok ? 'reachable' : 'unreachable',
      ok ? undefined : 'Check OPENROUTER_API_KEY')
  } else {
    add('AI', 'OpenRouter', 'warn', 'no key (fallback unavailable)', 'Add OPENROUTER_API_KEY to .env.local')
  }

  const pass = checks.filter(c => c.status === 'pass').length
  const warn = checks.filter(c => c.status === 'warn').length
  const fail = checks.filter(c => c.status === 'fail').length

  return NextResponse.json({
    pass, warn, fail,
    total: checks.length,
    healthy: fail === 0,
    checks,
    ts: new Date().toISOString(),
  })
}
