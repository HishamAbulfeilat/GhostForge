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
