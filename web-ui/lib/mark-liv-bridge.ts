/**
 * Client for the Mark-LIV bridge (mark-l-bridge/server.py, 127.0.0.1:8765) —
 * how JARVIS runs Mark-LIV's computer-control actions (apps, mouse/keyboard,
 * browser, files, system settings, messages…) on Windows, macOS and Linux.
 *
 * The bridge is started on demand, with the interpreter of the venv that
 * mark-l-bridge/start.sh builds; every call carries the shared bridge token
 * (MARKL_BRIDGE_TOKEN, else ~/.ghostforge/bridge/token).
 */
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getMarkLBridgeToken } from './bridge-token'

const BRIDGE_URL = (process.env.MARKL_BRIDGE_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '')
const REPO_ROOT = process.env.GHOSTFORGE_ROOT ?? path.resolve(process.cwd(), '..')
/** After a failed start, don't respawn for this long (each request would otherwise wait again). */
const START_RETRY_COOLDOWN_MS = 15_000

export interface MarkLivTool {
  name: string
  description: string
  parameters?: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] }
}

function token(): string {
  return getMarkLBridgeToken()
}

/**
 * Interpreter for the bridge: mark-l-bridge/.venv (where start.sh installs
 * fastapi, uvicorn, mem0, crewai…) when it exists, else PYTHON / python3.
 */
export function bridgePython(
  bridgeDir: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const venvPython = platform === 'win32'
    ? path.join(bridgeDir, '.venv', 'Scripts', 'python.exe')
    : path.join(bridgeDir, '.venv', 'bin', 'python')
  if (exists(venvPython)) return venvPython
  return env.PYTHON || (platform === 'win32' ? 'python' : 'python3')
}

/** Where the auto-started bridge writes its stdout/stderr. */
export function bridgeLogFile(): string {
  return path.join(os.homedir(), '.ghostforge', 'bridge', 'bridge.log')
}

let lastStartFailure: { at: number; reason: string } | null = null

/** Why the last auto-start failed (null when it did not fail). */
export function lastBridgeStartError(): string | null {
  return lastStartFailure?.reason ?? null
}

async function bridgeFetch(pathname: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  return fetch(`${BRIDGE_URL}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

async function isBridgeUp(): Promise<boolean> {
  try {
    // 401 still means "running" — the token file may just have been created
    const res = await bridgeFetch('/api/mark-l/health', {}, 1500)
    return res.status < 500
  } catch {
    return false
  }
}

let starting: Promise<boolean> | null = null

/** Make sure the bridge is running, starting it if needed. Resolves false if it can't start. */
export function ensureMarkLivBridge(): Promise<boolean> {
  if (starting) return starting
  starting = (async () => {
    if (await isBridgeUp()) { lastStartFailure = null; return true }
    if (lastStartFailure && Date.now() - lastStartFailure.at < START_RETRY_COOLDOWN_MS) return false
    const fail = (reason: string) => { lastStartFailure = { at: Date.now(), reason }; return false }
    const server = path.join(REPO_ROOT, 'mark-l-bridge', 'server.py')
    if (!fs.existsSync(server)) return fail('mark-l-bridge/server.py was not found')
    const bridgeDir = path.dirname(server)
    const python = bridgePython(bridgeDir)
    // Keep the child's output: a missing dependency is otherwise invisible.
    const logFile = bridgeLogFile()
    let logFd: number | 'ignore' = 'ignore'
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      logFd = fs.openSync(logFile, 'a', 0o600)
    } catch { /* run without a log rather than not at all */ }
    let exited: string | null = null
    try {
      const child = spawn(python, [server], {
        cwd: bridgeDir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
        env: { ...process.env, MARK_LIV_DIR: process.env.MARK_LIV_DIR || path.join(REPO_ROOT, 'vendor', 'mark-liv') },
      })
      child.on('error', err => { exited = `could not run ${python}: ${err.message}` })
      child.on('exit', (code, signal) => { exited = `exited early (${signal ?? `code ${code}`}), see ${logFile}` })
      child.unref()
    } finally {
      if (typeof logFd === 'number') fs.closeSync(logFd)
    }
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (await isBridgeUp()) { lastStartFailure = null; return true }
      if (exited) return fail(exited)
    }
    return fail(`did not answer on ${BRIDGE_URL} within 20 s, see ${logFile}`)
  })().finally(() => { starting = null })
  return starting
}

let toolCache: { ts: number; tools: MarkLivTool[] } | null = null

export async function markLivTools(): Promise<MarkLivTool[]> {
  if (toolCache && Date.now() - toolCache.ts < 5 * 60_000) return toolCache.tools
  if (!(await ensureMarkLivBridge())) return []
  const res = await bridgeFetch('/api/mark-liv/tools', {}, 20_000)
  if (!res.ok) return []
  const body = await res.json() as { data?: { tools?: MarkLivTool[] } }
  toolCache = { ts: Date.now(), tools: body.data?.tools ?? [] }
  return toolCache.tools
}

/** Run one Mark-LIV action and return its text result */
export async function runMarkLiv(name: string, parameters: Record<string, unknown>): Promise<string> {
  if (!(await ensureMarkLivBridge())) {
    const why = lastBridgeStartError()
    return `Mark-LIV bridge is not running and could not be started${why ? ` (${why})` : ''}. Run mark-l-bridge/start.sh once to create its venv, or install its dependencies: pip install -r mark-l-bridge/requirements.txt -r vendor/mark-liv/requirements.txt`
  }
  const res = await bridgeFetch('/api/mark-liv/run', { method: 'POST', body: JSON.stringify({ name, parameters }) }, 180_000)
  if (res.status === 404) return `Mark-LIV has no tool called "${name}".`
  if (!res.ok) return `Mark-LIV ${name} failed (${res.status}).`
  const body = await res.json() as { data?: { result?: string } }
  return body.data?.result ?? 'Done'
}

/** Compact catalog for the system prompt: name(params) — description */
export async function markLivCatalog(): Promise<string> {
  const tools = await markLivTools()
  return tools.map(t => {
    const props = Object.keys(t.parameters?.properties ?? {})
    return `- ${t.name}(${props.join(', ')}): ${t.description.split('. ')[0].slice(0, 140)}`
  }).join('\n')
}
