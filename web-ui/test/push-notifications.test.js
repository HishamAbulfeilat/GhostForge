const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync, readFileSync, mkdirSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const ts = require('typescript')

const root = resolve(__dirname, '..')
const routeSource = readFileSync(join(root, 'app', 'api', 'push', 'route.ts'), 'utf8')

/**
 * Load lib/push.ts as CommonJS with `os.homedir()` pointed at a temp dir and
 * an optional stub for the `web-push` dependency.
 */
function loadPushLib(home, webPushStub) {
  const outDir = mkdtempSync(join(tmpdir(), 'gf-push-mod-'))
  const { outputText } = ts.transpileModule(readFileSync(join(root, 'lib', 'push.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const outFile = join(outDir, 'push.js')
  mkdirSync(outDir, { recursive: true })
  require('node:fs').writeFileSync(outFile, outputText, 'utf8')

  const originalLoad = Module._load
  const originalHomedir = require('node:os').homedir
  require('node:os').homedir = () => home
  Module._load = function (request, parent, isMain) {
    if (request === 'web-push') {
      if (!webPushStub) throw new Error('web-push is not installed')
      return webPushStub
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  let push
  try {
    delete require.cache[outFile]
    push = require(outFile)
  } catch (error) {
    Module._load = originalLoad
    require('node:os').homedir = originalHomedir
    throw error
  }
  // Both patches must stay installed for the whole test: lib/push.ts resolves
  // the store path at call time, not at import time.
  return {
    push,
    cleanup: () => {
      Module._load = originalLoad
      require('node:os').homedir = originalHomedir
      rmSync(outDir, { recursive: true, force: true })
    },
  }
}

function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'gf-push-'))
  mkdirSync(join(dir, '.ghostforge', 'users'), { recursive: true })
  return dir
}

const VALID_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
}

function setVapid(env) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

test('subscriptions persist per user to disk and reload', async (t) => {
  const home = tempHome()
  const { push, cleanup } = loadPushLib(home)
  t.after(() => { cleanup(); rmSync(home, { recursive: true, force: true }) })

  await push.saveSubscription('alice', VALID_SUB, 'test-agent')
  await push.saveSubscription('alice', { ...VALID_SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/def456' }, 'test-agent')

  const file = join(home, '.ghostforge', 'users', 'alice', 'push-subscriptions.json')
  assert.ok(existsSync(file), 'subscriptions must be written to the per-user store')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).subscriptions.length, 2)

  // a second user must not see alice's subscriptions
  assert.deepEqual(await push.listSubscriptions('bob'), [])

  // re-saving the same endpoint updates in place instead of duplicating
  await push.saveSubscription('alice', { ...VALID_SUB, keys: { p256dh: 'rotated', auth: 'auth-key' } })
  const after = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(after.subscriptions.length, 2)
  assert.equal(after.subscriptions.find(s => s.endpoint === VALID_SUB.endpoint).keys.p256dh, 'rotated')

  await push.removeSubscription('alice', VALID_SUB.endpoint)
  assert.equal((await push.listSubscriptions('alice')).length, 1)
  await push.removeSubscription('alice')
  assert.equal((await push.listSubscriptions('alice')).length, 0)
})

test('invalid subscriptions are rejected by the validator', (t) => {
  const home = tempHome()
  const { push, cleanup } = loadPushLib(home)
  t.after(() => { cleanup(); rmSync(home, { recursive: true, force: true }) })

  for (const bad of [null, undefined, 'nope', 42, {},
    { endpoint: 'http://insecure', keys: { p256dh: 'a', auth: 'b' } },
    { endpoint: 'https://x/1', keys: { auth: 'b' } },
    { endpoint: 'https://x/1', keys: { p256dh: 'a' } },
    { endpoint: 'https://x/1' }]) {
    assert.equal(push.isValidSubscription(bad), false, `${JSON.stringify(bad)} must be invalid`)
  }
  assert.equal(push.isValidSubscription(VALID_SUB), true)
})

test('configured follows the VAPID key pair — both keys required', (t) => {
  const home = tempHome()
  const { push, cleanup } = loadPushLib(home)
  const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY }
  t.after(() => { cleanup(); rmSync(home, { recursive: true, force: true }); setVapid({ VAPID_PUBLIC_KEY: saved.pub, VAPID_PRIVATE_KEY: saved.priv }) })

  setVapid({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined })
  assert.equal(push.isPushConfigured(), false)

  process.env.VAPID_PUBLIC_KEY = 'public-key'
  assert.equal(push.isPushConfigured(), false, 'a public key alone is not configured')

  process.env.VAPID_PRIVATE_KEY = 'private-key'
  assert.equal(push.isPushConfigured(), true)
})

test('sendToUser reports sent:false when VAPID keys are missing (honest not-configured)', async (t) => {
  const home = tempHome()
  const { push, cleanup } = loadPushLib(home)
  const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY }
  t.after(() => { cleanup(); rmSync(home, { recursive: true, force: true }); setVapid({ VAPID_PUBLIC_KEY: saved.pub, VAPID_PRIVATE_KEY: saved.priv }) })
  setVapid({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined })

  await push.saveSubscription('alice', VALID_SUB)
  const summary = await push.sendToUser('alice', { title: 't', body: 'b' })
  assert.equal(summary.sent, false)
  assert.equal(summary.delivered, 0)
  assert.deepEqual(summary.results, [])
  // the subscription survives a failed send — it is not silently dropped
  assert.equal((await push.listSubscriptions('alice')).length, 1)
})

test('sendToUser sends through web-push and prunes gone endpoints', async (t) => {
  const home = tempHome()
  const calls = []
  const stub = {
    setVapidDetails(subject, publicKey, privateKey) {
      calls.push({ type: 'vapid', subject, publicKey, privateKey })
    },
    async sendNotification(subscription, body) {
      calls.push({ type: 'send', subscription, body: JSON.parse(body) })
      if (subscription.endpoint.endsWith('/gone')) {
        const error = new Error('Gone')
        error.statusCode = 410
        throw error
      }
      return { statusCode: 201 }
    },
  }
  const { push, cleanup } = loadPushLib(home, stub)
  const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY }
  t.after(() => { cleanup(); rmSync(home, { recursive: true, force: true }); setVapid({ VAPID_PUBLIC_KEY: saved.pub, VAPID_PRIVATE_KEY: saved.priv }) })
  process.env.VAPID_PUBLIC_KEY = 'public-key'
  process.env.VAPID_PRIVATE_KEY = 'private-key'

  await push.saveSubscription('alice', VALID_SUB)
  await push.saveSubscription('alice', { ...VALID_SUB, endpoint: 'https://push.example/gone' })

  const summary = await push.sendToUser('alice', { title: 'GhostForge', body: 'hello' })
  assert.equal(summary.sent, true)
  assert.equal(summary.delivered, 1)
  assert.equal(summary.failed, 1)
  assert.equal(summary.removed, 1)
  assert.equal(calls[0].type, 'vapid')
  assert.equal(calls[0].publicKey, 'public-key')
  const send = calls.find(c => c.type === 'send' && c.subscription.endpoint === VALID_SUB.endpoint)
  assert.equal(send.body.title, 'GhostForge')
  assert.equal(send.body.body, 'hello')

  const remaining = await push.listSubscriptions('alice')
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].endpoint, VALID_SUB.endpoint)
})

test('sendToUser with no stored subscriptions sends nothing and reports sent:false', async (t) => {
  const home = tempHome()
  const stub = { setVapidDetails() {}, async sendNotification() { throw new Error('must not be called') } }
  const { push, cleanup } = loadPushLib(home, stub)
  const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY }
  t.after(() => { cleanup(); rmSync(home, { recursive: true, force: true }); setVapid({ VAPID_PUBLIC_KEY: saved.pub, VAPID_PRIVATE_KEY: saved.priv }) })
  process.env.VAPID_PUBLIC_KEY = 'public-key'
  process.env.VAPID_PRIVATE_KEY = 'private-key'

  const summary = await push.sendToUser('nobody', { title: 't', body: 'b' })
  assert.equal(summary.sent, false)
  assert.equal(summary.delivered, 0)
})

test('route stores, removes, sends, and 501s honestly without VAPID keys', () => {
  assert.match(routeSource, /if \(!configured\) \{[\s\S]*?status: 501/)
  assert.match(routeSource, /configured: false, sent: false/)
  // no longer the stub that acknowledged a subscription and stored nothing
  assert.doesNotMatch(routeSource, /preview: notification/)
  assert.match(routeSource, /saveSubscription\(/)
  assert.match(routeSource, /removeSubscription\(/)
  assert.match(routeSource, /sendToUser\(/)
  assert.match(routeSource, /isValidSubscription\(/)
  assert.match(routeSource, /getCurrentUser\(req\)/, 'subscriptions are scoped to the authenticated user')
})

test('panel can send a test notification and refuses to when unconfigured', () => {
  const panel = readFileSync(join(root, 'components', 'PushNotificationPanel.tsx'), 'utf8')
  assert.match(panel, /notification: \{ title: 'GhostForge', body: 'Test notification/)
  assert.match(panel, /Send a test notification/)
  assert.match(panel, /disabled=\{!config\.configured \|\| busy \|\| !subscribed\}/)
})

test('web-push is a declared runtime dependency', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.ok(pkg.dependencies['web-push'], 'web-push must be a runtime dependency of the push route')
})