// Hosted ("friends") mode — GHOSTFORGE_MODE=hosted.
//
// Locks down what the hosted version must never do: act on the host machine,
// use the owner's accounts or the server's own AI keys, or start without the
// secrets that keep it private. See lib/hosted.ts and docs/HOSTING.md.

const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Isolate ~/.ghostforge before any module computes paths from the home dir.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-hosted-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'
delete process.env.GHOSTFORGE_MODE

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) {
        try { return nextResolve(specifier + '.ts', context) } catch { return nextResolve(specifier + '.js', context) }
      }
      if (specifier === 'next/server') return nextResolve('next/server.js', context)
      throw err
    }
  },
})

const webRoot = path.resolve(__dirname, '..')
const hosted = require('../lib/hosted.ts')
const policy = require('../lib/hosted-policy.json')

const ENV_KEYS = {
  OPENROUTER_API_KEY: 'sk-or-owner-key',
  GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-owner-key',
  GROQ_API_KEY: 'gsk-owner-key',
  ANTHROPIC_API_KEY: 'sk-ant-owner-key',
  OMNIROUTE_API_KEY: 'omni-owner-key',
}

function withHosted(fn) {
  const before = process.env.GHOSTFORGE_MODE
  process.env.GHOSTFORGE_MODE = 'hosted'
  try {
    return fn()
  } finally {
    if (before === undefined) delete process.env.GHOSTFORGE_MODE
    else process.env.GHOSTFORGE_MODE = before
  }
}

async function withHostedAsync(fn) {
  const before = process.env.GHOSTFORGE_MODE
  process.env.GHOSTFORGE_MODE = 'hosted'
  try {
    return await fn()
  } finally {
    if (before === undefined) delete process.env.GHOSTFORGE_MODE
    else process.env.GHOSTFORGE_MODE = before
  }
}

test.after(() => {
  hooks.deregister()
  for (const k of Object.keys(ENV_KEYS)) delete process.env[k]
  fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// ── Policy ──────────────────────────────────────────────────────────────────

test('hosted mode is off unless GHOSTFORGE_MODE=hosted', () => {
  assert.equal(hosted.isHostedMode({}), false)
  assert.equal(hosted.isHostedMode({ GHOSTFORGE_MODE: 'local' }), false)
  assert.equal(hosted.isHostedMode({ GHOSTFORGE_MODE: ' Hosted ' }), true)
  assert.equal(hosted.isBlockedApi('/api/execute', 'POST', false), false)
  assert.equal(hosted.hostedGuard({ nextUrl: { pathname: '/api/execute' }, method: 'POST' }), null)
})

test('hosted mode blocks the routes that act on the host or the owner accounts', () => {
  const dangerous = [
    ['/api/execute', 'POST'],
    ['/api/files', 'GET'],
    ['/api/pty-token', 'GET'],
    ['/api/mac-control', 'POST'],
    ['/api/remote/desktop', 'POST'],
    ['/api/remote/pair/redeem', 'POST'],
    ['/api/bridge-start', 'POST'],
    ['/api/mark-liv-tools', 'POST'],
    ['/api/openjarvis', 'POST'],
    ['/api/device-controls', 'POST'],
    ['/api/jarvis/screen-capture', 'POST'],
    ['/api/models/install', 'POST'],
    ['/api/models/local', 'GET'],
    ['/api/agents/cli-sessions/chat', 'POST'],
    ['/api/worlds/ai-town', 'POST'],
    ['/api/copilot', 'POST'],
    ['/api/jobs/github', 'POST'],
    ['/api/webhook', 'POST'],
    ['/api/security-scan', 'POST'],
    ['/api/marketplace', 'POST'],
  ]
  for (const [p, m] of dangerous) assert.equal(hosted.isBlockedApi(p, m, true), true, `${m} ${p} must be blocked`)

  const allowed = [
    ['/api/auth', 'POST'],
    ['/api/auth/me', 'GET'],
    ['/api/chat', 'POST'],
    ['/api/jarvis', 'POST'],
    ['/api/models', 'GET'],
    ['/api/models/keys', 'POST'],
    ['/api/users', 'POST'],
    ['/api/jobs', 'POST'],
    ['/api/marketplace', 'GET'],
    ['/api/executeX', 'POST'], // segment boundary, not a string prefix
  ]
  for (const [p, m] of allowed) assert.equal(hosted.isBlockedApi(p, m, true), false, `${m} ${p} must stay available`)
})

test('hostedGuard answers 403 "Not available on the hosted version"', async () => {
  await withHostedAsync(async () => {
    const res = hosted.hostedGuard({ nextUrl: { pathname: '/api/execute' }, method: 'POST' })
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'Not available on the hosted version', hosted: true })
    assert.equal(hosted.hostedGuard({ nextUrl: { pathname: '/api/marketplace' }, method: 'GET' }), null)
    assert.equal(hosted.hostedGuard().status, 403, 'no request = the whole route is off')
  })
})

test('every handler of a blocked API route calls hostedGuard first', () => {
  const apiRoot = path.join(webRoot, 'app', 'api')
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : [])
  let checked = 0
  for (const file of walk(apiRoot)) {
    const url = '/' + path.relative(path.join(webRoot, 'app'), path.dirname(file)).split(path.sep).join('/')
    const rule = policy.blockedApi.find(r => url === r.prefix || url.startsWith(r.prefix + '/'))
    if (!rule) continue
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\((\w+)[^)]*\)[^{]*\{\n([^\n]*)\n([^\n]*)/g)) {
      const [, method, param, line1, line2] = m
      if (rule.methods && !rule.methods.includes(method)) continue
      assert.equal(line1.trim(), `const hostedBlock = hostedGuard(${param})`, `${url} ${method}: first statement must be the hosted guard`)
      assert.equal(line2.trim(), 'if (hostedBlock) return hostedBlock', `${url} ${method}`)
      checked++
    }
  }
  assert.ok(checked >= 60, `expected the guard on the blocked handlers, checked ${checked}`)
})

test('blocked pages are protected pages, so middleware can redirect them', () => {
  const mw = fs.readFileSync(path.join(webRoot, 'middleware.ts'), 'utf8')
  const prefixes = [...mw.match(/const PROTECTED_PREFIXES = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  for (const page of policy.blockedPages) assert.ok(prefixes.includes(page), `${page} must be in PROTECTED_PREFIXES`)
  assert.match(mw, /isBlockedPage\(pathname\)/)
})

test('JARVIS keeps only web-only tools when hosted', () => {
  for (const tool of ['terminal_command', 'mac_control', 'execute_code', 'read_file', 'email_send', 'send_imessage', 'mark_liv', 'take_screenshot', 'github_repos', 'open_url', 'install_model']) {
    assert.equal(hosted.isHostedJarvisToolAllowed(tool, true), false, tool)
    assert.equal(hosted.isHostedJarvisToolAllowed(tool, false), true, tool)
  }
  for (const tool of ['get_time', 'get_weather', 'web_search']) assert.equal(hosted.isHostedJarvisToolAllowed(tool, true), true, tool)
  const route = fs.readFileSync(path.join(webRoot, 'app', 'api', 'jarvis', 'route.ts'), 'utf8')
  assert.match(route, /async function executeTool\([^\n]*\n[^\n]*\n\s*if \(!isHostedJarvisToolAllowed\(tool\)\) return/, 'executeTool must check the hosted allow-list before anything else')
})

// ── Permissions ─────────────────────────────────────────────────────────────

test('hosted mode denies host permissions to everyone, admins included', () => {
  const { hasPermission } = require('../lib/auth.ts')
  const admin = { role: 'admin', permissions: ['*'] }
  const friend = { role: 'user', permissions: ['chat', 'terminal', 'file_read'] }
  assert.equal(hasPermission(admin, 'terminal'), true)
  withHosted(() => {
    for (const perm of ['terminal', 'mac_control', 'file_read', 'file_write', 'remote', 'email', 'github', 'native_desktop']) {
      assert.equal(hasPermission(admin, perm), false, `admin ${perm}`)
      assert.equal(hasPermission(friend, perm), false, `friend ${perm}`)
    }
    assert.equal(hasPermission(admin, 'chat'), true)
    assert.equal(hasPermission(friend, 'chat'), true)
  })
})

// ── AI keys ─────────────────────────────────────────────────────────────────

test('hosted mode never uses AI keys from the server environment', () => {
  Object.assign(process.env, ENV_KEYS)
  const providers = require('../lib/providers.ts')
  assert.equal(providers.getProviderKey('openrouter'), ENV_KEYS.OPENROUTER_API_KEY, 'local mode still reads .env')
  withHosted(() => {
    for (const id of ['openrouter', 'google', 'groq', 'anthropic']) {
      assert.equal(providers.getProviderKey(id), undefined, `${id}: no user`)
      assert.equal(providers.runWithAIUser('u_friend1', () => providers.getProviderKey(id)), undefined, `${id}: user without a key`)
      assert.notEqual(providers.runWithAIUser('u_friend1', () => providers.keySource(id)), 'env', id)
    }
    assert.equal(providers.getOmniRouteKey(), undefined)
  })
})

test('hosted keys are per user, stored server-side and owner-only readable', () => {
  const providers = require('../lib/providers.ts')
  withHosted(() => {
    assert.throws(() => providers.saveProviderKey('groq', 'gsk-friend'), /Sign in/)
    providers.runWithAIUser('u_friend1', () => providers.saveProviderKey('groq', 'gsk-friend-one'))
    assert.equal(providers.runWithAIUser('u_friend1', () => providers.getProviderKey('groq')), 'gsk-friend-one')
    assert.equal(providers.runWithAIUser('u_friend1', () => providers.keySource('groq')), 'settings')
    assert.equal(providers.runWithAIUser('u_friend2', () => providers.getProviderKey('groq')), undefined, 'not shared with other friends')
    assert.equal(providers.getProviderKey('groq'), undefined, 'not used outside a user scope')
  })
  const file = path.join(fakeHome, '.ghostforge', 'hosted-ai', 'u_friend1.json')
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).keys.GROQ_API_KEY, 'gsk-friend-one')
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  // The owner's own key file is untouched
  assert.equal(fs.existsSync(path.join(fakeHome, '.ghostforge', 'provider-keys.json')), false)
})

test('hosted custom models must use a public https URL', () => {
  const providers = require('../lib/providers.ts')
  withHosted(() => providers.runWithAIUser('u_friend1', () => {
    assert.throws(() => providers.saveCustomModel({ name: 'local', baseURL: 'http://localhost:11434/v1', model: 'llama3' }), /public https/)
    assert.throws(() => providers.saveCustomModel({ name: 'bridge', baseURL: 'https://127.0.0.1:8765', model: 'x' }), /public https/)
    const saved = providers.saveCustomModel({ name: 'Gateway', baseURL: 'https://api.example.com/v1', model: 'm', apiKey: 'k-1' })
    assert.equal(saved.hasKey, true)
    assert.equal('apiKey' in saved, false, 'keys are never returned')
    assert.deepEqual(providers.listCustomModels().map(m => m.name), ['Gateway'])
  }))
  withHosted(() => providers.runWithAIUser('u_friend2', () => assert.deepEqual(providers.listCustomModels(), [])))
})

test('hosted model chain: no env keys, no OmniRoute, no host-local models', async () => {
  Object.assign(process.env, ENV_KEYS)
  const { buildModelChain } = require('../lib/ai.ts')
  await withHostedAsync(async () => {
    const anon = await buildModelChain({ userId: 'u_nokeys', task: 'hosted-test-a' })
    assert.ok(anon.length > 0, 'keyless free models still answer')
    assert.deepEqual([...new Set(anon.map(e => e.provider))], ['pollinations'])

    const friend = await buildModelChain({ userId: 'u_friend1', task: 'hosted-test-b' })
    const used = new Set(friend.map(e => e.provider))
    assert.ok(used.has('groq'), "the friend's own key is used")
    for (const p of ['openrouter', 'google', 'anthropic', 'omniroute', 'ollama', 'llamacpp']) assert.ok(!used.has(p), `${p} must not be in a hosted chain`)
  })
})

// ── Fail-closed startup ─────────────────────────────────────────────────────

test('hosted mode requires AUTH_SECRET and ADMIN_PASSWORD', () => {
  assert.deepEqual(hosted.hostedConfigProblems({}), [], 'not hosted: nothing to check')
  const missing = hosted.hostedConfigProblems({ GHOSTFORGE_MODE: 'hosted' })
  assert.equal(missing.length, 2)
  assert.equal(hosted.hostedConfigProblems({ GHOSTFORGE_MODE: 'hosted', AUTH_SECRET: 'short', ADMIN_PASSWORD: 'longenough-123' }).length, 1)
  assert.deepEqual(hosted.hostedConfigProblems({ GHOSTFORGE_MODE: 'hosted', AUTH_SECRET: 'x'.repeat(64), ADMIN_PASSWORD: 'longenough-123' }), [])
  assert.throws(() => hosted.assertHostedConfig({ GHOSTFORGE_MODE: 'hosted' }), /will not start/)
})

test('hosted getAuthSecret has no dev fallback', () => {
  const { getAuthSecret } = require('../lib/auth-secret.ts')
  const before = process.env.AUTH_SECRET
  delete process.env.AUTH_SECRET
  try {
    withHosted(() => assert.throws(() => getAuthSecret(), /AUTH_SECRET/))
  } finally {
    if (before !== undefined) process.env.AUTH_SECRET = before
  }
})

test('server.js refuses to start in hosted mode without the secrets', () => {
  const env = { ...process.env, GHOSTFORGE_MODE: 'hosted', NODE_ENV: 'production', PORT: '0' }
  delete env.AUTH_SECRET
  delete env.ADMIN_PASSWORD
  const run = spawnSync(process.execPath, [path.join(webRoot, 'server.js')], { env, encoding: 'utf8', timeout: 60_000 })
  assert.equal(run.status, 1, run.stderr)
  assert.match(run.stderr, /Hosted mode will not start/)
  assert.match(run.stderr, /AUTH_SECRET/)
  assert.match(run.stderr, /ADMIN_PASSWORD/)
})

test('hosted startup drops server secrets from the environment, keeping its own', () => {
  const env = {
    GHOSTFORGE_MODE: 'hosted',
    AUTH_SECRET: 'a'.repeat(64),
    ADMIN_PASSWORD: 'friends-only-123',
    OPENROUTER_API_KEY: 'x',
    GOOGLE_GENERATIVE_AI_API_KEY: 'x',
    GITHUB_TOKEN: 'x',
    WS_BRIDGE_TOKEN: 'x',
    ACCESS_PIN: '1234',
    VAPID_PRIVATE_KEY: 'x',
    DISCORD_WEBHOOK_URL: 'x',
    PORT: '3001',
    NEXT_RUNTIME: 'nodejs',
  }
  const removed = hosted.scrubOwnerSecrets(env)
  assert.deepEqual(removed, ['ACCESS_PIN', 'DISCORD_WEBHOOK_URL', 'GITHUB_TOKEN', 'GOOGLE_GENERATIVE_AI_API_KEY', 'OPENROUTER_API_KEY', 'VAPID_PRIVATE_KEY', 'WS_BRIDGE_TOKEN'])
  assert.deepEqual(Object.keys(env).sort(), ['ADMIN_PASSWORD', 'AUTH_SECRET', 'GHOSTFORGE_MODE', 'NEXT_RUNTIME', 'PORT'])
  assert.deepEqual(hosted.scrubOwnerSecrets({ OPENROUTER_API_KEY: 'x' }), [], 'not hosted: untouched')
})

test('hosted admin comes only from ADMIN_PASSWORD, with no personal defaults', async () => {
  const users = require('../lib/users.ts')
  const savedPin = process.env.ACCESS_PIN
  process.env.ACCESS_PIN = '123456'
  delete process.env.ADMIN_PASSWORD
  delete process.env.ADMIN_USERNAME
  delete process.env.ADMIN_NAME
  try {
    await withHostedAsync(async () => {
      assert.equal(users.ownerUsername(), 'admin')
      assert.equal(users.defaultAdminName(), 'Admin')
      await assert.rejects(users.ensureUserStore(), /ADMIN_PASSWORD/, 'ACCESS_PIN alone must not create the admin')
      process.env.ADMIN_PASSWORD = 'friends-only-123'
      await users.ensureUserStore()
      const admin = await users.getUserByUsername('admin')
      assert.ok(admin)
      assert.equal(admin.name, 'Admin')
      assert.equal(users.verifyPassword('friends-only-123', admin.passwordHash), true)
      assert.equal(users.verifyPassword('123456', admin.passwordHash), false)
    })
  } finally {
    delete process.env.ADMIN_PASSWORD
    if (savedPin === undefined) delete process.env.ACCESS_PIN
    else process.env.ACCESS_PIN = savedPin
  }
})

test('hosted friends from GHOSTFORGE_FRIENDS can sign in; malformed entries are ignored', async () => {
  const users = require('../lib/users.ts')
  const run = spawnSync(process.execPath, [path.join(webRoot, 'scripts', 'hosted-user.mjs'), 'Alice', '--generate'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const entry = run.stdout.trim()
  const password = run.stderr.match(/Password for Alice: (\S+)/)[1]
  assert.match(entry, /^alice:[0-9a-f]{32}:[0-9a-f]{128}$/)
  assert.deepEqual(users.parseHostedFriends(`${entry}, bad entry,eve:zz:zz,-x:${entry.split(':').slice(1).join(':')}`).map(f => f.username), ['alice'])

  process.env.GHOSTFORGE_FRIENDS = entry
  process.env.ADMIN_PASSWORD = 'friends-only-123'
  try {
    await withHostedAsync(async () => {
      await users.ensureUserStore()
      const alice = await users.getUserByUsername('alice')
      assert.ok(alice, 'friend account seeded')
      assert.equal(alice.role, 'user')
      assert.equal(users.verifyPassword(password, alice.passwordHash), true)
      assert.ok(!alice.permissions.includes('*'))
    })
  } finally {
    delete process.env.GHOSTFORGE_FRIENDS
    delete process.env.ADMIN_PASSWORD
  }
})

// ── Outbound URLs ───────────────────────────────────────────────────────────

test('isPublicHttpsUrl refuses plain http and host-local addresses', () => {
  for (const url of ['https://openrouter.ai/api/v1', 'https://api.groq.com/openai/v1', 'https://8.8.8.8/v1']) {
    assert.equal(hosted.isPublicHttpsUrl(url), true, url)
  }
  for (const url of [
    'http://api.example.com/v1', 'https://localhost:1234', 'https://foo.localhost', 'https://127.0.0.1:8765',
    'https://10.0.0.2', 'https://192.168.1.10', 'https://172.20.0.1', 'https://169.254.169.254/latest',
    'https://100.100.100.100', 'https://[::1]:11434', 'https://[fd00::1]', 'https://2130706433', 'https://box.local',
    'not a url', 'file:///etc/passwd',
  ]) {
    assert.equal(hosted.isPublicHttpsUrl(url), false, url)
  }
})
