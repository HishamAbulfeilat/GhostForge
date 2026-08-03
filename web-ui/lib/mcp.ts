/**
 * MCP client — spawns the bundled GhostForge MCP server (mcp-server/index.js)
 * over stdio and calls tools via JSON-RPC. Also introspects available tools.
 *
 * The server is spawned lazily and cached per process. Each call re-sends
 * `initialize` when needed so the server can be (re)started at any time.
 */

import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'

let mcpProcess: ChildProcess | null = null
let mcpReady = false
let nextId = 1
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let stderrTail = ''

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

function locateMcpServer(): string | null {
  let probe = process.cwd()
  for (let i = 0; i < 6; i++) {
    const candidate = join(probe, 'mcp-server', 'index.js')
    if (existsSync(candidate)) return candidate
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  return null
}

function ensureServer(): boolean {
  if (mcpProcess && mcpReady) return true
  const serverPath = locateMcpServer()
  if (!serverPath) return false

  mcpProcess = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  mcpProcess.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      let msg: { id?: number; result?: unknown; error?: { message?: string } }
      try { msg = JSON.parse(line) } catch { continue }
      const p = pending.get(msg.id!)
      if (!p) continue
      pending.delete(msg.id!)
      if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'))
      else p.resolve(msg.result)
    }
  })

  mcpProcess.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000)
  })

  mcpProcess.on('exit', () => {
    mcpReady = false
    mcpProcess = null
    for (const [, p] of pending) p.reject(new Error('MCP server exited'))
    pending.clear()
  })

  mcpReady = true
  return true
}

async function request<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
  if (!ensureServer()) throw new Error('MCP server not found (mcp-server/index.js)')
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`MCP request timed out: ${method}`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v as T) },
      reject: (e) => { clearTimeout(timer); reject(e) },
    })
    mcpProcess?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

/** List the tools exposed by the bundled MCP server. */
export async function listMcpTools(): Promise<McpToolInfo[]> {
  const result = (await request<{ tools?: McpToolInfo[] }>('tools/list')) || {}
  return result.tools || []
}

/** Call a tool on the bundled MCP server. */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const result = await request<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }>('tools/call', { name, arguments: args })
  const text = (result.content || []).map(c => c.text || '').join('\n')
  if (result.isError) throw new Error(text || `MCP tool failed: ${name}`)
  return text
}

export function closeMcp(): void {
  mcpProcess?.kill()
  mcpProcess = null
  mcpReady = false
}

export function mcpStderrTail(): string {
  return stderrTail
}
