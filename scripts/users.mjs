#!/usr/bin/env node

import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'
const TOKEN_ENV = 'GF_SESSION_TOKEN'

function usage() {
  return `GhostForge user administration CLI

Usage:
  node scripts/users.mjs list [--json]
  node scripts/users.mjs update <user-id> [--role admin|user] [--active true|false]
                             [--permissions <key,key,...|none>] [--json]

Commands:
  list                 List users (requires an authenticated admin session)
  update <user-id>     Update role, permissions, or active status (owner only)

Options:
  --json               Print the API response as JSON
  -h, --help           Show this help

Environment:
  GF_SESSION_TOKEN          Existing web-ui gf_token session value (required)
  GF_WEB_UI_URL              Web UI base URL (default: ${DEFAULT_BASE_URL})
  GF_ALLOW_REMOTE_WEB_UI=1   Explicitly allow a non-loopback GF_WEB_UI_URL

To get a user ID, run the list command. Use --permissions none to clear all
permissions; otherwise provide comma-separated permission keys.`
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help', userId: '', role: undefined, active: undefined, permissions: undefined, json: false }
  }

  const [command = 'help', ...rest] = argv
  if (!['help', 'list', 'update'].includes(command)) {
    throw new Error(`Unknown command: ${command}`)
  }
  const options = { command, userId: '', role: undefined, active: undefined, permissions: undefined, json: false }
  let index = 0

  if (command === 'update') {
    const userId = rest[index]
    if (!userId || userId.startsWith('--')) throw new Error('update requires a user ID')
    if (!/^u_[a-f0-9]{12}$/.test(userId)) throw new Error('User ID must have the format u_<12 lowercase hexadecimal characters>')
    options.userId = userId
    index += 1
  }

  const seen = new Set()
  while (index < rest.length) {
    const arg = rest[index]
    if (arg === '--json' && command !== 'help') {
      if (seen.has(arg)) throw new Error(`${arg} may only be provided once`)
      seen.add(arg)
      options.json = true
      index += 1
      continue
    }

    if (command !== 'update' || !['--role', '--active', '--permissions'].includes(arg)) {
      throw new Error(`Unknown option or argument: ${arg}`)
    }
    if (seen.has(arg)) throw new Error(`${arg} may only be provided once`)
    seen.add(arg)
    const value = rest[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    if (arg === '--role') {
      if (!['admin', 'user'].includes(value)) throw new Error('--role must be admin or user')
      options.role = value
    } else if (arg === '--active') {
      if (!['true', 'false'].includes(value)) throw new Error('--active must be true or false')
      options.active = value === 'true'
    } else {
      if (value === 'none') {
        options.permissions = []
      } else {
        const permissions = value.split(',')
        if (permissions.some(permission => !/^[a-z][a-z0-9_]*$/.test(permission))) {
          throw new Error('--permissions must be comma-separated permission keys, or none')
        }
        if (new Set(permissions).size !== permissions.length) {
          throw new Error('--permissions cannot contain duplicate keys')
        }
        options.permissions = permissions
      }
    }
    index += 2
  }

  if (command === 'update' && options.role === undefined &&
      options.active === undefined && options.permissions === undefined) {
    throw new Error('update requires at least one of --role, --active, or --permissions')
  }
  if (command === 'list' && rest.length && rest.some(arg => arg !== '--json')) {
    throw new Error('list only accepts --json')
  }
  if (command === 'help' && rest.length) throw new Error(`Unknown argument: ${rest[0]}`)
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
  if (parsed.username || parsed.password || !['/', ''].includes(parsed.pathname) ||
      parsed.search || parsed.hash) {
    throw new Error('GF_WEB_UI_URL must contain only scheme, host, and optional port')
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)
  if (!loopback && env.GF_ALLOW_REMOTE_WEB_UI !== '1') {
    throw new Error('GF_WEB_UI_URL is not loopback; set GF_ALLOW_REMOTE_WEB_UI=1 to opt in')
  }
  if (!loopback && parsed.port && parsed.port !== (parsed.protocol === 'https:' ? '443' : '80')) {
    throw new Error('Remote GF_WEB_UI_URL must use the default port')
  }
  return parsed.origin
}

function sessionHeaders(env = process.env) {
  const token = env[TOKEN_ENV]?.trim()
  if (!token) throw new Error(`${TOKEN_ENV} is required`)
  if (/[\r\n]/.test(token)) throw new Error(`${TOKEN_ENV} contains invalid characters`)
  return { Cookie: `gf_token=${encodeURIComponent(token)}` }
}

async function request(options, env = process.env, fetchImpl = fetch) {
  const base = resolveBaseUrl(env)
  const headers = { ...sessionHeaders(env) }
  const init = { method: 'GET', headers, signal: AbortSignal.timeout(8000) }
  if (options.command === 'update') {
    init.method = 'PATCH'
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({
      id: options.userId,
      ...(options.role !== undefined ? { role: options.role } : {}),
      ...(options.active !== undefined ? { active: options.active } : {}),
      ...(options.permissions !== undefined ? { permissions: options.permissions } : {}),
    })
  } else if (options.command !== 'list') {
    throw new Error(`Unsupported users command: ${options.command}`)
  }

  const response = await fetchImpl(`${base}/api/users`, init)
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }
  if (!response.ok) {
    const detail = typeof data.error === 'string' ? data.error : response.statusText || 'request failed'
    throw new Error(`${response.status}: ${detail}`)
  }
  if (!text || !data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The users API returned an invalid JSON response')
  }
  if (options.command === 'list' && !Array.isArray(data.users)) {
    throw new Error('The users API response did not include a users list')
  }
  if (options.command === 'update' &&
      (!data.user || typeof data.user !== 'object' || data.user.id !== options.userId)) {
    throw new Error('The users API response did not include the updated user')
  }
  return data
}

function formatResult(options, data) {
  if (options.json) return JSON.stringify(data, null, 2)
  if (options.command === 'list') {
    if (data.users.length === 0) return 'No users found.'
    const rows = data.users.map(user =>
      `  ${user.username} (${user.id}) — ${user.role}${user.owner ? ', owner' : ''}, ${user.active ? 'active' : 'inactive'}`,
    )
    return `Users (${data.users.length})${data.canManage ? ' — owner access' : ' — read-only'}\n${rows.join('\n')}`
  }
  const user = data.user
  return `Updated ${user.username} (${user.id}): ${user.role}, ${user.active ? 'active' : 'inactive'}, permissions=${(user.permissions || []).join(',') || 'none'}`
}

export { formatResult, parseArgs, request, resolveBaseUrl, sessionHeaders, usage }

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
    console.error(`Error: ${error.message}`)
    console.error(`\n${usage()}`)
    process.exitCode = 1
  }
}
