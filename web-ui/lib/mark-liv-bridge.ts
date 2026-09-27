/**
 * Client for the Mark-LIV bridge (mark-l-bridge/server.py, 127.0.0.1:8765) —
 * how JARVIS runs Mark-LIV's computer-control actions (apps, mouse/keyboard,
 * browser, files, system settings, messages…) on Windows, macOS and Linux.
 *
 * The bridge is started on demand; every call carries the shared bridge token
 * from ~/.ghostforge/bridge/token (or MARKL_BRIDGE_TOKEN).
 */
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const BRIDGE_URL = (process.env.MARKL_BRIDGE_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '')
const TOKEN_FILE = path.join(os.homedir(), '.ghostforge', 'bridge', 'token')
const REPO_ROOT = process.env.GHOSTFORGE_ROOT ?? path.resolve(process.cwd(), '..')

export interface MarkLivTool {
  name: string
  description: string
  parameters?: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] }
}

function token(): string {
  if (process.env.MARKL_BRIDGE_TOKEN) return process.env.MARKL_BRIDGE_TOKEN.trim()
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim() } catch { return '' }
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
    if (await isBridgeUp()) return true
    const server = path.join(REPO_ROOT, 'mark-l-bridge', 'server.py')
    if (!fs.existsSync(server)) return false
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    const child = spawn(python, [server], {
      cwd: path.dirname(server),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, MARK_LIV_DIR: process.env.MARK_LIV_DIR || path.join(REPO_ROOT, 'vendor', 'mark-liv') },
    })
    child.on('error', () => { /* reported below as "not running" */ })
    child.unref()
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (await isBridgeUp()) return true
    }
    return false
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
    return 'Mark-LIV bridge is not running and could not be started. Install its dependencies: pip install -r mark-l-bridge/requirements.txt -r vendor/mark-liv/requirements.txt'
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
