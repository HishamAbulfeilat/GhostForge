#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8765'
const TOKEN_ENV = 'MARKL_BRIDGE_TOKEN'
const SESSION_ID = /^[A-Za-z0-9]{8,64}$/
const MAX_CONTENT_LENGTH = 10_000

function usage() {
  return `GhostForge collaboration CLI

Usage:
  ghostforge collab create [--json]
  ghostforge collab get <session-id> [--json]
  ghostforge collab post <session-id> --content <message> [--role <user|assistant>] [--json]

Commands:
  create                         Create a collaboration session
  get <session-id>               Load a session and its recent messages
  post <session-id>              Send a message to a session

Message content is limited to ${MAX_CONTENT_LENGTH.toLocaleString()} characters.
The default role for post is user.

Environment:
  MARKL_BRIDGE_TOKEN          Bridge token (defaults to ~/.ghostforge/bridge/token)
  MARKL_BRIDGE_URL            Bridge base URL (default: ${DEFAULT_BRIDGE_URL})
  GF_ALLOW_REMOTE_BRIDGE=1    Explicitly allow a non-loopback bridge URL`
}

function validateSessionId(value) {
  if (typeof value !== 'string' || !SESSION_ID.test(value)) {
    throw new Error('Session ID must be 8-64 letters or numbers')
  }
  return value
}

function validateContent(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('--content requires non-empty text')
  }
  if (value.length > MAX_CONTENT_LENGTH) {
    throw new Error(`--content must be at most ${MAX_CONTENT_LENGTH} characters`)
  }
  return value
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { command: 'help', json: false }
  const [command = 'help', ...rest] = argv
  if (!['help', 'create', 'get', 'post'].includes(command)) {
    throw new Error(`Unknown command: ${command}`)
  }
  if (command === 'help') {
    if (rest.length) throw new Error(`Unknown argument: ${rest[0]}`)
    return { command: 'help', json: false }
  }

  const options = { command, json: false }
  let index = 0
  if (command === 'get' || command === 'post') {
    if (!rest[0] || rest[0].startsWith('--')) {
      throw new Error(`${command} requires a session ID`)
    }
    options.id = validateSessionId(rest[0])
    index = 1
  }

  const seen = new Set()
  while (index < rest.length) {
    const arg = rest[index]
    if (arg === '--json') {
      if (seen.has(arg)) throw new Error(`${arg} may only be provided once`)
      seen.add(arg)
      options.json = true
      index += 1
      continue
    }
    if (command !== 'post' || !['--content', '--role'].includes(arg)) {
      throw new Error(`Unknown option or argument: ${arg}`)
    }
    if (seen.has(arg)) throw new Error(`${arg} may only be provided once`)
    seen.add(arg)
    const value = rest[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    if (arg === '--content') options.content = validateContent(value)
    if (arg === '--role') {
      if (!['user', 'assistant'].includes(value)) {
        throw new Error('--role must be user or assistant')
      }
      options.role = value
    }
    index += 2
  }

  if (command === 'post' && options.content === undefined) {
    throw new Error('post requires --content')
  }
  if (command === 'post' && options.role === undefined) options.role = 'user'
  return options
}

function resolveBridgeConfig(env = process.env) {
  const rawUrl = env.MARKL_BRIDGE_URL?.trim() || DEFAULT_BRIDGE_URL
  let parsedUrl
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new Error('MARKL_BRIDGE_URL must be an absolute http(s) URL')
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password ||
      !['', '/'].includes(parsedUrl.pathname) || parsedUrl.search || parsedUrl.hash) {
    throw new Error('MARKL_BRIDGE_URL must contain only an http(s) scheme, host, and optional port')
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsedUrl.hostname)
  if (!loopback && env.GF_ALLOW_REMOTE_BRIDGE !== '1') {
    throw new Error('MARKL_BRIDGE_URL is not loopback; set GF_ALLOW_REMOTE_BRIDGE=1 to opt in')
  }
  if (!loopback && parsedUrl.port && parsedUrl.port !== (parsedUrl.protocol === 'https:' ? '443' : '80')) {
    throw new Error('Remote MARKL_BRIDGE_URL must use the default port')
  }

  let token = env[TOKEN_ENV]?.trim()
  if (!token) {
    const tokenPath = join(homedir(), '.ghostforge', 'bridge', 'token')
    try {
      token = readFileSync(tokenPath, 'utf8').trim()
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Bridge token not found. Set ${TOKEN_ENV} or create ${tokenPath}`)
      }
      throw new Error(`Could not read bridge token at ${tokenPath}: ${error.message}`)
    }
  }
  if (!token) throw new Error(`Bridge token is empty. Set ${TOKEN_ENV} or check the bridge token file`)
  if (/[\r\n]/.test(token)) throw new Error('Bridge token contains invalid characters')
  return { baseUrl: parsedUrl.origin, token }
}

function responseMessage(data, text, response) {
  const detail = data?.error ?? data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (detail !== undefined) return JSON.stringify(detail)
  return text.trim().slice(0, 300) || response.statusText || 'request failed'
}

async function request(options, env = process.env, fetchImpl = fetch) {
  const { baseUrl, token } = resolveBridgeConfig(env)
  const endpoint = options.command === 'get'
    ? `/api/jarvis/collab?id=${encodeURIComponent(options.id)}`
    : '/api/jarvis/collab'
  const init = {
    method: options.command === 'post' ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  }
  if (options.command === 'post') {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({ id: options.id, role: options.role, content: options.content })
  }

  let response
  try {
    response = await fetchImpl(`${baseUrl}${endpoint}`, init)
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('The collaboration bridge request timed out')
    }
    throw new Error(`Could not reach the collaboration bridge: ${error?.message || String(error)}`)
  }
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    if (!response.ok) data = undefined
    else throw new Error('The collaboration bridge returned an invalid JSON response')
  }
  if (!response.ok) throw new Error(`${response.status}: ${responseMessage(data, text, response)}`)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The collaboration bridge returned an invalid JSON response')
  }
  if (options.command === 'post' && data.ok !== true) {
    throw new Error('The collaboration bridge did not confirm the message')
  }
  if (options.command !== 'post') {
    if (typeof data.id !== 'string' || !SESSION_ID.test(data.id)) {
      throw new Error('The collaboration bridge response did not include a valid session ID')
    }
    if (options.id && data.id !== options.id) {
      throw new Error('The collaboration bridge returned a different session ID')
    }
    if (options.command === 'get' && !Array.isArray(data.messages)) {
      throw new Error('The collaboration bridge response did not include a messages list')
    }
  }
  return data
}

function safeText(value) {
  return String(value ?? '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function formatResult(options, data) {
  const shareUrl = data.shareUrl || `/jarvis?session=${encodeURIComponent(data.id)}`
  if (options.json) {
    const output = ['create', 'get'].includes(options.command) ? { ...data, shareUrl } : data
    return JSON.stringify(output, null, 2)
  }
  if (options.command === 'create') {
    return `Created collaboration session ${safeText(data.id)}.\nShare link: ${safeText(shareUrl)}`
  }
  if (options.command === 'get') {
    const messages = data.messages.map(message =>
      `  ${safeText(message?.role || 'unknown')}: ${safeText(message?.content || '')}`)
    return `Session ${safeText(data.id)} (${Number.isFinite(data.participants) ? data.participants : 'unknown'} participants)` +
      `\nShare link: ${safeText(shareUrl)}` +
      (messages.length ? `\nMessages:\n${messages.join('\n')}` : '\nNo messages yet.')
  }
  return `Message sent to session ${safeText(data.id)}.`
}

export {
  formatResult, parseArgs, request, resolveBridgeConfig, usage, validateContent, validateSessionId,
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.command === 'help') console.log(usage())
    else console.log(formatResult(options, await request(options)))
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`\n${usage()}`)
    process.exitCode = 1
  }
}
