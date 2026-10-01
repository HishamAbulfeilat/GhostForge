#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORLD_DIR = path.join(ROOT, 'apps', 'worlds', 'agent-office')
const CHECKOUT_DIR = path.join(WORLD_DIR, 'checkout')
const RUNTIME_DIR = path.join(WORLD_DIR, '.runtime')
const STATE_FILE = path.join(RUNTIME_DIR, 'state.json')
const LOG_FILE = path.join(RUNTIME_DIR, 'agent-office.log')
const SETUP_SCRIPT = path.join(WORLD_DIR, 'setup.mjs')
const SERVER_PORT = 3000
const UI_PORT = 5174
const SERVER_HEALTH_URL = `http://127.0.0.1:${SERVER_PORT}/api/offices`
const UI_URL = `http://127.0.0.1:${UI_PORT}/`
const REQUEST_TIMEOUT_MS = 1_000
const START_TIMEOUT_MS = 45_000
const STOP_TIMEOUT_MS = 15_000

function writeJson(response, statusCode, data) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(data)}\n`)
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`Unable to read Agent Office runtime state: ${error.message}`)
  }
}

async function requestSupervisor(state, method = 'GET') {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`http://127.0.0.1:${state.controlPort}/status`, {
      method,
      headers: { 'x-agent-office-token': state.controlToken },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForStart(state) {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const status = await requestSupervisor(state)
    if (status?.phase === 'running') return status
    if (status?.phase === 'failed') {
      throw new Error(`Agent Office failed to start. See ${path.relative(ROOT, LOG_FILE)}.`)
    }
    await delay(500)
  }
  await requestSupervisor(state, 'POST')
  throw new Error(`Agent Office did not answer on ports ${SERVER_PORT} and ${UI_PORT} within ${START_TIMEOUT_MS / 1000}s. See ${path.relative(ROOT, LOG_FILE)}.`)
}

async function start() {
  if (!existsSync(path.join(CHECKOUT_DIR, 'package.json'))) {
    throw new Error('Agent Office is not set up. Run: ghostforge worlds setup agent-office')
  }

  mkdirSync(RUNTIME_DIR, { recursive: true })
  const current = readState()
  if (current) {
    const existing = await requestSupervisor(current)
    if (existing) {
      console.log(existing.phase === 'running' ? 'Agent Office is already running.' : 'Agent Office is starting.')
      printStatus(existing)
      return existing.phase === 'running'
    }
    throw new Error(`Agent Office has stale runtime state at ${path.relative(ROOT, STATE_FILE)}. Inspect it before starting another instance.`)
  }

  const logFd = openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '_supervisor'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
    windowsHide: true,
  })
  closeSync(logFd)
  child.unref()

  const deadline = Date.now() + 5_000
  let state = null
  while (Date.now() < deadline) {
    state = readState()
    if (state) break
    await delay(100)
  }
  if (!state) throw new Error(`Agent Office supervisor did not initialize. See ${path.relative(ROOT, LOG_FILE)}.`)

  const status = await waitForStart(state)
  printStatus(status)
  return true
}

function printStatus(status) {
  const label = status.phase === 'running' ? 'running' : status.phase
  console.log(`Agent Office: ${label}`)
  console.log(`  Client: ${UI_URL}`)
  console.log(`  Colyseus API: ${SERVER_HEALTH_URL}`)
  console.log(`  Smoke check: ${SERVER_HEALTH_URL} -> ${status.serverReady ? 'HTTP 200' : 'not ready'}; ${UI_URL} -> ${status.uiReady ? 'HTTP 200' : 'not ready'}`)
  console.log(`  Log: ${path.relative(ROOT, LOG_FILE)}`)
}

async function status() {
  const state = readState()
  if (!state) {
    console.log('Agent Office is stopped.')
    return 0
  }
  const current = await requestSupervisor(state)
  if (!current) {
    console.log(`Agent Office supervisor is unreachable; runtime state is stale: ${path.relative(ROOT, STATE_FILE)}`)
    return 1
  }
  printStatus(current)
  return current.phase === 'failed' ? 1 : 0
}

async function stop() {
  const state = readState()
  if (!state) {
    console.log('Agent Office is already stopped.')
    return true
  }
  const current = await requestSupervisor(state, 'POST')
  if (!current) {
    throw new Error(`Agent Office supervisor is unreachable; inspect ${path.relative(ROOT, STATE_FILE)} before removing it.`)
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!existsSync(STATE_FILE)) {
      console.log('Agent Office stopped.')
      return true
    }
    await delay(250)
  }
  throw new Error(`Agent Office did not stop within ${STOP_TIMEOUT_MS / 1000}s. See ${path.relative(ROOT, LOG_FILE)}.`)
}

function setup() {
  const result = spawnSync(process.execPath, [SETUP_SCRIPT], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Agent Office setup exited with status ${result.status ?? 1}`)
}

async function checkUrl(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.status === 200
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function assertLoopbackPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', () => reject(new Error(`Port ${port} is already in use; Agent Office will not adopt another process.`)))
    probe.listen(port, '127.0.0.1', () => probe.close(resolve))
  })
}

function stopChild(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function supervisor() {
  mkdirSync(RUNTIME_DIR, { recursive: true })
  await assertLoopbackPortAvailable(SERVER_PORT)
  await assertLoopbackPortAvailable(UI_PORT)

  const controlToken = randomBytes(32).toString('hex')
  const children = []
  let stopping = false
  let failed = false
  const state = { pid: process.pid, controlPort: 0, controlToken, startedAt: new Date().toISOString() }
  const control = createServer(async (request, response) => {
    if (request.headers['x-agent-office-token'] !== controlToken) {
      writeJson(response, 403, { error: 'Forbidden' })
      return
    }
    if (request.url !== '/status') {
      writeJson(response, 404, { error: 'Not found' })
      return
    }
    if (request.method === 'POST') {
      writeJson(response, 202, { phase: 'stopping' })
      void shutdown()
      return
    }
    const [serverReady, uiReady] = await Promise.all([
      checkUrl(SERVER_HEALTH_URL),
      checkUrl(UI_URL),
    ])
    const phase = stopping ? 'stopping' : failed ? 'failed' : serverReady && uiReady ? 'running' : 'starting'
    writeJson(response, 200, {
      phase,
      serverReady,
      uiReady,
      clientUrl: UI_URL,
      serverUrl: SERVER_HEALTH_URL,
    })
  })

  let logFd
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    await new Promise(resolve => control.close(resolve))
    for (const child of children) stopChild(child)
    const finish = async () => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise(resolve => child.once('close', resolve))
        }
      }
      try { unlinkSync(STATE_FILE) } catch (error) {
        if (error?.code !== 'ENOENT') console.error(`Unable to remove runtime state: ${error.message}`)
      }
      if (logFd !== undefined) closeSync(logFd)
      process.exit(0)
    }
    void finish()
  }

  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })

  await new Promise((resolve, reject) => {
    control.once('error', reject)
    control.listen(0, '127.0.0.1', resolve)
  })
  state.controlPort = control.address().port
  writeFileSync(STATE_FILE, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  logFd = openSync(LOG_FILE, 'a')

  const childEnv = {
    ...process.env,
    AGENT_OFFICE_HOST: '127.0.0.1',
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    PORT: String(SERVER_PORT),
  }
  const commands = [
    ['run', 'start', '--workspace=@agent-office/server'],
    ['run', 'dev', '--workspace=@agent-office/ui'],
  ]
  for (const args of commands) {
    const child = spawn('npm', args, {
      cwd: CHECKOUT_DIR,
      env: childEnv,
      stdio: ['ignore', logFd, logFd],
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    children.push(child)
    child.once('error', error => {
      failed = true
      writeFileSync(LOG_FILE, `${new Date().toISOString()} Agent Office process error: ${error.message}\n`, { flag: 'a' })
    })
    child.once('exit', () => {
      if (!stopping) failed = true
    })
  }

  await new Promise(resolve => control.once('close', resolve))
}

function printHelp() {
  console.log([
    'GhostForge managed worlds',
    '',
    'Usage: ghostforge worlds <setup|start|stop|status> agent-office',
    '',
    'Examples:',
    '  ghostforge worlds setup agent-office',
    '  ghostforge worlds start agent-office',
    '  ghostforge worlds status agent-office',
    '  ghostforge worlds stop agent-office',
  ].join('\n'))
}

export async function main(args = process.argv.slice(2)) {
  const [action, world] = args
  if (action === '_supervisor') {
    await supervisor()
    return 0
  }
  if (!action || action === '--help' || action === '-h' || action === 'help') {
    printHelp()
    return 0
  }
  if (world !== 'agent-office') {
    console.error(`Unknown world: ${world ?? '(missing)'}. Supported world: agent-office.`)
    return 1
  }
  try {
    if (action === 'setup') {
      setup()
      return 0
    }
    if (action === 'start') return await start() ? 0 : 1
    if (action === 'status') return await status()
    if (action === 'stop') return await stop() ? 0 : 1
    console.error(`Unknown worlds action: ${action}`)
    return 1
  } catch (error) {
    console.error(`Worlds: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
