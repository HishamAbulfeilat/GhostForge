// Chat box backend, shared by the external Agent World server and GhostForge's
// /api/agents/cli-sessions/chat route. Sends one message to an existing Claude
// Code or Copilot CLI session by resuming it headless in its own folder:
//
//   claude -p --resume <session id> --output-format json   (message on stdin)
//   copilot --resume <session id> --silent --no-color      (message on stdin)
//
// The message goes over stdin (never through a shell or as an argument that
// could be read as a flag). Only sessions in the current snapshot can be
// messaged. Transcripts and session stores are not read or written here: the
// reply comes from the CLI's own stdout.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const CHAT_MAX_CHARS = 4000
export const CHAT_MAX_BODY_BYTES = 16 * 1024
const REPLY_MAX_CHARS = 20_000
const STDOUT_MAX_BYTES = 4 * 1024 * 1024
const STDERR_MAX_BYTES = 64 * 1024
const MAX_CONCURRENT = 3
// A session id, optionally with the collector's ":<n>" suffix for duplicate transcripts.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::\d{1,3})?$/i
const REAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const busy = new Set()

function isFile(p) {
  try { return fs.statSync(p).isFile() } catch { return false }
}

/**
 * A CLI binary on PATH, without a shell. `override` (an env value) wins: a
 * binary, or a .js file run with this Node. On Windows an npm install is a
 * .cmd shim, which Node will not spawn without a shell, so the package's
 * script is run with Node instead.
 * @returns {{ command: string, args: string[] } | null}
 */
function resolveBin(name, override, windowsScripts, env, platform) {
  const bin = override?.trim()
  if (bin) return bin.endsWith('.js') ? { command: process.execPath, args: [bin] } : { command: bin, args: [] }
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  if (platform === 'win32') {
    for (const dir of dirs) if (isFile(path.join(dir, `${name}.exe`))) return { command: path.join(dir, `${name}.exe`), args: [] }
    for (const dir of dirs) {
      if (!isFile(path.join(dir, `${name}.cmd`))) continue
      for (const script of windowsScripts) {
        const js = path.join(dir, 'node_modules', ...script)
        if (isFile(js)) return { command: process.execPath, args: [js] }
      }
    }
    return null
  }
  for (const dir of dirs) if (isFile(path.join(dir, name))) return { command: path.join(dir, name), args: [] }
  return null
}

/** How to start Claude Code without a shell (CLAUDE_BIN overrides). */
export function resolveClaude(env = process.env, platform = process.platform) {
  return resolveBin('claude', env.CLAUDE_BIN, [['@anthropic-ai', 'claude-code', 'cli.js']], env, platform)
}

/** How to start GitHub Copilot CLI without a shell (COPILOT_BIN overrides). */
export function resolveCopilot(env = process.env, platform = process.platform) {
  return resolveBin('copilot', env.COPILOT_BIN, [['@github', 'copilot', 'npm-loader.js'], ['@github', 'copilot', 'index.js']], env, platform)
}

/** Per provider: the binary, its arguments and how to read its reply. */
const PROVIDERS = {
  'claude-code': {
    label: 'Claude Code',
    resolve: resolveClaude,
    missing: 'Claude Code (`claude`) was not found on PATH; set CLAUDE_BIN.',
    args: id => ['-p', '--resume', id, '--output-format', 'json'],
    parse: parseClaudeReply,
  },
  'copilot-cli': {
    label: 'Copilot CLI',
    resolve: resolveCopilot,
    missing: 'GitHub Copilot CLI (`copilot`) was not found on PATH; set COPILOT_BIN.',
    // Non-interactive with the prompt piped on stdin; --silent prints only the reply.
    args: id => ['--resume', id, '--silent', '--no-color'],
    parse: parseCopilotReply,
  },
}

/** Claude's `--output-format json` result (an object, or a list ending in one). */
function parseClaudeReply(text, code) {
  let parsed
  try { parsed = JSON.parse(text) } catch { /* not JSON */ }
  if (Array.isArray(parsed)) parsed = parsed.findLast?.(m => m?.type === 'result') ?? parsed.at(-1)
  if (!parsed || typeof parsed !== 'object') return null
  const reply = String(parsed.result ?? parsed.error ?? '').slice(0, REPLY_MAX_CHARS)
  return { reply, isError: parsed.is_error === true || code !== 0, costUSD: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : undefined }
}

/** Copilot's silent output is the reply as plain text (colour codes stripped). */
function parseCopilotReply(text, code) {
  // eslint-disable-next-line no-control-regex
  const reply = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim().slice(0, REPLY_MAX_CHARS)
  if (!reply) return null
  return { reply, isError: code !== 0 }
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
  if (!PROVIDERS[session.provider]) return { ok: false, status: 400, error: 'Only Claude Code and Copilot CLI sessions can be messaged.' }
  if (!REAL_ID.test(session.sessionId ?? session.id)) return { ok: false, status: 400, error: 'That session has no resumable id.' }
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
 * Sends `message` to the session and resolves with the CLI's reply.
 * @returns {Promise<{ reply: string, isError: boolean, costUSD?: number }>}
 */
export function sendChat(session, message, { timeoutMs = Number(process.env.AW_CHAT_TIMEOUT_MS) || 5 * 60_000, spawnImpl = spawn, env = process.env } = {}) {
  const provider = PROVIDERS[session.provider ?? 'claude-code']
  if (!provider) return Promise.reject(Object.assign(new Error('Only Claude Code and Copilot CLI sessions can be messaged.'), { status: 400 }))
  // The real session id (rows for duplicate transcripts carry a ":<n>" suffix).
  const resumeId = session.sessionId ?? session.id
  if (busy.has(resumeId)) return Promise.reject(Object.assign(new Error('A message to this session is still running.'), { status: 409 }))
  if (busy.size >= MAX_CONCURRENT) return Promise.reject(Object.assign(new Error('Too many chats are running; try again shortly.'), { status: 429 }))
  const bin = provider.resolve(env)
  if (!bin) return Promise.reject(Object.assign(new Error(provider.missing), { status: 503 }))

  busy.add(resumeId)
  return new Promise((resolve, reject) => {
    const child = spawnImpl(bin.command, [...bin.args, ...provider.args(resumeId)], {
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
      busy.delete(resumeId)
      fn(value)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(reject, Object.assign(new Error(`${provider.label} did not answer in time.`), { status: 504 }))
    }, timeoutMs)
    child.stdout.on('data', chunk => { if (out.length < STDOUT_MAX_BYTES) out = Buffer.concat([out, chunk]) })
    child.stderr.on('data', chunk => { if (err.length < STDERR_MAX_BYTES) err += chunk.toString('utf8') })
    child.on('error', e => finish(reject, Object.assign(new Error(`Could not start ${provider.label}: ${e.message}`), { status: 503 })))
    child.on('close', code => {
      const text = out.toString('utf8').trim()
      const parsed = provider.parse(text, code)
      if (parsed) return finish(resolve, parsed)
      const detail = (err.trim().split('\n').at(-1) || text.split('\n').at(-1) || `exit code ${code}`).slice(0, 300)
      finish(reject, Object.assign(new Error(`${provider.label} failed: ${detail}`), { status: 502 }))
    })
    child.stdin.on('error', () => { /* reported through close */ })
    child.stdin.end(message)
  })
}
