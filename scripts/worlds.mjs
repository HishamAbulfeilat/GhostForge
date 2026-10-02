#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const AI_TOWN_COMMIT = '8e05997f2409275669c8344b84a51692e83f3f33'
export const AI_TOWN_REPOSITORY = 'https://github.com/a16z-infra/ai-town.git'
export const AI_TOWN_DIRECTORY = path.join(ROOT, 'apps', 'worlds', 'ai-town')
export const AI_TOWN_CHECKOUT = path.join(AI_TOWN_DIRECTORY, 'upstream')
const DEFAULT_TIMEOUT_MS = 120_000

const COMPOSE_PORTS = [
  ["      - '5173:5173'", "      - '127.0.0.1:5173:5173'", "      - '127.0.0.1:${GF_AI_TOWN_FRONTEND_PORT:-5173}:5173'"],
  ["      - '${PORT:-3210}:3210'", "      - '127.0.0.1:${PORT:-3210}:3210'", "      - '127.0.0.1:${PORT:-3210}:3210'"],
  ["      - '${SITE_PROXY_PORT:-3211}:3211'", "      - '127.0.0.1:${SITE_PROXY_PORT:-3211}:3211'", "      - '127.0.0.1:${SITE_PROXY_PORT:-3211}:3211'"],
  ["      - '${DASHBOARD_PORT:-6791}:6791'", "      - '127.0.0.1:${DASHBOARD_PORT:-6791}:6791'", "      - '127.0.0.1:${DASHBOARD_PORT:-6791}:6791'"],
]
const OLLAMA_PORT_MAPPING = "      - '${OLLAMA_PORT:-11434}:11434'"
const HOST_GATEWAY_MAPPING = '      - "host.docker.internal:host-gateway"'

function npmCli() {
  const candidate = path.resolve(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!existsSync(candidate)) throw new Error(`Could not locate npm's CLI beside ${process.execPath}.`)
  return candidate
}

function run(command, args, { cwd = ROOT, capture = false, timeout = DEFAULT_TIMEOUT_MS, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    timeout,
    windowsHide: true,
  })
  if (result.error) throw new Error(`Could not run ${path.basename(command)}: ${result.error.message}`)
  if (result.signal) throw new Error(`${path.basename(command)} was terminated by ${result.signal}.`)
  if (result.status !== 0) {
    const detail = capture ? String(result.stderr || result.stdout || '').trim() : ''
    throw new Error(`${path.basename(command)} exited with status ${result.status}${detail ? `: ${detail}` : '.'}`)
  }
  return capture ? String(result.stdout || '') : ''
}

function runNpm(args, options = {}) {
  return run(process.execPath, [npmCli(), ...args], options)
}

function runGit(args, options = {}) {
  return run('git', args, options)
}

function compose(args, options = {}) {
  return run('docker', ['compose', '-f', path.join(AI_TOWN_CHECKOUT, 'docker-compose.yml'), ...args], {
    cwd: AI_TOWN_CHECKOUT,
    ...options,
  })
}

export function hardenComposeText(source) {
  let result = source
  for (const [upstream, hardened, managed] of COMPOSE_PORTS) {
    if (result.includes(managed)) continue
    if (result.includes(hardened)) {
      result = result.replace(hardened, managed)
      continue
    }
    if (!result.includes(upstream)) {
      throw new Error(`AI Town Compose file is missing the expected upstream port mapping: ${upstream.trim()}`)
    }
    result = result.replace(upstream, managed)
  }

  result = result.replace(`${OLLAMA_PORT_MAPPING}\n`, '').replace(OLLAMA_PORT_MAPPING, '')
  const backend = /(^  backend:\r?\n)([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:|^volumes:)/m
  const match = result.match(backend)
  if (!match) throw new Error('AI Town Compose file is missing its backend service.')
  if (!match[2].includes(HOST_GATEWAY_MAPPING)) {
    result = result.replace(backend, `${match[1]}${match[2].replace(
      /(?=^    healthcheck:)/m,
      `    extra_hosts:\n${HOST_GATEWAY_MAPPING}\n`,
    )}`)
  }

  if (!result.includes(HOST_GATEWAY_MAPPING)) {
    throw new Error('Could not configure the backend host-gateway alias required for local model access.')
  }
  const publishedPorts = result.split(/\r?\n/).filter(line => /^\s+-\s+['"]?.*:\d+['"]?\s*$/.test(line))
  if (publishedPorts.some(line => !line.includes('127.0.0.1:'))) {
    throw new Error('AI Town Compose contains a published port that is not restricted to loopback.')
  }
  return result
}

function checkoutStatus() {
  return runGit(['-C', AI_TOWN_CHECKOUT, 'status', '--porcelain', '--untracked-files=all'], { capture: true })
    .split(/\r?\n/)
    .filter(line => line.trim())
}

function verifyCheckout() {
  if (!existsSync(path.join(AI_TOWN_CHECKOUT, '.git'))) {
    throw new Error('AI Town is not set up. Run: node apps/worlds/ai-town/setup.mjs')
  }
  const origin = runGit(['-C', AI_TOWN_CHECKOUT, 'remote', 'get-url', 'origin'], { capture: true }).trim()
  if (origin !== AI_TOWN_REPOSITORY) {
    throw new Error(`AI Town checkout has unexpected origin "${origin}". Refusing to run it.`)
  }
  const commit = runGit(['-C', AI_TOWN_CHECKOUT, 'rev-parse', 'HEAD'], { capture: true }).trim()
  if (commit !== AI_TOWN_COMMIT) {
    throw new Error(`AI Town must be checked out at ${AI_TOWN_COMMIT}; found ${commit}.`)
  }
  const composeFile = path.join(AI_TOWN_CHECKOUT, 'docker-compose.yml')
  if (!existsSync(composeFile)) throw new Error('The pinned AI Town checkout has no docker-compose.yml.')
  const unexpectedChanges = checkoutStatus().filter(line => {
    const changedPath = line.slice(3).replaceAll('\\', '/')
    return changedPath !== 'docker-compose.yml' && !changedPath.startsWith('convex/_generated/')
  })
  if (unexpectedChanges.length) {
    throw new Error(`AI Town has unexpected local source changes: ${unexpectedChanges.map(line => line.slice(3)).join(', ')}.`)
  }
  const source = readFileSync(composeFile, 'utf8')
  if (hardenComposeText(source) !== source) {
    throw new Error('AI Town Compose configuration is not loopback-hardened. Run setup again.')
  }
}

function hardenComposeFile() {
  const composeFile = path.join(AI_TOWN_CHECKOUT, 'docker-compose.yml')
  const source = readFileSync(composeFile, 'utf8')
  const hardened = hardenComposeText(source)
  if (source !== hardened) writeFileSync(composeFile, hardened, 'utf8')
}

function setPinnedCommit() {
  if (!existsSync(path.join(AI_TOWN_CHECKOUT, '.git'))) {
    if (existsSync(AI_TOWN_CHECKOUT)) {
      throw new Error(`Refusing to overwrite the existing non-Git directory ${AI_TOWN_CHECKOUT}.`)
    }
    runGit(['clone', AI_TOWN_REPOSITORY, AI_TOWN_CHECKOUT])
  }

  const origin = runGit(['-C', AI_TOWN_CHECKOUT, 'remote', 'get-url', 'origin'], { capture: true }).trim()
  if (origin !== AI_TOWN_REPOSITORY) {
    throw new Error(`The existing AI Town directory has unexpected origin "${origin}".`)
  }
  const commit = runGit(['-C', AI_TOWN_CHECKOUT, 'rev-parse', 'HEAD'], { capture: true }).trim()
  if (commit !== AI_TOWN_COMMIT) {
    if (checkoutStatus().length) {
      throw new Error('AI Town checkout has local changes; preserve them before changing its pinned commit.')
    }
    runGit(['-C', AI_TOWN_CHECKOUT, 'fetch', '--depth', '1', 'origin', AI_TOWN_COMMIT])
    runGit(['-C', AI_TOWN_CHECKOUT, 'checkout', '--detach', AI_TOWN_COMMIT])
  }
}

export function setupAiTown() {
  mkdirSync(AI_TOWN_DIRECTORY, { recursive: true })
  setPinnedCommit()
  hardenComposeFile()
  verifyCheckout()
  console.log('Installing AI Town dependencies with npm install (upstream README setup).')
  runNpm(['install'], { cwd: AI_TOWN_CHECKOUT, timeout: 600_000 })
  console.log(`AI Town is ready at pinned commit ${AI_TOWN_COMMIT}.`)
}

function portFromEnv(env, key, fallback) {
  const raw = env[key] ?? fallback
  if (!/^\d+$/.test(String(raw))) throw new Error(`${key} must be a TCP port from 1 to 65535.`)
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${key} must be a TCP port from 1 to 65535.`)
  }
  return port
}

function worldPorts(env = process.env) {
  return {
    frontend: portFromEnv(env, 'GF_AI_TOWN_FRONTEND_PORT', '5173'),
    backend: portFromEnv(env, 'GF_AI_TOWN_PORT', '3210'),
    siteProxy: portFromEnv(env, 'GF_AI_TOWN_SITE_PROXY_PORT', '3211'),
    dashboard: portFromEnv(env, 'GF_AI_TOWN_DASHBOARD_PORT', '6791'),
  }
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

function currentDashboardPort() {
  const output = compose(['port', 'dashboard', '6791'], { capture: true }).trim()
  const match = output.match(/:(\d+)$/)
  if (!match) throw new Error(`Could not determine the AI Town dashboard's loopback port from "${output}".`)
  return portFromEnv({ port: match[1] }, 'port', '6791')
}

async function chooseDashboardPort(services, env) {
  if (services.includes('dashboard') && !env.GF_AI_TOWN_DASHBOARD_PORT) {
    return currentDashboardPort()
  }
  if (env.GF_AI_TOWN_DASHBOARD_PORT) {
    const requested = worldPorts(env).dashboard
    if (services.includes('dashboard') && requested === currentDashboardPort()) return requested
    if (!await isPortAvailable(requested)) {
      throw new Error(`AI Town dashboard port ${requested} is already in use.`)
    }
    return requested
  }
  for (let port = 6791; port <= 6889; port += 1) {
    if (await isPortAvailable(port)) return port
  }
  throw new Error('No free AI Town dashboard port was found between 6791 and 6889.')
}

export function parseWorldArgs(args) {
  const positional = args.filter(arg => arg !== '--json')
  const json = args.includes('--json')
  const [action, world, ...extra] = positional
  if (!['setup', 'start', 'stop', 'status'].includes(action)) {
    throw new Error('Action must be setup, start, stop, or status. Usage: ghostforge worlds start|stop|status ai-town')
  }
  if (action === 'setup') {
    if ((world && world !== 'ai-town') || extra.length) throw new Error('Usage: ghostforge worlds setup ai-town')
  } else if (world !== 'ai-town' || extra.length) {
    throw new Error('Only the ai-town, agent-office, and all worlds are supported.')
  }
  if (json && action !== 'status') throw new Error('--json is only supported for status.')
  return { action, world: action === 'setup' ? 'ai-town' : world, json }
}

function parseEnvFile(filename) {
  if (!existsSync(filename)) return new Map()
  return new Map(readFileSync(filename, 'utf8').split(/\r?\n/)
    .filter(line => line && !line.trimStart().startsWith('#'))
    .map(line => {
      const separator = line.indexOf('=')
      return separator < 0
        ? [line, '']
        : [line.slice(0, separator), line.slice(separator + 1).replace(/^"(.*)"$/, '$1')]
    }))
}

function saveEnvFile(filename, values) {
  const previous = existsSync(filename) ? readFileSync(filename, 'utf8').split(/\r?\n/) : []
  const remaining = new Map(values)
  const lines = previous.map(line => {
    const separator = line.indexOf('=')
    if (separator < 0) return line
    const key = line.slice(0, separator)
    if (!remaining.has(key)) return line
    const value = remaining.get(key)
    remaining.delete(key)
    return `${key}=${JSON.stringify(value)}`
  }).filter(Boolean)
  for (const [key, value] of remaining) lines.push(`${key}=${JSON.stringify(value)}`)
  writeFileSync(filename, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
}

function ensureSelfHostedConfig() {
  const filename = path.join(AI_TOWN_CHECKOUT, '.env.local')
  const current = parseEnvFile(filename)
  let adminKey = current.get('CONVEX_SELF_HOSTED_ADMIN_KEY')
  let changed = false
  if (!adminKey) {
    adminKey = compose(['exec', '-T', 'backend', './generate_admin_key.sh'], { capture: true }).trim()
    if (!adminKey || /[\r\n]/.test(adminKey)) {
      throw new Error('AI Town backend did not return a valid local Convex admin key.')
    }
    current.set('CONVEX_SELF_HOSTED_ADMIN_KEY', adminKey)
    changed = true
  }
  const selfHostedUrl = `http://127.0.0.1:${worldPorts().backend}`
  if (current.get('CONVEX_SELF_HOSTED_URL') !== selfHostedUrl) {
    current.set('CONVEX_SELF_HOSTED_URL', selfHostedUrl)
    changed = true
  }
  if (!changed) return
  saveEnvFile(filename, current)
  console.log('Updated the local Convex URL in the ignored upstream .env.local.')
}

function normalizedModel(value, label) {
  const result = String(value ?? '').trim()
  if (!result || /[\r\n\0]/.test(result)) throw new Error(`${label} must be a non-empty single-line value.`)
  return result
}

export function normalizeGatewayUrl(value) {
  let url
  try {
    url = new URL(String(value).trim())
  } catch {
    throw new Error('AI Town gateway URL must be an absolute http(s) URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('AI Town gateway URL must use http(s), without embedded credentials, query, or fragment.')
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.hostname = 'host.docker.internal'
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export function gatewaySettings(env) {
  const apiUrl = env.GF_AI_TOWN_LLM_API_URL || env.OMNIROUTE_URL || env.OPENROUTER_BASE_URL
  if (!apiUrl) return null
  return {
    url: normalizeGatewayUrl(apiUrl),
    model: normalizedModel(env.GF_AI_TOWN_LLM_MODEL || env.OMNIROUTE_MODEL || env.OPENROUTER_MODEL, 'GF_AI_TOWN_LLM_MODEL'),
    embeddingModel: normalizedModel(env.GF_AI_TOWN_LLM_EMBEDDING_MODEL, 'GF_AI_TOWN_LLM_EMBEDDING_MODEL'),
    apiKey: env.GF_AI_TOWN_LLM_API_KEY || env.OMNIROUTE_API_KEY || env.OPENROUTER_API_KEY || '',
  }
}

function setConvexEnv(name, value, secret = false) {
  try {
    runNpm(['exec', '--', 'convex', 'env', 'set', name, value], {
      cwd: AI_TOWN_CHECKOUT,
      capture: secret,
      timeout: 60_000,
    })
  } catch (error) {
    if (secret) throw new Error(`Could not set the ${name} value in the local Convex deployment.`)
    throw error
  }
}

function configureLlm(env) {
  const gateway = gatewaySettings(env)
  if (!gateway) {
    const host = normalizeGatewayUrl(env.GF_AI_TOWN_OLLAMA_HOST || 'http://host.docker.internal:11434')
    setConvexEnv('OLLAMA_HOST', host)
    if (env.GF_AI_TOWN_OLLAMA_MODEL) {
      setConvexEnv('OLLAMA_MODEL', normalizedModel(env.GF_AI_TOWN_OLLAMA_MODEL, 'GF_AI_TOWN_OLLAMA_MODEL'))
    }
    if (env.GF_AI_TOWN_OLLAMA_EMBEDDING_MODEL) {
      setConvexEnv('OLLAMA_EMBEDDING_MODEL', normalizedModel(
        env.GF_AI_TOWN_OLLAMA_EMBEDDING_MODEL,
        'GF_AI_TOWN_OLLAMA_EMBEDDING_MODEL',
      ))
    }
    console.log(`AI Town will use Ollama at ${host}.`)
    return
  }

  setConvexEnv('LLM_API_URL', gateway.url)
  setConvexEnv('LLM_MODEL', gateway.model)
  setConvexEnv('LLM_EMBEDDING_MODEL', gateway.embeddingModel)
  if (gateway.apiKey) setConvexEnv('LLM_API_KEY', gateway.apiKey, true)
  console.log(`AI Town will use the configured OpenAI-compatible gateway at ${new URL(gateway.url).origin}.`)
}

async function waitForEndpoint(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no HTTP response'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return response.status
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error(`${url} did not become ready: ${lastError}`)
}

function runningServices() {
  const output = compose(['ps', '--status', 'running', '--services'], { capture: true })
  return output.trim().split(/\r?\n/).filter(Boolean)
}

async function startAiTown(env = process.env) {
  verifyCheckout()
  hardenComposeFile()
  const ports = worldPorts(env)
  const services = runningServices()
  ports.dashboard = await chooseDashboardPort(services, env)
  run('docker', ['compose', 'version'], { capture: true, timeout: 10_000 })
  compose(['up', '--build', '--detach', '--wait', '--wait-timeout', '120'], {
    timeout: 600_000,
    env: {
      ...env,
      GF_AI_TOWN_FRONTEND_PORT: String(ports.frontend),
      PORT: String(ports.backend),
      SITE_PROXY_PORT: String(ports.siteProxy),
      DASHBOARD_PORT: String(ports.dashboard),
    },
  })
  ensureSelfHostedConfig()
  configureLlm(env)
  console.log('Initializing AI Town using the upstream README predev command.')
  runNpm(['run', 'predev'], { cwd: AI_TOWN_CHECKOUT, timeout: 600_000 })
  runNpm(['exec', '--', 'convex', 'run', 'testing:resume'], { cwd: AI_TOWN_CHECKOUT, timeout: 600_000 })
  await waitForEndpoint(`http://127.0.0.1:${ports.backend}/version`)
  await waitForEndpoint(`http://127.0.0.1:${ports.frontend}/`)
  console.log(`AI Town is running at http://127.0.0.1:${ports.frontend}.`)
}

async function statusAiTown(env = process.env) {
  verifyCheckout()
  const services = runningServices()
  const ports = worldPorts(env)
  const check = async (url, service) => {
    if (!services.includes(service)) return { url, ok: false, error: 'service is stopped' }
    try {
      const status = await waitForEndpoint(url, 2_000)
      return { url, ok: true, httpStatus: status }
    } catch (error) {
      return { url, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const [frontend, backend] = await Promise.all([
    check(`http://127.0.0.1:${ports.frontend}/`, 'frontend'),
    check(`http://127.0.0.1:${ports.backend}/version`, 'backend'),
  ])
  const status = frontend.ok && backend.ok ? 'running' : 'stopped'
  const dashboardPort = services.includes('dashboard') ? currentDashboardPort() : null
  return {
    world: 'ai-town',
    status,
    services,
    frontend,
    backend,
    dashboardUrl: dashboardPort ? `http://127.0.0.1:${dashboardPort}` : null,
  }
}

function stopAiTown() {
  verifyCheckout()
  compose(['stop'], { timeout: 60_000 })
  console.log('AI Town Compose services stopped; local Convex data was preserved.')
}

// agent-office is managed by the lightweight process manager in scripts/worlds/
// (T-166); ai-town needs the full Compose + Convex runtime below.
const OTHER_WORLDS_CLI = path.join(ROOT, 'scripts', 'worlds', 'cli.mjs')

function runOtherWorld(args, capture = false) {
  const result = spawnSync(process.execPath, [OTHER_WORLDS_CLI, ...args], {
    cwd: ROOT,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  })
  return { code: result.status ?? 1, stdout: result.stdout || '' }
}

async function captureStdout(fn) {
  const write = process.stdout.write
  let output = ''
  process.stdout.write = chunk => { output += chunk; return true }
  try {
    return { code: await fn(), output }
  } finally {
    process.stdout.write = write
  }
}

async function mainAll(action, json) {
  if (!json) {
    const town = await main([action, 'ai-town'])
    const others = runOtherWorld([action, 'agent-office']).code
    return Math.max(town, others)
  }
  const town = await captureStdout(() => main([action, 'ai-town', '--json']))
  const others = runOtherWorld([action, 'agent-office', '--json'], true)
  let otherStatus
  try {
    otherStatus = JSON.parse(others.stdout)
  } catch {
    otherStatus = [{ world: 'agent-office', status: 'unavailable', error: 'invalid status output' }]
  }
  console.log(JSON.stringify([JSON.parse(town.output), ...otherStatus]))
  return Math.max(town.code, others.code)
}

export async function main(args = process.argv.slice(2)) {
  const [action, world] = args.filter(arg => arg !== '--json')
  if (world === 'agent-office') return runOtherWorld(args).code
  if (world === 'all' || (!world && (action === 'status' || action === 'stop'))) {
    if (args.filter(arg => arg !== '--json').length > 2) {
      console.error('worlds: "all" cannot be combined with world names.')
      return 1
    }
    return mainAll(action, args.includes('--json'))
  }
  let parsed
  try {
    parsed = parseWorldArgs(args)
    if (parsed.action === 'setup') {
      setupAiTown()
    } else if (parsed.action === 'start') {
      await startAiTown()
    } else if (parsed.action === 'stop') {
      stopAiTown()
    } else {
      const status = await statusAiTown()
      if (parsed.json) console.log(JSON.stringify(status))
      else {
        console.log(`AI Town services: ${status.services.length ? status.services.join(', ') : 'stopped'}`)
        console.log(`Frontend: ${status.frontend.ok ? `${status.frontend.url} (HTTP ${status.frontend.httpStatus})` : `not responding (${status.frontend.error})`}`)
        console.log(`Convex backend: ${status.backend.ok ? `${status.backend.url} (HTTP ${status.backend.httpStatus})` : `not responding (${status.backend.error})`}`)
        console.log(`Dashboard: ${status.dashboardUrl || 'not running'}`)
      }
      if (status.status !== 'running') return 1
    }
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (args.includes('--json') && args[0] === 'status') {
      console.log(JSON.stringify({ world: 'ai-town', status: 'unavailable', error: message }))
    } else {
      console.error(`worlds: ${message}`)
    }
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
