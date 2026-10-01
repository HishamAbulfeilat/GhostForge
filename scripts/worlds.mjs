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
const STATE_DIRECTORY = path.join(AI_TOWN_DIRECTORY, '.state')
const STATE_FILE = path.join(STATE_DIRECTORY, 'initialized')
const PORTS_FILE = path.join(STATE_DIRECTORY, 'ports.json')
const DEFAULT_TIMEOUT_MS = 120_000

const EXPECTED_COMPOSE_MAPPINGS = [
  ["      - '5173:5173'", "      - '127.0.0.1:5173:5173'"],
  ["      - '${PORT:-3210}:3210'", "      - '127.0.0.1:${PORT:-3210}:3210'"],
  ["      - '${SITE_PROXY_PORT:-3211}:3211'", "      - '127.0.0.1:${SITE_PROXY_PORT:-3211}:3211'"],
  ["      - '${DASHBOARD_PORT:-6791}:6791'", "      - '127.0.0.1:${DASHBOARD_PORT:-6791}:6791'"],
]
const OLLAMA_COMPOSE_MAPPING = "      - '${OLLAMA_PORT:-11434}:11434'"
const HOST_GATEWAY_MAPPING = '      - "host.docker.internal:host-gateway"'

function npmCli() {
  const pathToCli = path.resolve(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!existsSync(pathToCli)) throw new Error(`Could not locate npm's CLI beside ${process.execPath}.`)
  return pathToCli
}

function run(command, args, options = {}) {
  const { cwd = ROOT, capture = false, timeout = DEFAULT_TIMEOUT_MS, env = process.env } = options
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

function runDocker(args, options = {}) {
  return run('docker', args, options)
}

function runGit(args, options = {}) {
  return run('git', args, options)
}

export function hardenComposeText(source) {
  let result = source
  for (const [expected, replacement] of EXPECTED_COMPOSE_MAPPINGS) {
    if (result.includes(replacement)) continue
    if (!result.includes(expected)) {
      throw new Error(`AI Town compose file is missing the expected upstream Compose port mapping: ${expected.trim()}`)
    }
    result = result.replace(expected, replacement)
  }

  if (result.includes(OLLAMA_COMPOSE_MAPPING)) {
    result = result.replace(`${OLLAMA_COMPOSE_MAPPING}\n`, '')
    result = result.replace(OLLAMA_COMPOSE_MAPPING, '')
  }
  if (result.includes(OLLAMA_COMPOSE_MAPPING)) {
    throw new Error('Could not remove AI Town’s Ollama host-port mapping.')
  }

  const backendService = /(^  backend:\r?\n)([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:|^volumes:)/m
  const match = result.match(backendService)
  if (!match) throw new Error('AI Town compose file is missing its backend service.')
  if (!match[2].includes(HOST_GATEWAY_MAPPING)) {
    const updated = `${match[1]}${match[2].replace(/(?=^    healthcheck:)/m, `    extra_hosts:\n${HOST_GATEWAY_MAPPING}\n`)}`
    result = result.replace(backendService, updated)
  }
  if (!result.includes(HOST_GATEWAY_MAPPING)) {
    throw new Error('Could not configure the backend host-gateway alias required for local model access.')
  }

  const publishedPorts = [...result.matchAll(/^\s*-\s*['"]?([^'"\r\n]+):(\d+):(\d+)['"]?\s*$/gm)]
  if (publishedPorts.some(([, host, , target]) => host.trim() !== '127.0.0.1' && !host.startsWith('127.0.0.1:'))) {
    throw new Error('AI Town Compose contains a published service port that is not restricted to loopback.')
  }
  return result
}

function composeFile() {
  return path.join(AI_TOWN_CHECKOUT, 'docker-compose.yml')
}

function verifyCheckout() {
  if (!existsSync(path.join(AI_TOWN_CHECKOUT, '.git'))) {
    throw new Error('AI Town is not set up. Run: node apps/worlds/ai-town/setup.mjs')
  }
  const origin = runGit(['-C', AI_TOWN_CHECKOUT, 'remote', 'get-url', 'origin'], { capture: true }).trim()
  if (origin !== AI_TOWN_REPOSITORY) {
    throw new Error(`The AI Town checkout has unexpected origin "${origin}". Refusing to run it.`)
  }
  const commit = runGit(['-C', AI_TOWN_CHECKOUT, 'rev-parse', 'HEAD'], { capture: true }).trim()
  if (commit !== AI_TOWN_COMMIT) {
    throw new Error(`AI Town must be checked out at ${AI_TOWN_COMMIT}; found ${commit}. Rerun setup after preserving local changes.`)
  }
  if (!existsSync(composeFile())) throw new Error('The pinned AI Town checkout has no docker-compose.yml.')
  const changes = runGit(['-C', AI_TOWN_CHECKOUT, 'status', '--porcelain', '--untracked-files=all'], { capture: true })
    .split(/\r?\n/).filter(change => change.trim())
  const unexpected = changes.filter(change => {
    const changedPath = change.slice(3).replaceAll('\\', '/')
    return changedPath !== 'docker-compose.yml' && !changedPath.startsWith('convex/_generated/')
  })
  if (unexpected.length) {
    throw new Error(`AI Town has unexpected local source changes: ${unexpected.map(change => change.slice(3)).join(', ')}.`)
  }
  const compose = readFileSync(composeFile(), 'utf8')
  if (hardenComposeText(compose) !== compose) {
    throw new Error('AI Town Compose configuration is not loopback-hardened. Run setup again.')
  }
}

function hardenComposeFile() {
  const filename = composeFile()
  const source = readFileSync(filename, 'utf8')
  const hardened = hardenComposeText(source)
  if (hardened !== source) writeFileSync(filename, hardened, 'utf8')
}

export function setupAiTown() {
  mkdirSync(AI_TOWN_DIRECTORY, { recursive: true })
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
    const status = runGit(['-C', AI_TOWN_CHECKOUT, 'status', '--porcelain'], { capture: true }).trim()
    if (status) throw new Error('AI Town checkout has local changes; preserve them before changing its pinned commit.')
    runGit(['-C', AI_TOWN_CHECKOUT, 'fetch', '--depth', '1', 'origin', AI_TOWN_COMMIT])
    runGit(['-C', AI_TOWN_CHECKOUT, 'checkout', '--detach', AI_TOWN_COMMIT])
  }

  hardenComposeFile()
  verifyCheckout()
  console.log('Installing AI Town dependencies with npm install (upstream README setup).')
  runNpm(['install'], { cwd: AI_TOWN_CHECKOUT, timeout: 600_000 })
  console.log(`AI Town is ready at pinned commit ${AI_TOWN_COMMIT}.`)
}

function compose(args, options = {}) {
  return runDocker(['compose', '-f', composeFile(), ...args], { cwd: AI_TOWN_CHECKOUT, ...options })
}

function parsePort(value, label) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} must be a TCP port from 1 to 65535.`)
  return port
}

async function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

async function dashboardPort(services, env = process.env) {
  const explicitPort = env.GF_AI_TOWN_DASHBOARD_PORT || env.DASHBOARD_PORT
  if (explicitPort) return parsePort(explicitPort, 'GF_AI_TOWN_DASHBOARD_PORT')

  let priorPort = 6791
  if (existsSync(PORTS_FILE)) {
    try {
      const prior = JSON.parse(readFileSync(PORTS_FILE, 'utf8'))
      priorPort = parsePort(prior.dashboard, 'Saved AI Town dashboard port')
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`AI Town saved port configuration is invalid: ${error.message}`)
      throw error
    }
  }
  if (services.includes('dashboard')) return priorPort

  for (let port = priorPort; port < Math.min(priorPort + 100, 65536); port += 1) {
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`No free AI Town dashboard port was found between ${priorPort} and ${Math.min(priorPort + 99, 65535)}.`)
}

function parseEnvFile(filename) {
  if (!existsSync(filename)) return new Map()
  return new Map(readFileSync(filename, 'utf8').split(/\r?\n/)
    .filter(line => line && !line.trimStart().startsWith('#'))
    .map(line => {
      const separator = line.indexOf('=')
      return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1).replace(/^"(.*)"$/, '$1')]
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
  if (current.get('CONVEX_SELF_HOSTED_ADMIN_KEY') && current.get('CONVEX_SELF_HOSTED_URL')) return

  const adminKey = compose(['exec', '-T', 'backend', './generate_admin_key.sh'], { capture: true }).trim()
  if (!adminKey || /[\r\n]/.test(adminKey)) throw new Error('AI Town backend did not return a valid local Convex admin key.')
  current.set('CONVEX_SELF_HOSTED_ADMIN_KEY', adminKey)
  current.set('CONVEX_SELF_HOSTED_URL', 'http://127.0.0.1:3210')
  saveEnvFile(filename, current)
  console.log('Generated a local Convex admin key in the ignored upstream .env.local.')
}

function validateModelName(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized || /[\r\n\0]/.test(normalized)) throw new Error(`${label} must be a non-empty single-line value.`)
  return normalized
}

export function normalizeGatewayUrl(value) {
  let parsed
  try {
    parsed = new URL(String(value).trim())
  } catch {
    throw new Error('AI Town gateway URL must be an absolute http(s) URL.')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.search || parsed.hash) {
    throw new Error('AI Town gateway URL must use http(s), without embedded credentials, query, or fragment.')
  }
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') {
    parsed.hostname = 'host.docker.internal'
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '')
  return parsed.origin + parsed.pathname.replace(/\/+$/, '')
}

export function gatewaySettings(env) {
  const gatewayUrl = env.GF_AI_TOWN_LLM_API_URL || env.OMNIROUTE_URL || env.OPENROUTER_BASE_URL
  if (!gatewayUrl) return null
  const model = validateModelName(
    env.GF_AI_TOWN_LLM_MODEL || env.OMNIROUTE_MODEL || env.OPENROUTER_MODEL,
    'GF_AI_TOWN_LLM_MODEL',
  )
  const embeddingModel = validateModelName(env.GF_AI_TOWN_LLM_EMBEDDING_MODEL, 'GF_AI_TOWN_LLM_EMBEDDING_MODEL')
  return {
    url: normalizeGatewayUrl(gatewayUrl),
    model,
    embeddingModel,
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

function configureLlm(env = process.env) {
  const gateway = gatewaySettings(env)
  if (!gateway) {
    const ollamaHost = normalizeGatewayUrl(env.GF_AI_TOWN_OLLAMA_HOST || 'http://host.docker.internal:11434')
    setConvexEnv('OLLAMA_HOST', ollamaHost)
    if (env.GF_AI_TOWN_OLLAMA_MODEL) {
      setConvexEnv('OLLAMA_MODEL', validateModelName(env.GF_AI_TOWN_OLLAMA_MODEL, 'GF_AI_TOWN_OLLAMA_MODEL'))
    }
    if (env.GF_AI_TOWN_OLLAMA_EMBEDDING_MODEL) {
      setConvexEnv('OLLAMA_EMBEDDING_MODEL', validateModelName(env.GF_AI_TOWN_OLLAMA_EMBEDDING_MODEL, 'GF_AI_TOWN_OLLAMA_EMBEDDING_MODEL'))
    }
    console.log(`AI Town will use Ollama at ${ollamaHost}.`)
    return
  }

  setConvexEnv('LLM_API_URL', gateway.url)
  setConvexEnv('LLM_MODEL', gateway.model)
  setConvexEnv('LLM_EMBEDDING_MODEL', gateway.embeddingModel)
  if (gateway.apiKey) setConvexEnv('LLM_API_KEY', gateway.apiKey, true)
  console.log(`AI Town will use the configured OpenAI-compatible gateway at ${new URL(gateway.url).origin}.`)
}

async function waitForEndpoint(url, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs
  let lastError = 'no HTTP response'
  while (Date.now() < end) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return response.status
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error.message
    }
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error(`${url} did not become ready: ${lastError}`)
}

async function startAiTown(env = process.env) {
  verifyCheckout()
  hardenComposeFile()
  runDocker(['compose', 'version'], { capture: true, timeout: 10_000 })
  const dashboard = await dashboardPort(readRunningServices(), env)
  mkdirSync(STATE_DIRECTORY, { recursive: true })
  writeFileSync(PORTS_FILE, `${JSON.stringify({ dashboard }, null, 2)}\n`, 'utf8')
  compose(['up', '--build', '--detach', '--wait', '--wait-timeout', '120'], {
    timeout: 600_000,
    env: { ...env, DASHBOARD_PORT: String(dashboard) },
  })
  ensureSelfHostedConfig()
  configureLlm(env)

  if (!existsSync(STATE_FILE)) {
    runNpm(['run', 'predev'], { cwd: AI_TOWN_CHECKOUT, timeout: 600_000 })
    mkdirSync(STATE_DIRECTORY, { recursive: true })
    writeFileSync(STATE_FILE, `${AI_TOWN_COMMIT}\n`, 'utf8')
  }

  await waitForEndpoint('http://127.0.0.1:3210/version')
  await waitForEndpoint('http://127.0.0.1:5173/')
  console.log('AI Town is running at http://127.0.0.1:5173.')
}

function readRunningServices() {
  const output = compose(['ps', '--status', 'running', '--services'], { capture: true })
  return output.trim().split(/\r?\n/).filter(Boolean)
}

async function statusAiTown() {
  verifyCheckout()
  const services = readRunningServices()
  let dashboard = 6791
  if (existsSync(PORTS_FILE)) {
    const saved = JSON.parse(readFileSync(PORTS_FILE, 'utf8'))
    dashboard = parsePort(saved.dashboard, 'Saved AI Town dashboard port')
  }
  const frontend = services.includes('frontend')
  const backend = services.includes('backend')
  let frontendStatus = null
  let backendStatus = null
  let frontendError = frontend ? 'no HTTP response' : 'service is stopped'
  let backendError = backend ? 'no HTTP response' : 'service is stopped'
  if (frontend) {
    try { frontendStatus = await waitForEndpoint('http://127.0.0.1:5173/', 2_000) } catch (error) {
      frontendError = error.message
    }
  }
  if (backend) {
    try { backendStatus = await waitForEndpoint('http://127.0.0.1:3210/version', 2_000) } catch (error) {
      backendError = error.message
    }
  }
  console.log(`AI Town services: ${services.length ? services.join(', ') : 'stopped'}`)
  console.log(`Frontend: ${frontendStatus ? `http://127.0.0.1:5173/ (HTTP ${frontendStatus})` : `not responding (${frontendError})`}`)
  console.log(`Convex backend: ${backendStatus ? `http://127.0.0.1:3210/version (HTTP ${backendStatus})` : `not responding (${backendError})`}`)
  console.log(`Dashboard: ${services.includes('dashboard') ? `http://127.0.0.1:${dashboard}` : 'not running'}`)
  return frontendStatus !== null && backendStatus !== null
}

function stopAiTown() {
  verifyCheckout()
  compose(['stop'])
  console.log('AI Town Compose services stopped; local Convex data was preserved.')
}

export function parseWorldArgs(args) {
  const [action, world, ...extra] = args
  if (!['start', 'stop', 'status'].includes(action)) {
    throw new Error('Action must be start, stop, or status. Usage: ghostforge worlds start|stop|status ai-town')
  }
  if (world !== 'ai-town' || extra.length) throw new Error('Only the ai-town world is currently supported.')
  return { action, world }
}

export async function main(args = process.argv.slice(2)) {
  try {
    const { action } = parseWorldArgs(args)
    if (action === 'start') await startAiTown()
    if (action === 'stop') stopAiTown()
    if (action === 'status' && !await statusAiTown()) {
      console.error('AI Town is stopped or one of its local HTTP services is unavailable.')
      return 1
    }
    return 0
  } catch (error) {
    console.error(`worlds: ${error.message}`)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
