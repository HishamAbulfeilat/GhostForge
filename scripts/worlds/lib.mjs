// Agent World process manager (ai-town, agent-office). Dependency-free.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as agentOffice from '../../apps/worlds/agent-office/configure.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '..', '..')
export const LOOPBACK_HOST = '127.0.0.1'
export const GUARD = path.join(HERE, 'loopback-guard.cjs')
export const ACTIONS = ['start', 'stop', 'status', 'setup']
// Env passed through to world processes. LLM access is local Ollama or the
// GhostForge model gateway only; values come from the caller's environment.
export const ENV_ALLOW = ['OLLAMA_HOST', 'OLLAMA_MODEL', 'OMNIROUTE_URL', 'OMNIROUTE_API_KEY', 'AGENT_OFFICE_MODEL_GATEWAY_API_KEY']

export const WORLDS = {
  'ai-town': {
    repo: 'https://github.com/a16z-infra/ai-town.git',
    commit: '8e05997f2409275669c8344b84a51692e83f3f33',
    install: ['npm', ['install']],
    services: [
      { name: 'frontend', port: 5173, health: '/', open: true, cmd: 'npm', args: ['run', 'dev:frontend', '--', '--host', LOOPBACK_HOST, '--port', '5173', '--strictPort'] },
    ],
    notes: 'AI Town also needs its Convex backend (docker compose self-host); see the upstream README.',
  },
  'agent-office': {
    repo: 'https://github.com/harishkotra/agent-office.git',
    commit: '58f11f9b31770c10bcf3d7a0618325d22bd0ee9e',
    // Patches the checkout for loopback binds, the UI on :5174 and an env-selected LLM.
    configure: agentOffice.configureCheckout,
    isConfigured: agentOffice.isConfigured,
    install: ['npm', ['install']],
    // Core first: the root workspace build otherwise compiles adapters before core.
    prepare: [
      ['npm', ['run', 'build', '--workspace=@agent-office/core']],
      ['npm', ['run', 'build']],
    ],
    services: [
      { name: 'server', port: agentOffice.SERVER_PORT, health: '/api/offices', cmd: 'npm', args: ['run', 'start', '--workspace=@agent-office/server'], env: { PORT: String(agentOffice.SERVER_PORT) } },
      { name: 'ui', port: agentOffice.UI_PORT, health: '/', open: true, cmd: 'npm', args: ['run', 'dev', '--workspace=@agent-office/ui', '--', '--host', LOOPBACK_HOST, '--port', String(agentOffice.UI_PORT), '--strictPort'] },
    ],
  },
}

export function parseArgs(argv) {
  const [action, ...rest] = argv
  if (!action || action === '-h' || action === '--help' || action === 'help') return { help: true }
  if (!ACTIONS.includes(action)) throw new Error(`unknown action "${action}" (expected ${ACTIONS.join('|')})`)
  const names = []
  let json = false
  for (const arg of rest) {
    if (arg === '--json') json = true
    else if (arg.startsWith('-')) throw new Error(`unknown option "${arg}"`)
    else names.push(arg)
  }
  if (names.includes('all') && names.length > 1) throw new Error('"all" cannot be combined with world names')
  const worlds = !names.length || names.includes('all') ? Object.keys(WORLDS) : names
  for (const name of worlds) {
    if (!WORLDS[name]) throw new Error(`unknown world "${name}" (expected ${Object.keys(WORLDS).join('|')} or all)`)
  }
  return { action, worlds: [...new Set(worlds)], json }
}

export function isLoopbackHost(host) {
  if (typeof host !== 'string') return false
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1') return true
  const parts = h.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

export function assertLoopbackUrl(value) {
  const url = new URL(value)
  if (!isLoopbackHost(url.hostname)) throw new Error(`refusing non-loopback address: ${url.hostname}`)
  return url
}

export function stateRoot(root = ROOT) {
  const base = process.env.GF_AGENT_STATE || path.join(root, '.agent-sync', 'state')
  const dir = path.join(base, 'worlds')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const pidFile = (dir, world, service) => path.join(dir, `${world}-${service}.pid`)

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}

export function readPid(file) {
  try {
    const pid = Number(JSON.parse(fs.readFileSync(file, 'utf8')).pid)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch { return null }
}

export function writePid(file, pid, port) {
  fs.writeFileSync(file, JSON.stringify({ pid, host: LOOPBACK_HOST, port, startedAt: new Date().toISOString() }))
}

// Returns the live pid for a service, removing stale pid files.
export function livePid(file) {
  const pid = readPid(file)
  if (pid && isAlive(pid)) return pid
  fs.rmSync(file, { force: true })
  return null
}

export function probePort(port, { host = LOOPBACK_HOST, timeoutMs = 1000 } = {}) {
  return new Promise(resolve => {
    if (!isLoopbackHost(host)) return resolve(false)
    const socket = net.connect({ host, port })
    const done = ok => { socket.destroy(); resolve(ok) }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

// Smoke check: GET http://127.0.0.1:<port><path>; returns the HTTP status or null.
export async function probeHttp(port, pathname = '/', { host = LOOPBACK_HOST, timeoutMs = 1000 } = {}) {
  if (!isLoopbackHost(host)) return null
  try {
    const res = await fetch(`http://${host}:${port}${pathname}`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    await res.body?.cancel()
    return res.status
  } catch { return null }
}

export function worldDir(name, root = ROOT) {
  return path.join(root, 'apps', 'worlds', name, 'checkout')
}

function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
    return
  }
  try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
}

export function worldEnv(base = process.env) {
  const env = { ...base, HOST: LOOPBACK_HOST }
  env.NODE_OPTIONS = `${base.NODE_OPTIONS || ''} --require ${JSON.stringify(GUARD)}`.trim()
  for (const key of Object.keys(env)) {
    if (key.endsWith('_API_KEY') && !ENV_ALLOW.includes(key)) delete env[key]
  }
  env.OLLAMA_HOST = base.OLLAMA_HOST || `http://${LOOPBACK_HOST}:11434`
  return env
}

export function startWorld(name, { root = ROOT, log = console.log } = {}) {
  const dir = worldDir(name, root)
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw new Error(`${name} is not set up; run: ghostforge worlds setup ${name}`)
  }
  if (WORLDS[name].isConfigured && !WORLDS[name].isConfigured(dir)) {
    throw new Error(`${name} checkout is not configured for GhostForge (loopback/LLM); run: ghostforge worlds setup ${name}`)
  }
  const state = stateRoot(root)
  const env = worldEnv()
  const started = []
  for (const svc of WORLDS[name].services) {
    const file = pidFile(state, name, svc.name)
    const existing = livePid(file)
    if (existing) { log(`${name}/${svc.name} already running (pid ${existing})`); continue }
    const child = spawn(svc.cmd, svc.args, {
      cwd: dir,
      env: { ...env, ...svc.env },
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
      windowsHide: true,
    })
    child.unref()
    writePid(file, child.pid, svc.port)
    started.push(`${name}/${svc.name} pid ${child.pid} -> http://${LOOPBACK_HOST}:${svc.port}`)
  }
  started.forEach(line => log(line))
  return started
}

export function stopWorld(name, { root = ROOT, log = console.log } = {}) {
  const state = stateRoot(root)
  let stopped = 0
  for (const svc of WORLDS[name].services) {
    const file = pidFile(state, name, svc.name)
    const pid = livePid(file)
    if (pid) { killTree(pid); stopped++; log(`${name}/${svc.name} stopped (pid ${pid})`) }
    fs.rmSync(file, { force: true })
  }
  if (!stopped) log(`${name} is not running`)
  return stopped
}

export async function statusWorld(name, { root = ROOT, timeoutMs = 1000 } = {}) {
  const state = stateRoot(root)
  const services = []
  for (const svc of WORLDS[name].services) {
    const pid = livePid(pidFile(state, name, svc.name))
    const listening = await probePort(svc.port, { timeoutMs })
    const httpStatus = listening && svc.health ? await probeHttp(svc.port, svc.health, { timeoutMs }) : null
    const status = pid && listening ? 'running' : pid ? 'starting' : listening ? 'port-in-use' : 'stopped'
    services.push({ service: svc.name, host: LOOPBACK_HOST, port: svc.port, pid, listening, httpStatus, state: status })
  }
  // running = every service is ours, listening, and its smoke URL answers HTTP 200.
  const answering = WORLDS[name].services.every((svc, i) => services[i].state === 'running' && (!svc.health || services[i].httpStatus === 200))
  const open = WORLDS[name].services.find(svc => svc.open)
  return {
    world: name,
    installed: fs.existsSync(path.join(worldDir(name, root), 'package.json')),
    pinnedCommit: WORLDS[name].commit,
    status: answering ? 'running' : services.some(s => s.pid) ? 'starting' : 'stopped',
    url: open ? `http://${LOOPBACK_HOST}:${open.port}/` : null,
    services,
  }
}

function run(cmd, args, cwd, log) {
  log(`$ ${cmd} ${args.join(' ')}`)
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' })
  if (res.status !== 0) throw new Error(`${cmd} ${args[0]} failed (exit ${res.status})`)
}

export function setupWorld(name, { root = ROOT, log = console.log } = {}) {
  const world = WORLDS[name]
  const dir = worldDir(name, root)
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true })
    run('git', ['init', '-q'], dir, log)
    run('git', ['remote', 'add', 'origin', world.repo], dir, log)
  }
  run('git', ['fetch', '--depth', '1', 'origin', world.commit], dir, log)
  run('git', ['checkout', '-q', '--detach', world.commit], dir, log)
  if (world.configure) {
    log(`configuring ${name} checkout (127.0.0.1 binds, LLM from env)`)
    world.configure(dir)
  }
  run(world.install[0], world.install[1], dir, log)
  for (const [cmd, args] of world.prepare || []) run(cmd, args, dir, log)
  log(`${name} ready at ${path.relative(root, dir)} (commit ${world.commit.slice(0, 12)}). Start with: ghostforge worlds start ${name}`)
  if (world.notes) log(world.notes)
}
