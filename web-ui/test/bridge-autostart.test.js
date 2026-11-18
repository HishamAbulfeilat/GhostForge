// Web auto-start of mark-l-bridge: use the venv that start.sh builds, keep the
// child's output in a log, and stop waiting as soon as the child exits.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const Module = require('node:module')
const ts = require('typescript')

const WEB_UI = path.resolve(__dirname, '..')

function loadTs(filePath, dependencies = {}) {
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(dependencies, request)) return dependencies[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const compiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    const mod = new Module(filePath, module)
    mod.filename = filePath
    mod.paths = Module._nodeModulePaths(path.dirname(filePath))
    mod._compile(compiled, filePath)
    return mod.exports
  } finally {
    Module._load = originalLoad
  }
}

const bridgeToken = loadTs(path.join(WEB_UI, 'lib', 'bridge-token.ts'))
const loadBridge = () => loadTs(path.join(WEB_UI, 'lib', 'mark-liv-bridge.ts'), { './bridge-token': bridgeToken })

test('bridgePython prefers the bridge venv, then PYTHON, then python3', () => {
  const { bridgePython } = loadBridge()
  const dir = path.join('/repo', 'mark-l-bridge')
  const posixVenv = path.join(dir, '.venv', 'bin', 'python')
  const winVenv = path.join(dir, '.venv', 'Scripts', 'python.exe')
  assert.equal(bridgePython(dir, 'darwin', { PYTHON: '/usr/bin/python3.12' }, p => p === posixVenv), posixVenv)
  assert.equal(bridgePython(dir, 'win32', {}, p => p === winVenv), winVenv)
  assert.equal(bridgePython(dir, 'linux', { PYTHON: '/opt/py' }, () => false), '/opt/py')
  assert.equal(bridgePython(dir, 'linux', {}, () => false), 'python3')
  assert.equal(bridgePython(dir, 'win32', {}, () => false), 'python')
})

function closedPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

test('auto-start runs the venv python, logs its stderr and fails fast when it exits', {
  skip: process.platform === 'win32' ? 'POSIX shell script fixture' : false,
  timeout: 30_000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-autostart-'))
  const home = path.join(root, 'home')
  const bridgeDir = path.join(root, 'mark-l-bridge')
  fs.mkdirSync(path.join(bridgeDir, '.venv', 'bin'), { recursive: true })
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(bridgeDir, 'server.py'), '# fixture\n')
  const venvPython = path.join(bridgeDir, '.venv', 'bin', 'python')
  fs.writeFileSync(venvPython, '#!/bin/sh\necho "venv-python-ran $1" >&2\necho "ModuleNotFoundError: No module named fastapi" >&2\nexit 1\n')
  fs.chmodSync(venvPython, 0o755)

  const saved = {}
  for (const k of ['HOME', 'GHOSTFORGE_ROOT', 'MARKL_BRIDGE_URL', 'PYTHON']) saved[k] = process.env[k]
  process.env.HOME = home
  process.env.GHOSTFORGE_ROOT = root
  process.env.MARKL_BRIDGE_URL = `http://127.0.0.1:${await closedPort()}`
  process.env.PYTHON = '/nonexistent/system-python'
  try {
    const bridge = loadBridge()
    const started = Date.now()
    assert.equal(await bridge.ensureMarkLivBridge(), false)
    assert.ok(Date.now() - started < 8_000, `waited ${Date.now() - started} ms for a dead child`)
    assert.match(bridge.lastBridgeStartError(), /exited early \(code 1\)/)
    const log = fs.readFileSync(path.join(home, '.ghostforge', 'bridge', 'bridge.log'), 'utf8')
    assert.match(log, new RegExp(`venv-python-ran ${path.join(bridgeDir, 'server.py').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(log, /No module named fastapi/)

    // Within the cooldown a second request does not respawn (and does not wait 20 s).
    const again = Date.now()
    assert.equal(await bridge.ensureMarkLivBridge(), false)
    assert.ok(Date.now() - again < 3_000)
    assert.equal(fs.readFileSync(path.join(home, '.ghostforge', 'bridge', 'bridge.log'), 'utf8'), log)
    assert.match(await bridge.runMarkLiv('x', {}), /could not be started \(exited early/)
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
})
