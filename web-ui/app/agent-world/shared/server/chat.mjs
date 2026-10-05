// Chat box backend, shared by the external Agent World server and GhostForge's
// /api/agents/cli-sessions/chat route. Sends one message to an existing Claude
// Code session by resuming it headless in its own folder:
//
//   claude -p --resume <session id> --output-format json   (message on stdin)
//
// The message goes over stdin (never through a shell or as an argument that
// could be read as a flag). Only sessions in the current snapshot can be
// messaged. Transcripts are not read or written here: the reply comes from
// claude's own stdout.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const CHAT_MAX_CHARS = 4000
export const CHAT_MAX_BODY_BYTES = 16 * 1024
const REPLY_MAX_CHARS = 20_000
const STDOUT_MAX_BYTES = 4 * 1024 * 1024
const STDERR_MAX_BYTES = 64 * 1024
const MAX_CONCURRENT = 3
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const busy = new Set()

function isFile(p) {
  try { return fs.statSync(p).isFile() } catch { return false }
}

/**
 * How to start Claude Code without a shell. CLAUDE_BIN overrides (a binary,
 * or a cli.js run with this Node). On Windows an npm install is a .cmd shim,
 * which Node will not spawn without a shell, so its cli.js is run directly.
 * @returns {{ command: string, args: string[] } | null}
 */
export function resolveClaude(env = process.env, platform = process.platform) {
  const override = env.CLAUDE_BIN?.trim()
  if (override) return override.endsWith('.js') ? { command: process.execPath, args: [override] } : { command: override, args: [] }
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  if (platform === 'win32') {
    for (const dir of dirs) if (isFile(path.join(dir, 'claude.exe'))) return { command: path.join(dir, 'claude.exe'), args: [] }
    for (const dir of dirs) {
      if (!isFile(path.join(dir, 'claude.cmd'))) continue
      const cli = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
      if (isFile(cli)) return { command: process.execPath, args: [cli] }
    }
    return null
  }
  for (const dir of dirs) if (isFile(path.join(dir, 'claude'))) return { command: path.join(dir, 'claude'), args: [] }
  return null
}

/**
 * Checks a chat request against the current snapshot's sessions.
 * @returns {{ ok: true, session: any, message: string } | { ok: false, status: number, error: string }}
 */
export function validateChat(body, sessions) {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!SESSION_ID.test(sessionId)) return { ok: false, status: 400, error: 'sessionId must be a session id.' }
  if (!message) return { ok: false, status: 400, error: 'message is empty.' }
  if (message.length > CHAT_MAX_CHARS) return { ok: false, status: 413, error: `message is longer than ${CHAT_MAX_CHARS} characters.` }
  const session = (sessions ?? []).find(s => s?.id === sessionId)
  if (!session) return { ok: false, status: 404, error: 'That session is not in the current snapshot.' }
  if (session.provider !== 'claude-code') return { ok: false, status: 400, error: 'Only Claude Code sessions can be messaged.' }
  let dir = false
  try { dir = !!session.cwd && fs.statSync(session.cwd).isDirectory() } catch { /* missing */ }
  if (!dir) return { ok: false, status: 409, error: "The session's folder no longer exists." }
  return { ok: true, session, message }
}

/** Reads a JSON request body with a size cap. */
export async function readJsonBody(stream, limit = CHAT_MAX_BODY_BYTES) {
  let size = 0
  const chunks = []
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { status: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw Object.assign(new Error('Request body must be JSON.'), { status: 400 })
  }
}

/**
 * Sends `message` to the session and resolves with Claude's reply.
 * @returns {Promise<{ reply: string, isError: boolean, costUSD?: number }>}
 */
export function sendChat(session, message, { timeoutMs = Number(process.env.AW_CHAT_TIMEOUT_MS) || 5 * 60_000, spawnImpl = spawn, env = process.env } = {}) {
  if (busy.has(session.id)) return Promise.reject(Object.assign(new Error('A message to this session is still running.'), { status: 409 }))
  if (busy.size >= MAX_CONCURRENT) return Promise.reject(Object.assign(new Error('Too many chats are running; try again shortly.'), { status: 429 }))
  const claude = resolveClaude(env)
  if (!claude) return Promise.reject(Object.assign(new Error('Claude Code (`claude`) was not found on PATH; set CLAUDE_BIN.'), { status: 503 }))

  busy.add(session.id)
  return new Promise((resolve, reject) => {
    const child = spawnImpl(claude.command, [...claude.args, '-p', '--resume', session.id, '--output-format', 'json'], {
      cwd: session.cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = Buffer.alloc(0)
    let err = ''
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      busy.delete(session.id)
      fn(value)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(reject, Object.assign(new Error('Claude did not answer in time.'), { status: 504 }))
    }, timeoutMs)
    child.stdout.on('data', chunk => { if (out.length < STDOUT_MAX_BYTES) out = Buffer.concat([out, chunk]) })
    child.stderr.on('data', chunk => { if (err.length < STDERR_MAX_BYTES) err += chunk.toString('utf8') })
    child.on('error', e => finish(reject, Object.assign(new Error(`Could not start Claude Code: ${e.message}`), { status: 503 })))
    child.on('close', code => {
      const text = out.toString('utf8').trim()
      let parsed
      try { parsed = JSON.parse(text) } catch { /* not JSON */ }
      if (Array.isArray(parsed)) parsed = parsed.findLast?.(m => m?.type === 'result') ?? parsed.at(-1)
      if (parsed && typeof parsed === 'object') {
        const reply = String(parsed.result ?? parsed.error ?? '').slice(0, REPLY_MAX_CHARS)
        return finish(resolve, { reply, isError: parsed.is_error === true || code !== 0, costUSD: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : undefined })
      }
      const detail = (err.trim().split('\n').at(-1) || text.split('\n').at(-1) || `exit code ${code}`).slice(0, 300)
      finish(reject, Object.assign(new Error(`Claude Code failed: ${detail}`), { status: 502 }))
    })
    child.stdin.on('error', () => { /* reported through close */ })
    child.stdin.end(message)
  })
}
