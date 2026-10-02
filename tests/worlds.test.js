'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const lib = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'worlds', 'lib.mjs')).href)

test('parseArgs accepts actions, world names, all and --json', async () => {
  const { parseArgs } = await lib()
  assert.deepEqual(parseArgs(['start', 'ai-town']), { action: 'start', worlds: ['ai-town'], json: false })
  assert.deepEqual(parseArgs(['status', '--json']).worlds, ['ai-town', 'agent-office'])
  assert.deepEqual(parseArgs(['stop', 'all']).worlds, ['ai-town', 'agent-office'])
  assert.deepEqual(parseArgs(['status', 'agent-office', 'agent-office']).worlds, ['agent-office'])
  assert.equal(parseArgs(['status', '--json']).json, true)
  assert.equal(parseArgs([]).help, true)
})

test('parseArgs rejects unknown actions, worlds and options', async () => {
  const { parseArgs } = await lib()
  assert.throws(() => parseArgs(['restart']), /unknown action/)
  assert.throws(() => parseArgs(['start', 'nope']), /unknown world/)
  assert.throws(() => parseArgs(['start', '--force']), /unknown option/)
  assert.throws(() => parseArgs(['start', 'all', 'ai-town']), /cannot be combined/)
})

test('isLoopbackHost only allows loopback addresses', async () => {
  const { isLoopbackHost, assertLoopbackUrl, probePort } = await lib()
  for (const ok of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) assert.equal(isLoopbackHost(ok), true, ok)
  for (const bad of ['0.0.0.0', '192.168.1.5', '10.0.0.1', '127.0.0.256', '127.0.0.1.evil.com', 'example.com', '', undefined]) {
    assert.equal(isLoopbackHost(bad), false, String(bad))
  }
  assert.doesNotThrow(() => assertLoopbackUrl('http://127.0.0.1:5173'))
  assert.throws(() => assertLoopbackUrl('http://192.168.1.5:5173'), /non-loopback/)
  assert.equal(await probePort(5173, { host: '192.168.1.5' }), false)
})

test('pid lifecycle: write, read, stale cleanup', async () => {
  const { writePid, readPid, livePid, isAlive } = await lib()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-worlds-'))
  const file = path.join(dir, 'ai-town-frontend.pid')
  assert.equal(readPid(file), null)
  writePid(file, process.pid, 5173)
  assert.equal(readPid(file), process.pid)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).host, '127.0.0.1')
  assert.equal(livePid(file), process.pid)

  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
  const deadPid = Number(dead.stdout)
  assert.equal(isAlive(deadPid), false)
  writePid(file, deadPid, 5173)
  assert.equal(livePid(file), null)
  assert.equal(fs.existsSync(file), false)
  fs.writeFileSync(file, 'not json')
  assert.equal(livePid(file), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('statusWorld probes the port with a bounded timeout and reports state', async () => {
  const { statusWorld, writePid, stateRoot, pidFile, WORLDS } = await lib()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-worlds-root-'))
  const previous = process.env.GF_AGENT_STATE
  process.env.GF_AGENT_STATE = path.join(root, 'state')
  try {
    const port = WORLDS['ai-town'].services[0].port
    const server = net.createServer(socket => socket.end())
    const bound = await new Promise(resolve => {
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => resolve(true))
    })
    if (bound) await new Promise(resolve => server.close(resolve))
    const before = await statusWorld('ai-town', { root, timeoutMs: 200 })
    assert.equal(before.installed, false)
    if (bound) assert.equal(before.services[0].state, 'stopped')

    if (bound) {
      const live = net.createServer(socket => socket.end())
      await new Promise(resolve => live.listen(port, '127.0.0.1', resolve))
      try {
        assert.equal((await statusWorld('ai-town', { root, timeoutMs: 200 })).services[0].state, 'port-in-use')
        writePid(pidFile(stateRoot(root), 'ai-town', 'frontend'), process.pid, port)
        assert.equal((await statusWorld('ai-town', { root, timeoutMs: 200 })).services[0].state, 'running')
      } finally { live.close() }
    }
  } finally {
    if (previous === undefined) delete process.env.GF_AGENT_STATE
    else process.env.GF_AGENT_STATE = previous
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('worldEnv forces loopback, preloads the guard and strips foreign keys', async () => {
  const { worldEnv, GUARD } = await lib()
  const env = worldEnv({ OPENAI_API_KEY: 'x', OMNIROUTE_API_KEY: 'gw', PATH: 'p', NODE_OPTIONS: '--no-warnings' })
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.OMNIROUTE_API_KEY, 'gw')
  assert.equal(env.HOST, '127.0.0.1')
  assert.equal(env.OLLAMA_HOST, 'http://127.0.0.1:11434')
  assert.match(env.NODE_OPTIONS, /^--no-warnings --require /)
  assert.ok(env.NODE_OPTIONS.includes(JSON.stringify(GUARD)))
})

test('loopback guard rebinds wildcard listens to 127.0.0.1 and refuses other hosts', () => {
  const guard = path.join(ROOT, 'scripts', 'worlds', 'loopback-guard.cjs')
  const script = `
    const net = require('node:net')
    const s = net.createServer().listen(0, () => {
      console.log(JSON.stringify({ address: s.address().address }))
      s.close()
      try { net.createServer().listen(0, '0.0.0.0') } catch (e) { console.log(JSON.stringify({ error: e.message })) }
    })`
  const res = spawnSync(process.execPath, ['--require', guard, '-e', script], { encoding: 'utf8' })
  const lines = res.stdout.trim().split('\n').map(l => JSON.parse(l))
  assert.equal(lines[0].address, '127.0.0.1')
  assert.match(lines[1].error, /non-loopback/)
})

test('cli prints help and rejects bad arguments without side effects', () => {
  const cli = path.join(ROOT, 'scripts', 'worlds', 'cli.mjs')
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /start\|stop\|status/)
  const bad = spawnSync(process.execPath, [cli, 'start', 'nope'], { encoding: 'utf8' })
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /unknown world/)
})

const configure = () => import(pathToFileURL(path.join(ROOT, 'apps', 'worlds', 'agent-office', 'configure.mjs')).href)

// Minimal copies of the upstream lines (58f11f9b) that the T-144 patches target.
const UPSTREAM = {
  'packages/server/src/index.ts': "colyseusServer.listen(PORT).then(() => {\n    console.log(`[Server] AgentOffice Engine listening on ws://localhost:${PORT}`);\n});\n",
  'packages/server/src/rooms/OfficeRoom.ts': "import { OllamaAdapter } from '@agent-office/adapters';\nimport { MemoryStore } from '../memory/MemoryStore';\n\nclass R {\n    private ollamaAdapter = new OllamaAdapter('http://localhost:11434');\n    a = { provider: 'ollama',\n                    model: 'llama3.2:latest', };\n    b = { provider: 'ollama',\n                    model: 'llama3.2:latest', };\n}\n",
  'packages/server/src/memory/MemoryStore.ts': "    constructor(ollamaUrl: string = 'http://localhost:11434') {\n",
  'packages/adapters/src/OpenAICompatibleAdapter.ts': "            headers: {\n                'Authorization': `Bearer ${this.apiKey}`,\n",
  'packages/ui/vite.config.ts': "    server: {\n        port: 5173,\n        proxy: {\n            '/api': 'http://localhost:3000',\n        }\n    },\n",
}

test('agent-office patches bind loopback, move the UI to 5174 and read the LLM from env', async () => {
  const { applyPatches, PATCHED_FILES, PATCH_MARKER, UI_PORT, SERVER_PORT } = await configure()
  assert.deepEqual([...PATCHED_FILES].sort(), Object.keys(UPSTREAM).sort())
  const out = applyPatches(UPSTREAM)
  assert.match(out['packages/server/src/index.ts'], /listen\(PORT, '127\.0\.0\.1'\)/)
  const room = out['packages/server/src/rooms/OfficeRoom.ts']
  assert.ok(room.includes(PATCH_MARKER))
  assert.doesNotMatch(room, /localhost|provider: 'ollama',|model: 'llama3\.2:latest',/)
  assert.match(room, /OMNIROUTE_URL/)
  assert.match(room, /OLLAMA_HOST/)
  assert.doesNotMatch(room, /OPENAI_API_KEY|OPENROUTER_API_KEY/)
  assert.equal((room.match(/provider: modelProvider,/g) || []).length, 2)
  assert.doesNotMatch(out['packages/server/src/memory/MemoryStore.ts'], /localhost/)
  assert.match(out['packages/adapters/src/OpenAICompatibleAdapter.ts'], /this\.apiKey \? \{ 'Authorization'/)
  const vite = out['packages/ui/vite.config.ts']
  assert.match(vite, /host: '127\.0\.0\.1'/)
  assert.ok(vite.includes(`port: ${UI_PORT},`) && vite.includes('strictPort: true,'))
  assert.ok(vite.includes(`'/api': 'http://127.0.0.1:${SERVER_PORT}'`))
  // Drifted upstream text fails loudly instead of running an unpatched app.
  assert.throws(() => applyPatches({ ...UPSTREAM, 'packages/server/src/index.ts': 'app.listen(3000)' }), /upstream text not found/)
})

test('agent-office world: pinned commit, configure hook, core-first build, no port clash with ai-town', async () => {
  const { WORLDS, ENV_ALLOW } = await lib()
  const office = WORLDS['agent-office']
  assert.equal(office.repo, 'https://github.com/harishkotra/agent-office.git')
  assert.match(office.commit, /^58f11f9b[0-9a-f]{32}$/)
  assert.equal(typeof office.configure, 'function')
  assert.deepEqual(office.prepare[0][1], ['run', 'build', '--workspace=@agent-office/core'])
  const ports = office.services.map(s => s.port)
  assert.deepEqual(ports, [3000, 5174])
  for (const port of WORLDS['ai-town'].services.map(s => s.port)) assert.ok(!ports.includes(port))
  const ui = office.services.find(s => s.open)
  assert.deepEqual(ui.args.slice(-5), ['--host', '127.0.0.1', '--port', '5174', '--strictPort'])
  assert.equal(office.services.find(s => s.name === 'server').health, '/api/offices')
  assert.ok(ENV_ALLOW.includes('AGENT_OFFICE_MODEL_GATEWAY_API_KEY'))
})

test('agent-office start refuses an unconfigured checkout', async () => {
  const { startWorld } = await lib()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-worlds-ao-'))
  try {
    const dir = path.join(root, 'apps', 'worlds', 'agent-office', 'checkout')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), '{}')
    assert.throws(() => startWorld('agent-office', { root, log: () => {} }), /not configured/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('statusWorld is running only when every smoke URL answers HTTP 200', async () => {
  const { statusWorld, probeHttp, writePid, stateRoot, pidFile, WORLDS } = await lib()
  const http = require('node:http')
  assert.equal(await probeHttp(80, '/', { host: '192.168.1.5' }), null)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-worlds-http-'))
  const previous = process.env.GF_AGENT_STATE
  process.env.GF_AGENT_STATE = path.join(root, 'state')
  const servers = []
  try {
    const listen = (port, code) => new Promise(resolve => {
      const s = http.createServer((req, res) => { res.statusCode = code; res.end('ok') })
      s.once('error', () => resolve(false))
      s.listen(port, '127.0.0.1', () => { servers.push(s); resolve(true) })
    })
    const [server, ui] = WORLDS['agent-office'].services
    if (!(await listen(server.port, 200)) || !(await listen(ui.port, 500))) return // ports busy on this machine
    for (const svc of [server, ui]) writePid(pidFile(stateRoot(root), 'agent-office', svc.name), process.pid, svc.port)
    let status = await statusWorld('agent-office', { root, timeoutMs: 500 })
    assert.equal(status.status, 'starting')
    assert.equal(status.services[0].httpStatus, 200)
    assert.equal(status.services[1].httpStatus, 500)
    assert.equal(status.url, 'http://127.0.0.1:5174/')
    await new Promise(resolve => servers.pop().close(resolve))
    await listen(ui.port, 200)
    status = await statusWorld('agent-office', { root, timeoutMs: 500 })
    assert.equal(status.status, 'running')
  } finally {
    await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))))
    if (previous === undefined) delete process.env.GF_AGENT_STATE
    else process.env.GF_AGENT_STATE = previous
    fs.rmSync(root, { recursive: true, force: true })
  }
})
