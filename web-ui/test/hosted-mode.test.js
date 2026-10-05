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

test('hosted mode allows only the allowlisted API routes (fail closed)', () => {
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
    ['/api/jarvis/audit', 'GET'], // finding 3: server-wide audit log
    ['/api/jarvis/morning', 'GET'],
    ['/api/models/recommend', 'GET'], // finding 7: runs sysctl / ollama list
    ['/api/models/install', 'POST'],
    ['/api/models/local', 'GET'],
    ['/api/agents/cli-sessions/chat', 'POST'],
    ['/api/worlds/ai-town', 'POST'],
    ['/api/copilot', 'POST'],
    ['/api/jobs/github', 'POST'],
    ['/api/webhook', 'POST'],
    ['/api/security-scan', 'POST'],
    ['/api/marketplace', 'POST'],
    ['/api/a-route-added-next-year', 'GET'], // unknown routes are off until allowed
    ['/api/%65xecute', 'POST'],
    ['/api//execute', 'POST'],
    ['/api/chat/../execute', 'POST'],
    ['/API/execute', 'POST'],
    ['/api/%E0%A4%A', 'GET'], // undecodable
  ]
  for (const [p, m] of dangerous) assert.equal(hosted.isBlockedApi(p, m, true), true, `${m} ${p} must be blocked`)

  const allowed = [
    ['/api/auth', 'POST'],
    ['/api/auth/me', 'GET'],
    ['/api/chat', 'POST'],
    ['/api/chat/', 'POST'],
    ['/api/jarvis', 'POST'],
    ['/api/jarvis/memory/semantic', 'GET'],
    ['/api/models', 'GET'],
    ['/api/models/keys', 'POST'],
    ['/api/users', 'POST'],
    ['/api/jobs', 'POST'],
    ['/api/marketplace', 'GET'],
    ['/login', 'GET'], // pages are not API routes
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

function apiRoutes() {
  const apiRoot = path.join(webRoot, 'app', 'api')
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : [])
  return walk(apiRoot).map(file => ({
    file,
    url: '/' + path.relative(path.join(webRoot, 'app'), path.dirname(file)).split(path.sep).join('/'),
    src: fs.readFileSync(file, 'utf8'),
  }))
}

test('every API route is either on the hosted allowlist or guarded by hostedGuard first', () => {
  let guarded = 0
  let allowed = 0
  for (const { url, src } of apiRoutes()) {
    const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\((\w+)[^)]*\)[^{]*\{\n([^\n]*)\n([^\n]*)/g)]
    assert.ok(handlers.length > 0 || !/export (async )?function (GET|POST|PUT|PATCH|DELETE)/.test(src), `${url}: handler shape not recognised`)
    for (const [, method, param, line1, line2] of handlers) {
      if (!hosted.isBlockedApi(url, method, true)) { allowed++; continue }
      assert.equal(line1.trim(), `const hostedBlock = hostedGuard(${param})`, `${url} ${method}: not allowlisted, so its first statement must be the hosted guard`)
      assert.equal(line2.trim(), 'if (hostedBlock) return hostedBlock', `${url} ${method}`)
      guarded++
    }
  }
  assert.ok(guarded >= 70 && allowed >= 15, `guarded ${guarded}, allowed ${allowed}`)
})

test('every hosted allowlist entry names a real API route', () => {
  const urls = new Set(apiRoutes().map(r => r.url))
  for (const entry of policy.allowedApi) {
    assert.ok([...urls].some(u => u === entry.path || (!entry.exact && u.startsWith(entry.path + '/'))), `${entry.path} is not a route`)
  }
})

test('server.js uses the same allowlist and stamps a trusted client IP', () => {
  const src = fs.readFileSync(path.join(webRoot, 'server.js'), 'utf8')
  assert.match(src, /hostedPolicy\.allowedApi/)
  assert.match(src, /stampClientIp\(req\)\n\s*if \(isHostedBlocked\(req\)\)/)
  assert.match(src, /delete req\.headers\['x-gf-client-ip'\]/)
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

// ── Outbound requests to user-typed URLs (findings 1, 10) ───────────────────

test('isPublicHttpsUrl is DNS-aware and does not misread hostnames', async () => {
  const net = require('../lib/net-guard.ts')
  const publicDns = async () => ['93.184.216.34']
  for (const url of ['https://openrouter.ai/api/v1', 'https://fdroid.org/v1', 'https://fc2.com/v1', 'https://fe80-careers.com/v1', 'https://8.8.8.8/v1']) {
    assert.equal(await net.isPublicHttpsUrl(url, publicDns), true, url)
  }
  for (const url of [
    'http://api.example.com/v1', 'https://localhost:1234', 'https://foo.localhost', 'https://127.0.0.1:8765',
    'https://10.0.0.2', 'https://192.168.1.10', 'https://172.20.0.1', 'https://169.254.169.254/latest',
    'https://100.100.100.100', 'https://[::1]:11434', 'https://[fd00::1]', 'https://[fe90::1]', 'https://[::ffff:7f00:1]',
    'https://2130706433', 'https://box.local', 'not a url', 'file:///etc/passwd',
  ]) {
    assert.equal(await net.isPublicHttpsUrl(url, publicDns), false, url)
  }
  // A public-looking name that resolves to the host itself (127.0.0.1.nip.io style)
  assert.equal(await net.isPublicHttpsUrl('https://127.0.0.1.nip.io/v1', async () => ['127.0.0.1']), false)
  assert.equal(await net.isPublicHttpsUrl('https://rebind.example/v1', async () => ['93.184.216.34', '10.0.0.5']), false)
})

test('publicRequest checks DNS at connect time and never follows redirects', async () => {
  const net = require('../lib/net-guard.ts')
  const http = require('node:http')
  // DNS answer is private → refused before any connection
  await assert.rejects(
    net.publicRequest('https://looks-public.example/v1', { resolveHost: async () => [{ address: '127.0.0.1', family: 4 }] }),
    /private network/i,
  )
  // A redirect (e.g. to the host's metadata service) is an error, not followed
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://169.254.169.254/latest' }); return res.end() }
    res.writeHead(500, { 'content-type': 'text/plain' }); res.end('upstream-secret-detail')
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const testOnly = { httpsOnly: false, isBlockedAddress: () => false }
    await assert.rejects(net.publicRequest(`${base}/redirect`, testOnly), /redirect/i)
    const res = await net.publicRequest(`${base}/error`, testOnly)
    assert.equal(res.status, 500)
  } finally {
    server.close()
  }
})

test('hosted custom-model calls refuse host addresses and never echo upstream bodies', async () => {
  const { generateOpenAICompatible } = require('../lib/ai.ts')
  await withHostedAsync(async () => {
    await assert.rejects(
      generateOpenAICompatible('Mine', 'https://127.0.0.1:11434/v1', undefined, 'm', { prompt: 'hi' }),
      err => err.message === 'Mine refused: not a public address',
    )
    await assert.rejects(
      generateOpenAICompatible('Mine', 'http://api.example.com/v1', undefined, 'm', { prompt: 'hi' }),
      /not a public address/,
    )
  })
  const src = fs.readFileSync(path.join(webRoot, 'lib', 'ai.ts'), 'utf8')
  const hostedFn = src.slice(src.indexOf('async function generateOpenAICompatibleHosted'), src.indexOf('export function generateWithOmniRoute'))
  assert.ok(hostedFn.length > 100)
  assert.doesNotMatch(hostedFn, /new Error\([^)]*res\.body/, 'upstream bodies must not reach error messages')
})

// ── Client IP and login limits (finding 2) ──────────────────────────────────

test('getClientIP trusts only the server-stamped address when hosted', () => {
  const { getClientIP } = require('../lib/ratelimit.ts')
  const req = h => ({ headers: { get: k => h[k.toLowerCase()] ?? null } })
  const spoof = { 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2', 'cf-connecting-ip': '3.3.3.3' }
  process.env.GF_CLIENT_IP_TOKEN = 'tok123'
  try {
    withHosted(() => {
      assert.equal(getClientIP(req(spoof)), 'unknown', 'client headers are ignored when hosted')
      assert.equal(getClientIP(req({ ...spoof, 'x-gf-client-ip': 'tok123:203.0.113.9' })), '203.0.113.9')
      assert.equal(getClientIP(req({ ...spoof, 'x-gf-client-ip': 'guess:9.9.9.9' })), 'unknown', 'a forged stamp is ignored')
    })
    // Local build keeps its behaviour (remote-access relies on it), but the stamp wins
    assert.equal(getClientIP(req(spoof)), '1.1.1.1')
    assert.equal(getClientIP(req({ ...spoof, 'x-gf-client-ip': 'tok123:198.51.100.2' })), '198.51.100.2')
  } finally {
    delete process.env.GF_CLIENT_IP_TOKEN
  }
  withHosted(() => assert.equal(getClientIP(req({ 'x-gf-client-ip': ':4.4.4.4' })), 'unknown', 'no token = no trust'))
})

test('failed logins are limited per username, whatever the IP', () => {
  const intrusion = require('../lib/intrusion.ts')
  intrusion._resetIntrusionState()
  for (let i = 0; i < intrusion.MAX_FAILED_LOGINS_PER_USER - 1; i++) intrusion.recordFailedUserLogin('Alice')
  assert.equal(intrusion.isUserLoginBlocked('alice'), false)
  intrusion.recordFailedUserLogin('alice ')
  assert.equal(intrusion.isUserLoginBlocked('ALICE'), true)
  assert.equal(intrusion.isUserLoginBlocked('bob'), false)
  intrusion.clearFailedUserLogins('alice')
  assert.equal(intrusion.isUserLoginBlocked('alice'), false)
  const route = fs.readFileSync(path.join(webRoot, 'app', 'api', 'auth', 'route.ts'), 'utf8')
  assert.match(route, /if \(isUserLoginBlocked\(username\)\)/)
  assert.match(route, /recordFailedUserLogin\(username\)/)
})

// ── Job Hunter add-url (finding 4) ──────────────────────────────────────────

test('hosted add-url is fetch-only: LinkedIn refused, no browser fallback', () => {
  const src = fs.readFileSync(path.join(webRoot, 'lib', 'job-hunter', 'intake.ts'), 'utf8')
  const fn = src.slice(src.indexOf('async function fetchHtml'), src.indexOf('return withProfile(', src.indexOf('async function fetchHtml')))
  assert.match(fn, /if \(isHostedMode\(\)\) \{[\s\S]*linkedin[\s\S]*throw new Error\([\s\S]*fetchPublic\(url\)[\s\S]*throw new Error/,
    'hosted branch must refuse LinkedIn and end in a throw, before the browser path')
})

// ── Localhost services (finding 8) ──────────────────────────────────────────

test('hosted semantic memory and deep search never call host services', async () => {
  const realFetch = global.fetch
  const calls = []
  global.fetch = async (url, ...rest) => { calls.push(String(url)); return realFetch(url, ...rest) }
  try {
    const memory = require('../lib/semantic-memory.ts')
    await withHostedAsync(async () => {
      await memory.rememberMemory('friend1', 'likes tea')
      await memory.recallMemory('friend1', 'tea', 3)
    })
  } finally {
    global.fetch = realFetch
  }
  assert.deepEqual(calls.filter(u => /localhost|127\.0\.0\.1|:11434/.test(u)), [])
  const route = fs.readFileSync(path.join(webRoot, 'app', 'api', 'jarvis', 'route.ts'), 'utf8')
  assert.match(route, /async function webSearchDeep\(query: string\): Promise<string> \{\n[^\n]*\n\s*if \(isHostedMode\(\)\) return webSearch\(query\)/)
})

// ── Account lifecycle (findings 5, 6) ───────────────────────────────────────

test('a deleted GHOSTFORGE_FRIENDS account is not re-created on restart', async () => {
  const users = require('../lib/users.ts')
  const run = spawnSync(process.execPath, [path.join(webRoot, 'scripts', 'hosted-user.mjs'), 'carol', '--generate'], { encoding: 'utf8' })
  const entry = run.stdout.trim()
  process.env.ADMIN_PASSWORD = 'friends-only-123'
  try {
    await withHostedAsync(async () => {
      process.env.GHOSTFORGE_FRIENDS = entry
      await users.ensureUserStore()
      const carol = await users.getUserByUsername('carol')
      assert.ok(carol)
      assert.equal(await users.deleteUser(carol.id), true)
      // A restart re-reads the variable (a changed value forces a fresh seeding pass)
      process.env.GHOSTFORGE_FRIENDS = `${entry}, `
      await users.ensureUserStore()
      assert.equal(await users.getUserByUsername('carol'), null, 'deleted friends stay deleted')
      const state = JSON.parse(fs.readFileSync(path.join(fakeHome, '.ghostforge', 'hosted-friends.json'), 'utf8'))
      assert.ok(state.seeded.includes('carol'))
    })
  } finally {
    delete process.env.GHOSTFORGE_FRIENDS
    delete process.env.ADMIN_PASSWORD
  }
})

test('a new account reusing a deleted username does not inherit its AI keys', async () => {
  const users = require('../lib/users.ts')
  const providers = require('../lib/providers.ts')
  process.env.ADMIN_PASSWORD = 'friends-only-123'
  try {
    await withHostedAsync(async () => {
      const first = await users.createUser({ name: 'Dave', username: 'dave', password: 'password-123' })
      assert.notEqual(first.id, users.userIdFor('dave'), 'hosted ids are random, not derived from the username')
      providers.runWithAIUser(first.id, () => providers.saveProviderKey('groq', 'gsk-daves-key'))
      const keyFile = path.join(fakeHome, '.ghostforge', 'hosted-ai', `${first.id}.json`)
      assert.ok(fs.existsSync(keyFile))
      assert.equal(await users.deleteUser(first.id), true)
      assert.equal(fs.existsSync(keyFile), false, 'AI settings are deleted with the account')
      const second = await users.createUser({ name: 'Other Dave', username: 'dave', password: 'password-456' })
      assert.notEqual(second.id, first.id)
      assert.equal(providers.runWithAIUser(second.id, () => providers.getProviderKey('groq')), undefined)
    })
  } finally {
    delete process.env.ADMIN_PASSWORD
  }
})
