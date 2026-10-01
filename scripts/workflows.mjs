#!/usr/bin/env node

import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8765'
const TOKEN_ENV = 'MARKL_BRIDGE_TOKEN'
const WORKFLOW_STATUSES = new Set(['draft', 'running', 'paused', 'done', 'failed'])
const STEP_STATUSES = new Set(['pending', 'running', 'done', 'failed', 'blocked', 'skipped'])

function usage() {
  return `GhostForge workflow management CLI

Usage:
  ghostforge workflows list [--json]
  ghostforge workflows show <workflow-id> [--json]
  ghostforge workflows run <workflow-id> [--max-steps <1-100>] [--json]
  ghostforge workflows create --name <name> [--goal <goal>] [--step <title> ...] [--json]
  ghostforge workflows update <workflow-id> [--name <name>] [--goal <goal>] [--status <status>] [--json]
  ghostforge workflows step <workflow-id> <step-id> <status> [--notes <text>] [--json]
  ghostforge workflows delete <workflow-id> [--json]

Workflow statuses: draft, running, paused, done, failed
Step statuses: pending, running, done, failed, blocked, skipped

The run command executes only bridge-allowlisted command steps; manual steps are skipped.
Workflow runs are limited to 100 steps by default. Use --max-steps to set a lower maximum.

Environment:
  MARKL_BRIDGE_TOKEN       Bridge bearer token (required)
  MARKL_BRIDGE_URL         Bridge base URL (default: ${DEFAULT_BASE_URL})
  GF_ALLOW_REMOTE_BRIDGE=1 Explicitly allow a non-loopback bridge URL`
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { command: 'help', json: false }
  const [command = 'help', ...rest] = argv
  if (!['help', 'list', 'show', 'run', 'create', 'update', 'step', 'delete'].includes(command)) {
    throw new Error(`Unknown command: ${command}`)
  }
  if (command === 'help') {
    if (rest.length) throw new Error(`Unknown argument: ${rest[0]}`)
    return { command: 'help', json: false }
  }

  const options = { command, json: false }
  let index = 0
  const positionalCount = { list: 0, show: 1, run: 1, create: 0, update: 1, step: 3, delete: 1 }[command]
  const positionals = rest.slice(0, positionalCount)
  if (positionals.length !== positionalCount || positionals.some(value => value.startsWith('--'))) {
    const labels = {
      show: 'workflow ID',
      run: 'workflow ID',
      update: 'workflow ID',
      step: 'workflow ID, step ID, and status',
      delete: 'workflow ID',
    }
    throw new Error(`${command} requires ${labels[command] || 'arguments'}`)
  }
  index = positionals.length

  if (command === 'show' || command === 'run' || command === 'update' || command === 'delete') {
    options.id = validateId(positionals[0], 'workflow')
  } else if (command === 'step') {
    options.id = validateId(positionals[0], 'workflow')
    options.stepId = validateId(positionals[1], 'step')
    options.status = validateStatus(positionals[2], STEP_STATUSES, 'step')
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

    const allowed = command === 'create'
      ? ['--name', '--goal', '--step']
      : command === 'update'
        ? ['--name', '--goal', '--status']
        : command === 'run'
          ? ['--max-steps']
          : command === 'step'
            ? ['--notes']
            : []
    if (!allowed.includes(arg)) throw new Error(`Unknown option or argument: ${arg}`)
    if (arg !== '--step' && seen.has(arg)) throw new Error(`${arg} may only be provided once`)
    seen.add(arg)
    const value = rest[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    if (arg === '--name') options.name = value.trim()
    if (arg === '--goal') options.goal = value
    if (arg === '--step') {
      options.steps ||= []
      const title = value.trim()
      if (!title) throw new Error('--step requires a non-empty step title')
      options.steps.push(title)
    }
    if (arg === '--status') options.status = validateStatus(value, WORKFLOW_STATUSES, 'workflow')
    if (arg === '--notes') options.notes = value
    if (arg === '--max-steps') options.maxSteps = validateMaxSteps(value)
    index += 2
  }

  if (command === 'run' && options.maxSteps === undefined) options.maxSteps = 100
  if (command === 'create' && !options.name) throw new Error('create requires a non-empty --name')
  if (command === 'update') {
    if (options.name !== undefined && !options.name) throw new Error('--name requires a non-empty workflow name')
    if (options.name === undefined && options.goal === undefined && options.status === undefined) {
      throw new Error('update requires at least one of --name, --goal, or --status')
    }
  }
  if (command === 'step' && options.notes !== undefined && !options.notes.trim()) {
    throw new Error('--notes requires non-empty text')
  }
  return options
}

function validateId(value, kind) {
  if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${kind} ID`)
  }
  return value
}

function validateStatus(value, statuses, kind) {
  if (!statuses.has(value)) {
    throw new Error(`Invalid ${kind} status "${value}"; allowed: ${[...statuses].join(', ')}`)
  }
  return value
}

function validateMaxSteps(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error('--max-steps must be an integer between 1 and 100')
  }
  const maxSteps = Number(value)
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) {
    throw new Error('--max-steps must be an integer between 1 and 100')
  }
  return maxSteps
}

function resolveBaseUrl(env = process.env) {
  const raw = env.MARKL_BRIDGE_URL?.trim() || DEFAULT_BASE_URL
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('MARKL_BRIDGE_URL must be an absolute http(s) URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('MARKL_BRIDGE_URL must use http or https')
  }
  if (parsed.username || parsed.password || !['/', ''].includes(parsed.pathname) ||
      parsed.search || parsed.hash) {
    throw new Error('MARKL_BRIDGE_URL must contain only scheme, host, and optional port')
  }
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)
  if (!loopback && env.GF_ALLOW_REMOTE_BRIDGE !== '1') {
    throw new Error('MARKL_BRIDGE_URL is not loopback; set GF_ALLOW_REMOTE_BRIDGE=1 to opt in')
  }
  return parsed.origin
}

function sessionHeaders(env = process.env) {
  const token = env[TOKEN_ENV]?.trim()
  if (!token) throw new Error(`${TOKEN_ENV} is required`)
  if (/[\r\n]/.test(token)) throw new Error(`${TOKEN_ENV} contains invalid characters`)
  return { Authorization: `Bearer ${token}` }
}

async function request(options, env = process.env, fetchImpl = fetch) {
  const base = resolveBaseUrl(env)
  const headers = { ...sessionHeaders(env) }
  const init = { method: 'GET', headers, signal: AbortSignal.timeout(8000) }
  let endpoint = '/api/workflows'
  if (options.command === 'show') {
    endpoint += `?id=${encodeURIComponent(options.id)}`
  } else if (options.command === 'run') {
    init.method = 'POST'
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({ action: 'run', id: options.id, max_steps: options.maxSteps })
  } else if (options.command === 'create') {
    init.method = 'POST'
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({
      name: options.name,
      ...(options.goal !== undefined ? { goal: options.goal } : {}),
      steps: (options.steps || []).map(title => ({ title, kind: 'manual' })),
    })
  } else if (options.command === 'update') {
    init.method = 'PUT'
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({
      id: options.id,
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.goal !== undefined ? { goal: options.goal } : {}),
      ...(options.status !== undefined ? { status: options.status } : {}),
    })
  } else if (options.command === 'step') {
    init.method = 'PUT'
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({
      id: options.id,
      step_id: options.stepId,
      step: { status: options.status, ...(options.notes !== undefined ? { notes: options.notes } : {}) },
      log: `CLI status update: ${options.status}`,
    })
  } else if (options.command === 'delete') {
    init.method = 'DELETE'
    endpoint += `?id=${encodeURIComponent(options.id)}`
  } else if (options.command !== 'list') {
    throw new Error(`Unsupported workflows command: ${options.command}`)
  }

  const response = await fetchImpl(`${base}${endpoint}`, init)
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail
      : data.detail !== undefined ? JSON.stringify(data.detail)
        : typeof data.error === 'string' ? data.error
          : response.statusText || 'request failed'
    throw new Error(`${response.status}: ${detail}`)
  }
  if (!text || !data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The workflows API returned an invalid JSON response')
  }
  if (options.command === 'list' && !Array.isArray(data.workflows)) {
    throw new Error('The workflows API response did not include a workflows list')
  }
  if (['show', 'run', 'create', 'update', 'step'].includes(options.command)) {
    const workflow = data.workflow
    if (!workflow || typeof workflow !== 'object' || typeof workflow.id !== 'string' || !workflow.id ||
        (options.id && workflow.id !== options.id)) {
      throw new Error('The workflows API response did not include the requested workflow')
    }
  }
  if (options.command === 'run') {
    const progress = data.progress
    if (!progress || typeof progress !== 'object' || Array.isArray(progress) ||
        !Number.isInteger(progress.done) || !Number.isInteger(progress.total) ||
        !Number.isInteger(progress.pct) || progress.done < 0 || progress.total < 0 ||
        progress.done > progress.total || progress.pct < 0 || progress.pct > 100 ||
        data.workflow.status !== 'done') {
      throw new Error('The workflows API response did not include a valid completed run result')
    }
  }
  if (options.command === 'delete' && typeof data.ok !== 'boolean') {
    throw new Error('The workflows API response did not include a delete result')
  }
  if (options.command === 'delete' && !data.ok) throw new Error('Workflow not found')
  return data
}

function formatResult(options, data) {
  if (options.json) return JSON.stringify(data, null, 2)
  if (options.command === 'list') {
    if (data.workflows.length === 0) return 'No workflows found.'
    const rows = data.workflows.map(workflow => {
      const progress = workflow.progress ? `, ${workflow.progress.pct ?? 0}% complete` : ''
      return `  ${workflow.name} (${workflow.id}) — ${workflow.status || 'unknown'}${progress}`
    })
    return `Workflows (${data.workflows.length})\n${rows.join('\n')}`
  }
  if (options.command === 'show') {
    const workflow = data.workflow
    const progress = data.progress || workflow.progress
    const summary = `${workflow.name} (${workflow.id}) — ${workflow.status || 'unknown'}`
    const percentage = progress ? `\nProgress: ${progress.done}/${progress.total} steps (${progress.pct}%)` : ''
    const steps = (workflow.steps || []).map(step => `  [${step.status || 'pending'}] ${step.title} (${step.id})`)
    return `${summary}${percentage}${steps.length ? `\nSteps:\n${steps.join('\n')}` : '\nNo steps.'}`
  }
  if (options.command === 'run') {
    const { workflow, progress } = data
    return `Workflow ${workflow.id} finished (${workflow.status}): ${progress.done}/${progress.total} steps (${progress.pct}%).`
  }
  if (options.command === 'create') {
    const workflow = data.workflow
    return `Created workflow ${workflow.name} (${workflow.id}). Steps are stored only; none were executed.`
  }
  if (options.command === 'update') {
    return `Updated workflow ${data.workflow.name} (${data.workflow.id}). Metadata only; no steps were executed.`
  }
  if (options.command === 'step') {
    return `Recorded status "${options.status}" for step ${options.stepId} in workflow ${options.id}. No step was executed.`
  }
  return `Deleted workflow ${options.id}.`
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
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`\n${usage()}`)
    process.exitCode = 1
  }
}
