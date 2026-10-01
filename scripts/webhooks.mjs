#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8765'
const TOKEN_ENV = 'MARKL_BRIDGE_TOKEN'

function usage() {
  return `GhostForge webhook controls

Usage:
  ghostforge webhooks config [--json]
  ghostforge webhooks set '<trigger-array-json>' [--json]
  ghostforge webhooks logs [--json]
  ghostforge webhooks clear [--json]

Commands:
  config                    Inspect configured webhook triggers
  set <trigger-array-json>  Replace trigger configuration
  logs                      View received webhook events
  clear                     Clear the webhook event log

Each trigger must include non-empty id, source, eventType, and action fields.

Environment:
  MARKL_BRIDGE_TOKEN          Bridge token (defaults to ~/.ghostforge/bridge/token)
  MARKL_BRIDGE_URL            Bridge base URL (default: ${DEFAULT_BRIDGE_URL})
  GF_ALLOW_REMOTE_BRIDGE=1    Explicitly allow a non-loopback bridge URL`
}

function validateTriggers(value) {
  if (!Array.isArray(value)) throw new Error('Trigger configuration must be a JSON array')
  const ids = new Set()
  for (const [index, trigger] of value.entries()) {
    if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
      throw new Error(`Trigger ${index + 1} must be an object`)
    }
    for (const key of ['id', 'source', 'eventType', 'action']) {
      if (typeof trigger[key] !== 'string' || !trigger[key].trim()) {
        throw new Error(`Trigger ${index + 1} requires a non-empty ${key}`)
      }
    }
    if (ids.has(trigger.id)) throw new Error(`Trigger IDs must be unique: ${trigger.id}`)
    ids.add(trigger.id)
  }
  return value
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help', config: undefined, json: false }
  }
  const [command = 'help', ...rest] = argv
  if (!['help', 'config', 'set', 'logs', 'clear'].includes(command)) {
    throw new Error(`Unknown command: ${command}`)
  }
  if (command === 'help') {
    if (rest.length) throw new Error(`Unknown argument: ${rest[0]}`)
    return { command: 'help', config: undefined, json: false }
  }

  const json = rest.at(-1) === '--json'
  const args = json ? rest.slice(0, -1) : rest
  if (args.includes('--json')) throw new Error('--json may only be provided once at the end')
  if (command === 'set') {
    if (args.length !== 1 || !args[0]) throw new Error('set requires one JSON trigger array')
    let config
    try {
      config = JSON.parse(args[0])
    } catch {
      throw new Error('set requires valid JSON containing a trigger array')
    }
    return { command, config: validateTriggers(config), json }
  }
  if (args.length) throw new Error(`${command} only accepts --json`)
  return { command, config: undefined, json }
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
  const path = {
    config: '/api/webhook',
    set: '/api/webhook',
    logs: '/api/webhook?log=1',
    clear: '/api/webhook',
  }[options.command]
  if (!path) throw new Error(`Unsupported webhook command: ${options.command}`)

  const init = {
    method: options.command === 'set' ? 'POST' : options.command === 'clear' ? 'DELETE' : 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  }
  if (options.command === 'set') {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({ config: options.config })
  }

  let response
  try {
    response = await fetchImpl(`${baseUrl}${path}`, init)
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('The webhook bridge request timed out')
    }
    throw new Error(`Could not reach the webhook bridge: ${error?.message || String(error)}`)
  }

  let text
  try {
    text = await response.text()
  } catch (error) {
    throw new Error(`Could not read the webhook bridge response: ${error?.message || String(error)}`)
  }
  let data
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    if (!response.ok) data = undefined
    else throw new Error('The webhook bridge returned an invalid JSON response')
  }
  if (!response.ok) throw new Error(`${response.status}: ${responseMessage(data, text, response)}`)

  if (options.command === 'config' || options.command === 'logs') {
    if (!Array.isArray(data)) {
      throw new Error(`The webhook bridge ${options.command} response must be a JSON array`)
    }
  } else if (!data || typeof data !== 'object' || Array.isArray(data) || data.ok !== true) {
    throw new Error('The webhook bridge did not confirm the requested change')
  }
  return data
}

function safeText(value) {
  return String(value ?? '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function formatResult(options, data) {
  if (options.json) return JSON.stringify(data, null, 2)
  if (options.command === 'config') {
    if (data.length === 0) return 'No webhook triggers configured.'
    const rows = data.map(trigger =>
      `  ${safeText(trigger.id)} [${safeText(trigger.source)}:${safeText(trigger.eventType)}] ${safeText(trigger.action)}`,
    )
    return `Webhook triggers (${data.length})\n${rows.join('\n')}`
  }
  if (options.command === 'logs') {
    if (data.length === 0) return 'No webhook events found.'
    const rows = data.map(entry => {
      const event = `${safeText(entry.source || 'unknown')} · ${safeText(entry.event || 'unknown')}`
      const receivedAt = entry.receivedAt ? ` · ${safeText(entry.receivedAt)}` : ''
      const body = entry.body === undefined ? '' : `\n    ${safeText(JSON.stringify(entry.body))}`
      return `  ${event}${receivedAt}${body}`
    })
    return `Webhook events (${data.length})\n${rows.join('\n')}`
  }
  if (options.command === 'set') {
    const count = options.config.length
    return `Saved ${count} trigger${count === 1 ? '' : 's'}.`
  }
  return 'Webhook event log cleared.'
}

export { formatResult, parseArgs, request, resolveBridgeConfig, usage, validateTriggers }

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.command === 'help') {
      console.log(usage())
    } else {
      const data = await request(options)
      console.log(formatResult(options, data))
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`\n${usage()}`)
    process.exitCode = 1
  }
}
