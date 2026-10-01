#!/usr/bin/env node

import process from 'node:process'

const DEFAULT_URL = 'http://127.0.0.1:5678'
const MAX_PAYLOAD_BYTES = 64 * 1024

export function usage() {
  return `GhostForge n8n automation CLI

Usage:
  ghostforge n8n list [--json]
  ghostforge n8n show <workflow-id> [--json]
  ghostforge n8n trigger <workflow-id> [--data <json-object>] [--json]

Environment:
  N8N_URL                 n8n base URL (default: ${DEFAULT_URL})
  N8N_API_KEY             API key for n8n API requests
  GF_ALLOW_REMOTE_N8N=1   Explicitly allow non-loopback n8n HTTP URLs

Only active workflows with a POST or ALL Webhook node can be triggered.
The API key is never sent to workflow webhook endpoints.`
}

export function validateId(value, kind = 'workflow') {
  if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${kind} ID`)
  }
  return value
}

export function parsePayload(value) {
  if (value === undefined) return { triggeredFrom: 'ghostforge-cli' }
  if (Buffer.byteLength(value, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error(`--data must be no larger than ${MAX_PAYLOAD_BYTES} bytes`)
  }
  let parsed
  try { parsed = JSON.parse(value) } catch { throw new Error('--data must be valid JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--data must be a JSON object')
  }
  return parsed
}

export function parseArgs(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    if (argv.some(value => value !== '--help' && value !== '-h')) {
      throw new Error('--help cannot be combined with another command')
    }
    return { command: 'help', json: false }
  }
  const [command, ...rest] = argv
  if (!['list', 'show', 'trigger'].includes(command)) throw new Error(`Unknown command: ${command}`)
  const positionalCount = command === 'list' ? 0 : 1
  if (rest.length < positionalCount || (positionalCount && rest[0].startsWith('--'))) {
    throw new Error(`${command} requires a workflow ID`)
  }
  const options = { command, json: false }
  let index = positionalCount
  if (positionalCount) options.id = validateId(rest[0])
  const seen = new Set()
  while (index < rest.length) {
    const arg = rest[index]
    if (arg === '--json') {
      if (seen.has(arg)) throw new Error('--json may only be provided once')
      seen.add(arg); options.json = true; index += 1; continue
    }
    if (command !== 'trigger' || arg !== '--data') throw new Error(`Unknown option or argument: ${arg}`)
    if (seen.has(arg)) throw new Error('--data may only be provided once')
    const value = rest[index + 1]
    if (value === undefined) throw new Error('--data requires a value')
    seen.add(arg); options.data = parsePayload(value); index += 2
  }
  return options
}

export function resolveBaseUrl(env = process.env) {
  const raw = env.N8N_URL?.trim() || DEFAULT_URL
  let parsed
  try { parsed = new URL(raw) } catch { throw new Error('N8N_URL must be an absolute http(s) URL') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.search || parsed.hash || parsed.pathname.includes('..')) {
    throw new Error('N8N_URL must use http(s) without credentials, query, or fragment')
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !loopback && env.GF_ALLOW_REMOTE_N8N !== '1') {
    throw new Error('Remote n8n over plain HTTP is blocked; set GF_ALLOW_REMOTE_N8N=1 to opt in')
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

export function apiHeaders(env = process.env) {
  const apiKey = env.N8N_API_KEY?.trim()
  if (!apiKey) throw new Error('N8N_API_KEY is required for n8n API requests')
  if (/[\r\n]/.test(apiKey)) throw new Error('N8N_API_KEY contains invalid characters')
  return { 'X-N8N-API-KEY': apiKey }
}

function webhookPath(value) {
  const path = String(value ?? '').trim()
  const segments = path.split('/')
  if (!path || path.startsWith('/') || path.endsWith('/') ||
      !segments.every(segment => segment && segment !== '.' && segment !== '..' && /^[A-Za-z0-9._~-]+$/.test(segment))) {
    return null
  }
  return segments.map(encodeURIComponent).join('/')
}

export async function request(options, env = process.env, fetchImpl = fetch) {
  const base = resolveBaseUrl(env)
  const headers = apiHeaders(env)
  const fetchJson = async (path) => {
    let response
    try {
      response = await fetchImpl(`${base}${path}`, {
        headers, redirect: 'error', signal: AbortSignal.timeout(8000),
      })
    } catch (error) {
      throw new Error(`Could not reach n8n: ${error?.message || String(error)}`)
    }
    const text = await response.text()
    let body = {}
    try { body = text ? JSON.parse(text) : {} } catch { /* invalid response handled below */ }
    if (!response.ok) throw new Error(`${response.status}: ${body?.message || body?.error || `n8n returned HTTP ${response.status}`}`)
    return body
  }

  if (options.command === 'list') {
    const body = await fetchJson('/api/v1/workflows?limit=250')
    if (!Array.isArray(body.data)) throw new Error('The n8n API returned an invalid workflow list')
    return { workflows: body.data.map(workflow => ({ id: workflow.id, name: workflow.name, active: workflow.active })) }
  }

  const detail = await fetchJson(`/api/v1/workflows/${encodeURIComponent(options.id)}`)
  if (!detail || detail.id !== options.id || typeof detail.name !== 'string' ||
      typeof detail.active !== 'boolean' || !Array.isArray(detail.nodes)) {
    throw new Error('The n8n API returned invalid workflow details')
  }
  if (options.command === 'show') return { workflow: detail }
  if (!detail.active) throw new Error('Only active workflows can be triggered')
  const webhooks = detail.nodes
    .filter(node => node?.type === 'n8n-nodes-base.webhook')
    .map(node => ({ path: webhookPath(node.parameters?.path), method: String(node.parameters?.httpMethod || '').toUpperCase() }))
    .filter(webhook => webhook.path && ['POST', 'ALL'].includes(webhook.method))
  if (!webhooks.length) throw new Error('Workflow has no supported active POST or ALL webhook')
  if (webhooks.length > 1) throw new Error('Workflow has multiple supported webhooks; use the TUI to select one')

  const target = `${base}/webhook/${webhooks[0].path}`
  let response
  try {
    response = await fetchImpl(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.data || parsePayload()),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
  } catch (error) {
    throw new Error(`Could not reach the workflow webhook: ${error?.message || String(error)}`)
  }
  const text = await response.text()
  if (!response.ok) throw new Error(`The workflow webhook returned HTTP ${response.status}`)
  let result = text
  try { result = text ? JSON.parse(text) : {} } catch { /* preserve plain text */ }
  return { workflow: { id: detail.id, name: detail.name }, status: response.status, result }
}

export function formatResult(options, result) {
  if (options.json) return JSON.stringify(result)
  if (options.command === 'list') {
    return result.workflows.length
      ? result.workflows.map(workflow => `${workflow.active ? 'active' : 'inactive'}\t${workflow.id}\t${workflow.name}`).join('\n')
      : 'No n8n workflows found.'
  }
  if (options.command === 'show') {
    const workflow = result.workflow
    return `${workflow.name} (${workflow.id})\nStatus: ${workflow.active ? 'active' : 'inactive'}\nNodes: ${workflow.nodes.length}`
  }
  return `Triggered ${result.workflow.name} (${result.workflow.id}) — HTTP ${result.status}`
}

export async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const options = parseArgs(argv)
    if (options.command === 'help') { io.stdout.write(`${usage()}\n`); return 0 }
    const result = await request(options)
    io.stdout.write(`${formatResult(options, result)}\n`)
    return 0
  } catch (error) {
    io.stderr.write(`${error?.message || String(error)}\n`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) process.exitCode = await main()
