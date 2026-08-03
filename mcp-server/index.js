#!/usr/bin/env node
// GhostForge MCP server — exposes JARVIS-style tools over the Model Context
// Protocol (stdio transport, streamable JSON-RPC). Zero dependencies.
//
// This doubles as:
//   * a way for external MCP clients (Claude Desktop, Cursor, VS Code Copilot,
//     any MCP host) to attach JARVIS's local tooling, and
//   * the backend for JARVIS's `mcp_call` tool (lib/mcp.ts spawns this server).
//
// Supported protocol: initialize, tools/list, tools/call, ping, and the
// notifications/initialized message. Other messages are ignored.

import { createInterface } from 'node:readline'
import { spawnSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

// ── Helpers reused by the tools ─────────────────────────────────────────────

async function webSearch(query) {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
      { signal: AbortSignal.timeout(7000) },
    )
    const d = await res.json()
    return d.Answer || d.AbstractText || d.RelatedTopics?.[0]?.Text || `No results for "${query}"`
  } catch {
    return `Web search failed for "${query}"`
  }
}

async function open(url) {
  if (!/^https?:\/\//i.test(url)) return 'Only http/https URLs allowed'
  try {
    await execFileAsync('open', [url], { timeout: 5000 })
    return `Opened ${url}`
  } catch {
    return `Could not open ${url}`
  }
}

async function openApp(app) {
  try {
    await execFileAsync('open', ['-a', app], { timeout: 5000 })
    return `Opened ${app}`
  } catch {
    try {
      await execFileAsync('open', [app], { timeout: 5000 })
      return `Opened ${app}`
    } catch {
      return `Could not find app ${app}`
    }
  }
}

function spawnSyncBin(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout || 15000, ...opts })
  if (r.error) return { error: r.error.message }
  return { stdout: (r.stdout || '').trim(), stderr: r.stderr || '' }
}

function locateOfficeCli() {
  let probe = __dirname
  for (let i = 0; i < 6; i++) {
    const c = join(probe, 'office-cli', 'office.js')
    if (existsSync(c)) return c
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  return null
}

// ── Tool implementations (see MCP serialized schema below) ─────────────────

const TOOLS = {
  get_time: {
    description: 'Get the current date and time.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    async run(args) {
      return new Date().toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    },
  },

  get_weather: {
    description: 'Get the current weather for a city.',
    schema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      additionalProperties: false,
    },
    async run({ city = 'Riyadh' }) {
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
          signal: AbortSignal.timeout(6000),
        })
        const d = await res.json()
        const c = d.current_condition[0]
        return `${city}: ${c.weatherDesc[0].value}, ${c.temp_C}°C, feels like ${c.FeelsLikeC}°C, humidity ${c.humidity}%, wind ${c.windspeedKmph} km/h`
      } catch {
        return `Weather unavailable for ${city}`
      }
    },
  },

  web_search: {
    description: 'Search the web and return a concise result.',
    schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    async run({ query }) {
      if (!query) return 'No query provided'
      return webSearch(query)
    },
  },

  open_url: {
    description: 'Open a URL in the default browser.',
    schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
    async run({ url }) { return open(url) },
  },

  open_app: {
    description: 'Launch a desktop application.',
    schema: {
      type: 'object',
      properties: { app: { type: 'string' } },
      required: ['app'],
      additionalProperties: false,
    },
    async run({ app }) { return openApp(app) },
  },

  get_system_info: {
    description: 'Report CPU, battery and active RAM.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const [cpu, bat] = await Promise.allSettled([
        execFileAsync('bash', ["top -l 1 -s 0 | awk '/CPU usage/{print $3+$5}' | head -1"]).catch(() => ({ stdout: 'N/A' })),
        execFileAsync('pmset', ['-g', 'batt']).catch(() => ({ stdout: 'N/A' })),
      ])
      const cpuVal = cpu.status === 'fulfilled' ? `${Math.round(parseFloat(cpu.value.stdout))}%` : 'N/A'
      const batMatch = (bat.status === 'fulfilled' ? bat.value.stdout : '').match(/\d+%/)
      return `CPU: ${cpuVal} used, Battery: ${batMatch ? batMatch[0] : 'N/A'}`
    },
  },

  terminal_command: {
    description: 'Run a terminal command (safe subset; destructive commands blocked).',
    schema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    },
    async run({ command }) {
      const blocked = [/rm\s+-[rRf]{1,3}\s+\//, /sudo rm/, /mkfs\./, /dd\s+if=\/dev\/(sda|zero)/i, /csrutil\s+disable/]
      if (blocked.some(b => b.test(command))) return 'Command blocked for safety'
      try {
        const parts = command.split(/ /).filter(Boolean)
        const bin = parts.shift()
        if (!bin) return 'Empty command'
        const { stdout } = await execFileAsync(bin, parts, { timeout: 12000 }).catch(e => ({ stdout: `Error: ${(e.stderr || e.message).slice(0, 300)}` }))
        return stdout.slice(0, 1000) || 'Command completed'
      } catch (e) {
        return `Error: ${e.message.slice(0, 300)}`
      }
    },
  },

  office_document: {
    description: 'Generate, list, or read an office document (memo, minutes, report, cover letter, contract).',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['generate', 'list', 'read'] },
        type: { type: 'string', enum: ['memo', 'minutes', 'report', 'cover', 'contract'] },
        title: { type: 'string' },
        file: { type: 'string' },
        text: { type: 'string' },
      },
      additionalProperties: true,
    },
    async run(args) {
      const cli = locateOfficeCli()
      if (!cli) return 'Office CLI not found at the repo root.'
      const action = args.action || 'generate'
      if (action === 'list') return spawnSyncBin('node', [cli, 'list']).stdout || 'No documents yet.'
      if (action === 'read') return spawnSyncBin('node', [cli, 'read', `${args.file}.md`]).stdout || 'Document not found.'
      const type = ['memo', 'minutes', 'report', 'cover', 'contract'].includes(args.type) ? args.type : 'memo'
      const title = args.title || `${type} document`
      let rest = []
      for (const [k, v] of Object.entries(args)) {
        if (!['action', 'type', 'title', 'file', '_meta'].includes(k) && typeof v === 'string') rest.push(`--${k}=${v}`)
      }
      const r = spawnSyncBin('node', [cli, 'generate', type, title, ...rest])
      if (r.error) return `Office error: ${r.error}`
      if (!r.stdout) return 'Could not generate document.'
      try {
        const j = JSON.parse(r.stdout)
        return `Created ${j.type}: ${j.name} (${j.file})`
      } catch {
        return r.stdout
      }
    },
  },

  memory_status: {
    description: 'Report the semantic memory store size for the running user.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      try {
        const res = await fetch('http://localhost:3001/api/jarvis/memory/semantic').catch(() => null)
        if (res?.ok) return JSON.stringify(await res.json())
        return 'Semantic memory endpoint unreachable (needs auth). Remember/recall via the JARVIS UI.'
      } catch {
        return 'Semantic memory unavailable'
      }
    },
  },
}

// ── MCP protocol handler ────────────────────────────────────────────────────

const MT_PREFIX = '/mcp/'
async function handleRequest(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ghostforge-mcp', version: '1.0.0' },
      }

    case 'ping':
      return {}

    case 'tools/list':
      return {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.schema,
        })),
      }

    case 'tools/call': {
      const { name, arguments: args = {} } = params || {}
      const tool = TOOLS[name]
      if (!tool) {
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
      }
      try {
        let result = await tool.run(args || {})
        if (result && typeof result === 'object') result = JSON.stringify(result)
        return { content: [{ type: 'text', text: String(result ?? '') }], isError: false }
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }
      }
    }

    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
  }
}

function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on('line', async (raw) => {
    if (!raw.trim()) return
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    // notifications have no id — respond only when a response is expected
    if (msg.id === undefined || msg.id === null) {
      if (msg.method === 'notifications/initialized') return
      return
    }
    try {
      const result = await handleRequest(msg.method, msg.params)
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
    } catch (e) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: e.code || -32000, message: e.message },
      }) + '\n')
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}