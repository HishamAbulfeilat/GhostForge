#!/usr/bin/env node
/**
 * Authenticated terminal surface for the web-ui device and push APIs.
 *
 * The web-ui session token is intentionally supplied only through the
 * GF_SESSION_TOKEN environment variable. Requests default to loopback so a
 * typo cannot send credentials to an arbitrary host; remote URLs require the
 * explicit GF_ALLOW_REMOTE_WEB_UI=1 opt-in.
 */
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'
const TOKEN_ENV = 'GF_SESSION_TOKEN'

function usage() {
  return `GhostForge device and push CLI

Usage:
  node scripts/device-status.mjs status
  node scripts/device-status.mjs push --title "Title" --body "Message" [--url "https://..."]

Environment:
  GF_SESSION_TOKEN          Existing web-ui gf_token session value (required)
  GF_WEB_UI_URL              Web UI base URL (default: ${DEFAULT_BASE_URL})
  GF_ALLOW_REMOTE_WEB_UI=1   Explicitly allow a non-loopback GF_WEB_UI_URL`
}

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv
  const options = { command, title: '', body: '', url: '' }
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg === '--help' || arg === '-h') return { command: 'help', title: '', body: '', url: '' }
    if (!['--title', '--body', '--url'].includes(arg)) throw new Error(`Unknown option: ${arg}`)
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    options[arg.slice(2)] = value
    index += 1
  }
  if (!['help', 'status', 'push'].includes(options.command)) {
    throw new Error(`Unknown command: ${options.command}`)
  }
  if (options.command === 'push' && (!options.title.trim() || !options.body.trim())) {
    throw new Error('push requires --title and --body')
  }
  return options
}

function resolveBaseUrl(env = process.env) {
  const raw = env.GF_WEB_UI_URL?.trim() || DEFAULT_BASE_URL
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('GF_WEB_UI_URL must be an absolute http(s) URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('GF_WEB_UI_URL must use http or https')
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('GF_WEB_UI_URL must contain only scheme, host, and optional port')
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
  if (!loopback && env.GF_ALLOW_REMOTE_WEB_UI !== '1') {
    throw new Error('GF_WEB_UI_URL is not loopback; set GF_ALLOW_REMOTE_WEB_UI=1 to opt in')
  }
  return parsed.origin
}

function sessionHeaders(env = process.env) {
  const token = env[TOKEN_ENV]?.trim()
  if (!token) throw new Error(`${TOKEN_ENV} is required`)
  if (/[\r\n]/.test(token)) throw new Error(`${TOKEN_ENV} contains invalid characters`)
  return { Cookie: `gf_token=${encodeURIComponent(token)}` }
}

async function request(command, options, env = process.env) {
  const base = resolveBaseUrl(env)
  const headers = { ...sessionHeaders(env) }
  const init = { method: 'GET', headers, signal: AbortSignal.timeout(8000) }
  let endpoint = '/api/bridge-status'
  if (command === 'push') {
    endpoint = '/api/push'
    init.method = 'POST'
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({
      notification: { title: options.title.trim(), body: options.body.trim(), ...(options.url ? { url: options.url.trim() } : {}) },
    })
  }
  const response = await fetch(`${base}${endpoint}`, init)
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text.slice(0, 300) } }
  if (!response.ok) throw new Error(`${response.status}: ${data.error || 'request failed'}`)
  return data
}

function formatResult(command, data) {
  if (command === 'status') {
    const device = data.device || {}
    return `${data.status || 'unknown'} — ${device.platformLabel || device.platform || 'unknown'} · ${device.hostname || 'unknown'}`
  }
  return data.message || (data.ok ? 'Push notification accepted.' : 'Push notification request completed.')
}

export { DEFAULT_BASE_URL, formatResult, parseArgs, request, resolveBaseUrl, sessionHeaders, usage }

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.command === 'help') {
      console.log(usage())
    } else {
      const data = await request(options.command, options)
      console.log(formatResult(options.command, data))
    }
  } catch (error) {
    console.error(`Error: ${error.message}`)
    console.error(`\n${usage()}`)
    process.exitCode = 1
  }
}
