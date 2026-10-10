// "Health at a glance": one status contract for every GhostForge surface.
//
// The dashboard, the TUI doctor and the setup checklist used to probe each
// dependency their own way and disagreed. They now all read this module: the
// web UI through GET /api/health, the TUI by importing it directly (no session
// token needed, same answer).
//
// Every check reports one of four states and, unless it is ready, a fix-it step:
//   ready   — working
//   missing — not installed / not configured
//   offline — installed or configured, but not answering right now
//   error   — answered, but broken (bad credentials, expired cert, 5xx …)
//
// Plain ESM with injectable I/O so it runs under Next, the TUI and node:test.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'

/** @typedef {'ready' | 'missing' | 'offline' | 'error'} HealthStatus */
/**
 * @typedef {object} HealthCheck
 * @property {string} id
 * @property {string} label
 * @property {HealthStatus} status
 * @property {string} detail
 * @property {string} [fix]   One concrete step that moves the check to ready.
 * @property {boolean} optional  JARVIS still works when an optional check is not ready.
 */
/**
 * @typedef {object} HealthReport
 * @property {boolean} ok   True when every required check is ready.
 * @property {string} checkedAt
 * @property {Record<HealthStatus, number>} summary
 * @property {HealthCheck[]} checks
 */

export const HEALTH_STATUSES = /** @type {const} */ (['ready', 'missing', 'offline', 'error'])

const CERT_RENEW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Async PATH lookup (no `which`, which Windows lacks, and no shell).
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 * @returns {Promise<string | null>}
 */
export async function findOnPath(command, env = process.env, platform = process.platform) {
  if (!/^[A-Za-z0-9._-]+$/.test(command)) return null
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)
  const exts = platform === 'win32'
    ? ['', ...String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
    : ['']
  const mode = platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext)
      try {
        await fs.promises.access(candidate, mode)
        const stat = await fs.promises.stat(candidate)
        if (stat.isFile()) return candidate
      } catch { /* keep looking */ }
    }
  }
  return null
}

/**
 * @param {string} url
 * @param {{ headers?: Record<string, string>, timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ reachable: boolean, status?: number }>}
 */
async function probe(url, { headers = {}, timeoutMs = 1500, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    return { reachable: true, status: res.status }
  } catch {
    return { reachable: false }
  }
}

/**
 * @param {string} file
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<{ code: number | string | null, stdout: string, stderr: string }>}
 */
function runFile(file, args, timeoutMs) {
  return new Promise(resolve => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      const err = /** @type {(NodeJS.ErrnoException & { code?: number | string }) | null} */ (error)
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

/**
 * Default I/O, overridable for tests.
 * @param {Partial<HealthDeps>} [overrides]
 * @returns {HealthDeps}
 */
export function defaultHealthDeps(overrides = {}) {
  const env = overrides.env || process.env
  // Next runs with cwd = web-ui/; the TUI passes webUiDir explicitly.
  const webUiDir = overrides.webUiDir || process.cwd()
  return {
    env,
    webUiDir,
    homeDir: os.homedir(),
    fetchImpl: fetch,
    findOnPath: command => findOnPath(command, env),
    run: runFile,
    readFile: file => fs.promises.readFile(file),
    exists: file => fs.promises.access(file).then(() => true, () => false),
    now: () => Date.now(),
    ...overrides,
  }
}

/**
 * @typedef {object} HealthDeps
 * @property {NodeJS.ProcessEnv} env
 * @property {string} webUiDir
 * @property {string} homeDir
 * @property {typeof fetch} fetchImpl
 * @property {(command: string) => Promise<string | null>} findOnPath
 * @property {(file: string, args: string[], timeoutMs: number) => Promise<{ code: number | string | null, stdout: string, stderr: string }>} run
 * @property {(file: string) => Promise<Buffer>} readFile
 * @property {(file: string) => Promise<boolean>} exists
 * @property {() => number} now
 */

/** @param {HealthDeps} deps */
async function bridgeToken(deps) {
  const fromEnv = deps.env.MARKL_BRIDGE_TOKEN?.trim()
  if (fromEnv) return fromEnv
  try {
    return (await deps.readFile(path.join(deps.homeDir, '.ghostforge', 'bridge', 'token'))).toString('utf8').trim()
  } catch {
    return ''
  }
}

/**
 * @param {HealthDeps} deps
 * @param {string} token
 * @returns {Promise<HealthCheck>}
 */
async function checkBridge(deps, token) {
  const base = (deps.env.MARKL_BRIDGE_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '')
  const label = 'JARVIS bridge (Mark-LV)'
  const fix = 'Start it: mark-l-bridge/start.sh (creates ~/.ghostforge/bridge/token and serves on :8765)'
  if (!token) return { id: 'bridge', label, status: 'missing', detail: 'no bridge token yet', fix, optional: false }
  const res = await probe(`${base}/api/mark-l/health`, { headers: { Authorization: `Bearer ${token}` }, fetchImpl: deps.fetchImpl })
  if (!res.reachable) return { id: 'bridge', label, status: 'offline', detail: 'not answering', fix, optional: false }
  if (res.status === 401 || res.status === 403) {
    return { id: 'bridge', label, status: 'error', detail: `token rejected (HTTP ${res.status})`, fix: 'Restart the bridge so it re-reads ~/.ghostforge/bridge/token, or unset a stale MARKL_BRIDGE_TOKEN', optional: false }
  }
  if ((res.status ?? 500) >= 500) return { id: 'bridge', label, status: 'error', detail: `HTTP ${res.status}`, fix: 'Check the bridge console output, then restart mark-l-bridge/start.sh', optional: false }
  return { id: 'bridge', label, status: 'ready', detail: 'responding', optional: false }
}

/** @param {HealthDeps} deps @param {string} token @returns {Promise<HealthCheck>} */
async function checkVoice(deps, token) {
  const port = deps.env.VOICE_PORT || '8766'
  const base = (deps.env.GHOSTFORGE_VOICE_URL || `http://localhost:${port}`).replace(/\/+$/, '')
  const label = 'Voice pipeline (local STT/TTS)'
  const script = path.join(deps.webUiDir, '..', 'voice-pipeline', 'start.sh')
  const res = await probe(`${base}/api/voice/health`, { headers: token ? { 'X-Bridge-Token': token } : {}, fetchImpl: deps.fetchImpl })
  if (res.reachable && (res.status ?? 500) < 400) return { id: 'voice', label, status: 'ready', detail: 'responding', optional: true }
  if (res.reachable) {
    return { id: 'voice', label, status: 'error', detail: `HTTP ${res.status}`, fix: 'Restart voice-pipeline/start.sh; browser voice still works meanwhile', optional: true }
  }
  if (!(await deps.exists(script))) {
    return { id: 'voice', label, status: 'missing', detail: 'voice-pipeline/ is not in this checkout', fix: 'Pull the full repository; browser (Web Speech) voice works without it', optional: true }
  }
  return { id: 'voice', label, status: 'offline', detail: 'not answering', fix: 'Run voice-pipeline/start.sh (the web server also starts it on boot)', optional: true }
}

/** @param {HealthDeps} deps @returns {Promise<HealthCheck>} */
async function checkOmniRoute(deps) {
  const base = (deps.env.OMNIROUTE_URL || 'http://localhost:20128/v1').replace(/\/+$/, '')
  const label = 'OmniRoute gateway'
  const res = await probe(`${base}/models`, { fetchImpl: deps.fetchImpl })
  if (res.reachable && (res.status ?? 500) < 400) return { id: 'omniroute', label, status: 'ready', detail: 'responding', optional: true }
  if (res.reachable) return { id: 'omniroute', label, status: 'error', detail: `HTTP ${res.status}`, fix: 'Restart it: omniroute serve --daemon', optional: true }
  if (!(await deps.findOnPath('omniroute'))) {
    return { id: 'omniroute', label, status: 'missing', detail: 'omniroute is not installed', fix: 'Optional free-AI fallback: see https://omniroute.online, then run omniroute serve --daemon', optional: true }
  }
  return { id: 'omniroute', label, status: 'offline', detail: 'not answering', fix: 'Run: omniroute serve --daemon', optional: true }
}

/** @param {HealthDeps} deps @returns {Promise<HealthCheck>} */
async function checkOllama(deps) {
  const base = (deps.env.OLLAMA_HOST && /^https?:\/\//.test(deps.env.OLLAMA_HOST) ? deps.env.OLLAMA_HOST : 'http://localhost:11434').replace(/\/+$/, '')
  const label = 'Ollama (local models)'
  const res = await probe(`${base}/api/tags`, { fetchImpl: deps.fetchImpl })
  if (res.reachable && (res.status ?? 500) < 400) return { id: 'ollama', label, status: 'ready', detail: 'responding', optional: true }
  if (res.reachable) return { id: 'ollama', label, status: 'error', detail: `HTTP ${res.status}`, fix: 'Restart Ollama (ollama serve)', optional: true }
  if (!(await deps.findOnPath('ollama'))) {
    return { id: 'ollama', label, status: 'missing', detail: 'ollama is not installed', fix: 'Install from https://ollama.com (optional: cloud and free chains work without it)', optional: true }
  }
  return { id: 'ollama', label, status: 'offline', detail: 'not answering', fix: 'Run: ollama serve', optional: true }
}

/** @param {HealthDeps} deps @returns {Promise<HealthCheck>} */
async function checkGh(deps) {
  const label = 'GitHub CLI auth'
  const gh = await deps.findOnPath('gh')
  if (!gh) return { id: 'gh', label, status: 'missing', detail: 'gh is not installed', fix: 'Install from https://cli.github.com, then run gh auth login', optional: true }
  const result = await deps.run(gh, ['auth', 'status'], 5000)
  if (result.code === 0) return { id: 'gh', label, status: 'ready', detail: 'signed in', optional: true }
  if (deps.env.GITHUB_TOKEN || deps.env.GH_TOKEN) {
    return { id: 'gh', label, status: 'error', detail: 'GITHUB_TOKEN is set but gh could not verify it', fix: 'Check the token scopes and network, or run gh auth login', optional: true }
  }
  return { id: 'gh', label, status: 'missing', detail: 'gh is installed but not signed in', fix: 'Run: gh auth login (dashboard GitHub panels need it)', optional: true }
}

/** @param {HealthDeps} deps @returns {Promise<HealthCheck>} */
async function checkHttps(deps) {
  const label = 'HTTPS certificate (mkcert)'
  const certFile = path.join(deps.webUiDir, 'certs', 'cert.pem')
  let pem = null
  try { pem = await deps.readFile(certFile) } catch { /* no cert */ }
  if (pem) {
    try {
      const expires = new Date(new X509Certificate(pem).validTo).getTime()
      if (expires - deps.now() > CERT_RENEW_MS) {
        return { id: 'https', label, status: 'ready', detail: `valid until ${new Date(expires).toISOString().slice(0, 10)}`, optional: true }
      }
      return { id: 'https', label, status: 'error', detail: 'certificate expired or expiring within 7 days', fix: 'Restart the web UI (npm start); server.js regenerates it with mkcert', optional: true }
    } catch {
      return { id: 'https', label, status: 'error', detail: 'web-ui/certs/cert.pem is unreadable', fix: 'Delete web-ui/certs/ and restart the web UI to regenerate it', optional: true }
    }
  }
  if (!(await deps.findOnPath('mkcert'))) {
    return { id: 'https', label, status: 'missing', detail: 'mkcert is not installed; the web UI serves plain HTTP', fix: 'Install mkcert (brew install mkcert nss / choco install mkcert), then restart the web UI. Browsers only allow the mic on HTTPS or localhost.', optional: true }
  }
  return { id: 'https', label, status: 'missing', detail: 'no certificate generated yet', fix: 'Restart the web UI (npm start); server.js generates it with mkcert', optional: true }
}

/** @param {HealthDeps} deps @returns {HealthCheck} */
function checkPush(deps) {
  const label = 'Push notification keys'
  if (deps.env.VAPID_PUBLIC_KEY && deps.env.VAPID_PRIVATE_KEY) return { id: 'push', label, status: 'ready', detail: 'VAPID keys configured', optional: true }
  return { id: 'push', label, status: 'missing', detail: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set', fix: 'Run npx web-push generate-vapid-keys and add both keys to web-ui/.env.local', optional: true }
}

/**
 * Run every check in parallel.
 * @param {Partial<HealthDeps>} [overrides]
 * @returns {Promise<HealthReport>}
 */
export async function collectHealth(overrides = {}) {
  const deps = defaultHealthDeps(overrides)
  const token = await bridgeToken(deps)
  const settle = async (/** @type {string} */ id, /** @type {string} */ label, /** @type {() => Promise<HealthCheck> | HealthCheck} */ fn) => {
    try {
      return await fn()
    } catch (error) {
      return /** @type {HealthCheck} */ ({ id, label, status: 'error', detail: error instanceof Error ? error.message : String(error), fix: 'Re-run the check; report it if it keeps failing', optional: true })
    }
  }
  const checks = await Promise.all([
    settle('bridge', 'JARVIS bridge (Mark-LV)', () => checkBridge(deps, token)),
    settle('voice', 'Voice pipeline (local STT/TTS)', () => checkVoice(deps, token)),
    settle('omniroute', 'OmniRoute gateway', () => checkOmniRoute(deps)),
    settle('ollama', 'Ollama (local models)', () => checkOllama(deps)),
    settle('gh', 'GitHub CLI auth', () => checkGh(deps)),
    settle('https', 'HTTPS certificate (mkcert)', () => checkHttps(deps)),
    settle('push', 'Push notification keys', () => checkPush(deps)),
  ])
  /** @type {Record<HealthStatus, number>} */
  const summary = { ready: 0, missing: 0, offline: 0, error: 0 }
  for (const check of checks) summary[check.status]++
  return {
    ok: checks.every(check => check.optional || check.status === 'ready'),
    checkedAt: new Date(deps.now()).toISOString(),
    summary,
    checks,
  }
}

/**
 * Parse KEY=VALUE lines (for the TUI, which does not get Next's .env loading).
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}
