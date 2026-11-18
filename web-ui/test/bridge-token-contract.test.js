// One bridge-token resolver for every :8765 / :8766 caller, in the same order
// the Python services check it: MARKL_BRIDGE_TOKEN, then
// ~/.ghostforge/bridge/token. The contract test starts the real bridge with
// MARKL_BRIDGE_TOKEN set and a stale token file, and calls a proxied route.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const Module = require('node:module')
const { spawn, spawnSync } = require('node:child_process')
const ts = require('typescript')

const WEB_UI = path.resolve(__dirname, '..')
const BRIDGE_DIR = path.resolve(WEB_UI, '..', 'mark-l-bridge')

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
const bridgeUrl = loadTs(path.join(WEB_UI, 'lib', 'bridge-url.ts'))
const voice = loadTs(path.join(WEB_UI, 'lib', 'voice.ts'), { '@/lib/bridge-token': bridgeToken })

/** Point os.homedir() at a temp HOME holding the given token file content. */
function withHome(fileToken, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-token-'))
  if (fileToken !== null) {
    fs.mkdirSync(path.join(home, '.ghostforge', 'bridge'), { recursive: true })
    fs.writeFileSync(path.join(home, '.ghostforge', 'bridge', 'token'), `${fileToken}\n`)
  }
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  process.env.HOME = home
  process.env.USERPROFILE = home
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    fs.rmSync(home, { recursive: true, force: true })
  }
  let result
  try {
    result = fn(home)
  } catch (err) {
    restore()
    throw err
  }
  if (result && typeof result.then === 'function') return result.finally(restore)
  restore()
  return result
}

test('getMarkLBridgeToken: env first, then the token file', () => {
  withHome('file-token', () => {
    assert.equal(bridgeToken.getMarkLBridgeToken({ MARKL_BRIDGE_TOKEN: ' env-token ' }), 'env-token')
    assert.equal(bridgeToken.getMarkLBridgeToken({}), 'file-token')
    assert.equal(bridgeToken.getMarkLBridgeToken({ MARKL_BRIDGE_TOKEN: '   ' }), 'file-token')
  })
  withHome(null, () => {
    assert.equal(bridgeToken.getMarkLBridgeToken({}), '')
  })
})

test('voice token: MARKL_BRIDGE_TOKEN, then GHOSTFORGE_VOICE_TOKEN, then the file', () => {
  withHome('file-token', () => {
    assert.equal(voice.voiceToken({}), 'file-token')
    assert.equal(voice.voiceToken({ GHOSTFORGE_VOICE_TOKEN: 'voice' }), 'voice')
    assert.equal(voice.voiceToken({ GHOSTFORGE_VOICE_TOKEN: 'voice', MARKL_BRIDGE_TOKEN: 'bridge' }), 'bridge')
  })
})

test('every :8765 caller uses getMarkLBridgeToken, not the WS-bridge token', () => {
  const callers = [
    'app/api/device-controls/route.ts',
    'app/api/mark-liv-tools/route.ts',
    'app/api/workflows/route.ts',
    'lib/voice.ts',
    'lib/mark-liv-bridge.ts',
    'lib/openjarvis.ts',
  ]
  for (const rel of callers) {
    const src = fs.readFileSync(path.join(WEB_UI, rel), 'utf8')
    assert.match(src, /getMarkLBridgeToken\(/, rel)
    assert.doesNotMatch(src, /getLiveBridgeToken|MARKL_BRIDGE_TOKEN\)|readFileSync\(TOKEN_FILE/, rel)
  }
  const jarvis = fs.readFileSync(path.join(WEB_UI, 'app/api/jarvis/route.ts'), 'utf8')
  const ocr = jarvis.slice(jarvis.indexOf('async function ocrImageBuffer'), jarvis.indexOf('async function openUrl'))
  assert.match(ocr, /'X-Bridge-Token': getMarkLBridgeToken\(\)/)
})

function pythonWithBridgeDeps() {
  const python = process.env.PYTHON || 'python3'
  const probe = spawnSync(python, ['-c', 'import fastapi, uvicorn, multipart'], { encoding: 'utf8' })
  return probe.status === 0 ? python : null
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function waitForBridge(base, token, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`bridge exited with ${child.exitCode}`)
    try {
      const res = await fetch(`${base}/api/mark-l/health`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.status < 500) return
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('bridge did not start')
}

const python = pythonWithBridgeDeps()

test('contract: with MARKL_BRIDGE_TOKEN set, a proxied route reaches the real bridge (no 401)', {
  skip: python ? false : 'python3 with fastapi/uvicorn is not available',
  timeout: 60_000,
}, async () => {
  const ENV_TOKEN = 'contract-env-token'
  await withHome('stale-file-token', async (home) => {
    const port = await freePort()
    const base = `http://127.0.0.1:${port}`
    const child = spawn(python, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: BRIDGE_DIR,
      env: { ...process.env, HOME: home, USERPROFILE: home, MARKL_BRIDGE_TOKEN: ENV_TOKEN, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: 'ignore',
    })
    const savedEnv = { MARKL_BRIDGE_TOKEN: process.env.MARKL_BRIDGE_TOKEN, MARKL_BRIDGE_URL: process.env.MARKL_BRIDGE_URL }
    try {
      await waitForBridge(base, ENV_TOKEN, child)
      // The scenario from the review: the file token is stale once the env token is set.
      const stale = await fetch(`${base}/api/mark-l/health`, { headers: { Authorization: 'Bearer stale-file-token' } })
      assert.equal(stale.status, 401)

      process.env.MARKL_BRIDGE_TOKEN = ENV_TOKEN
      process.env.MARKL_BRIDGE_URL = base
      const json = (body, init) => ({ status: init?.status ?? 200, body })
      const route = loadTs(path.join(WEB_UI, 'app', 'api', 'mark-liv-tools', 'route.ts'), {
        'next/server': { NextResponse: { json }, NextRequest: class {} },
        '@/lib/auth': { isAuthorizedRequest: () => true },
        '@/lib/access': { requirePermission: async () => ({ ok: true }) },
        '@/lib/mark-liv-bridge': { ensureMarkLivBridge: async () => true },
        '@/lib/bridge-token': bridgeToken,
        '@/lib/bridge-url': bridgeUrl,
        '@/lib/mark-liv-tools-request': { parseMarkLivToolsRequest: () => ({ ok: false, error: 'unused' }) },
      })
      const res = await route.GET({})
      assert.equal(res.status, 200)
      assert.equal(res.body.online, true)
      assert.equal(res.body.error, undefined, `bridge rejected the call: ${res.body.error}`)
      assert.ok(Array.isArray(res.body.tools))
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      child.kill('SIGTERM')
      await new Promise(r => (child.exitCode !== null ? r() : child.once('exit', r)))
    }
  })
})
