// Remote access: one-time device pairing, device revocation ending the session,
// and the remote-desktop key allow-list / frame-size parsing.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-remote-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'

const WEB_UI = join(__dirname, '..')
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    // Route files import through the '@/*' alias and Next's extensionless subpaths
    if (specifier.startsWith('@/')) specifier = join(WEB_UI, specifier.slice(2))
    if (specifier === 'next/server') specifier = 'next/server.js'
    if (specifier.startsWith(WEB_UI)) {
      for (const ext of ['', '.ts', '.js', '/index.ts']) {
        try { return nextResolve(specifier + ext, context) } catch { /* next */ }
      }
    }
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) {
        for (const ext of ['.ts', '.js', '/index.ts']) {
          try { return nextResolve(specifier + ext, context) } catch { /* next */ }
        }
      }
      throw err
    }
  },
})

const store = require('../lib/remote/store.ts')
const desktop = require('../lib/remote/desktop.ts')

test.after(() => {
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

test('a pairing code works once, and only its hash is stored', async () => {
  const { code, expiresAt } = await store.createPairing('alice', 'Phone')
  assert.ok(code.length >= 20)
  assert.ok(Date.parse(expiresAt) > Date.now())
  const raw = readFileSync(join(fakeHome, '.ghostforge', 'remote.json'), 'utf8')
  assert.ok(!raw.includes(code), 'the code itself is never written to disk')

  const device = await store.redeemPairing(code, 'iPhone · Safari')
  assert.equal(device.username, 'alice')
  assert.equal(device.name, 'iPhone · Safari')
  assert.equal(await store.redeemPairing(code, 'again'), null, 'single use')
  assert.equal(await store.isDeviceRevoked(device.id), false)
})

test('expired, unknown and malformed codes are refused', async () => {
  const { code } = await store.createPairing('alice')
  await store.updateRemote(s => { for (const p of s.pairings) p.expiresAt = new Date(Date.now() - 1000).toISOString() })
  assert.equal(await store.redeemPairing(code, 'x'), null)
  assert.equal(await store.redeemPairing('A'.repeat(22), 'x'), null)
  assert.equal(await store.redeemPairing('short', 'x'), null)
  assert.equal(await store.redeemPairing(undefined, 'x'), null)
})

test('only the device owner (or the server owner) can revoke a device', async () => {
  const { code } = await store.createPairing('bob')
  const device = await store.redeemPairing(code, 'Android · Chrome')
  assert.equal(await store.revokeDevice(device.id, 'mallory', false), false)
  assert.equal(await store.isDeviceRevoked(device.id), false)
  assert.equal(await store.revokeDevice(device.id, 'bob', false), true)
  assert.equal(await store.isDeviceRevoked(device.id), true)
  assert.equal(await store.isDeviceRevoked('no-such-device'), true, 'unknown device ids are not valid sessions')
})

test('concurrent pairings are not lost', async () => {
  const codes = await Promise.all(Array.from({ length: 5 }, () => store.createPairing('carol')))
  const devices = await Promise.all(codes.map(c => store.redeemPairing(c.code, 'Device')))
  assert.equal(devices.filter(Boolean).length, 5)
})

test('device names come from the user agent', () => {
  assert.equal(store.deviceNameFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1'), 'iPhone · Safari')
  assert.equal(store.deviceNameFromUA('Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/126.0 Mobile Safari/537.36'), 'Android · Chrome')
  assert.equal(store.deviceNameFromUA(null), 'Device · Browser')
})

test('session tokens carry the paired device id, and revoking the device ends the session', async () => {
  process.env.AUTH_SECRET = 'remote-test-secret-0123456789abcdef'
  const auth = require('../lib/auth.ts')
  const user = { id: 'u1', username: 'dave', role: 'admin' }
  const { code } = await store.createPairing('dave')
  const device = await store.redeemPairing(code, 'iPad · Safari')
  const token = auth.createSessionToken(user, { deviceId: device.id })
  assert.equal(auth.verifySessionToken(token).dev, device.id)
  assert.equal(auth.verifySessionToken(auth.createSessionToken(user)).dev, undefined, 'laptop sessions are not device sessions')
})

test('remote desktop keys: only allow-listed names and combos resolve', () => {
  const Key = new Proxy({}, { get: (_, name) => (typeof name === 'string' ? `K:${name}` : undefined) })
  assert.deepEqual(desktop.resolveKeys('ctrl+shift+t', Key), ['K:LeftControl', 'K:LeftShift', 'K:T'])
  assert.deepEqual(desktop.resolveKeys('Enter', Key), ['K:Enter'])
  assert.deepEqual(desktop.resolveKeys('cmd+5', Key), ['K:LeftSuper', 'K:Num5'])
  assert.equal(desktop.resolveKeys('ctrl+constructor', Key), null)
  assert.equal(desktop.resolveKeys('__proto__', Key), null)
  assert.equal(desktop.resolveKeys('', Key), null)
  assert.equal(desktop.resolveKeys('a+b+c+d+e', Key), null)
})

test('jpegSize reads width and height from the SOF marker', () => {
  // SOI, APP0 (len 4), SOF0 with height 0x0438 (1080) and width 0x0780 (1920)
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(desktop.jpegSize(jpeg), { width: 1920, height: 1080 })
  assert.equal(desktop.jpegSize(Buffer.from([0xff, 0xd8, 0, 0])), null)
})

test('opening a pairing link does not use the code; only the same-origin "Sign in" form does', async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'remote-test-secret-0123456789abcdef'
  const { NextRequest } = require('next/server')
  const pairRoute = require('../app/api/remote/pair/route.ts')
  const redeemRoute = require('../app/api/remote/pair/redeem/route.ts')
  const users = require('../lib/users.ts')
  if (!(await users.getUserByUsername('erin'))) await users.createUser({ name: 'Erin', username: 'erin', password: 'erin-password-123', role: 'user' })
  const { code } = await store.createPairing('erin')
  const base = 'http://192.0.2.10:3001'

  // Link previewers (chat apps, mail scanners) GET the link: page only, no cookie, code unused
  const page = await pairRoute.GET(new NextRequest(`${base}/api/remote/pair?code=${code}`, { headers: { 'user-agent': 'facebookexternalhit/1.1' } }))
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('set-cookie'), null)
  const html = await page.text()
  assert.match(html, /action="\/api\/remote\/pair\/redeem"/)
  assert.ok(html.includes(`value="${code}"`))
  assert.equal((await pairRoute.GET(new NextRequest(`${base}/api/remote/pair?code=<script>`))).status, 400)

  const form = (origin, c = code) => new NextRequest(`${base}/api/remote/pair/redeem`, {
    method: 'POST', body: new URLSearchParams({ code: c }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin, host: '192.0.2.10:3001', 'x-real-ip': '203.0.113.7' },
  })
  // Another site cannot post the code (login CSRF)
  assert.equal((await redeemRoute.POST(form('https://evil.example'))).status, 403)
  // An opaque origin (sandboxed frame / no-referrer page elsewhere) is refused too
  assert.equal((await redeemRoute.POST(form('null'))).status, 403)
  // Modern browsers: Sec-Fetch-Site decides, whatever the Host header says
  const fetchSite = site => new NextRequest(`${base}/api/remote/pair/redeem`, {
    method: 'POST', body: new URLSearchParams({ code }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': site, 'x-real-ip': '203.0.113.8' },
  })
  assert.equal((await redeemRoute.POST(fetchSite('cross-site'))).status, 403)
  assert.equal((await redeemRoute.POST(fetchSite('same-site'))).status, 403)
  // Our own pairing page keeps a real Origin on its form post
  assert.equal(page.headers.get('referrer-policy'), 'same-origin')
  // Our own page can, once
  const ok = await redeemRoute.POST(form(base))
  assert.equal(ok.status, 200)
  assert.match(ok.headers.get('set-cookie') || '', /HttpOnly/i)
  assert.match(ok.headers.get('set-cookie') || '', /SameSite=strict/i)
  assert.equal((await redeemRoute.POST(form(base))).status, 410)
})

test('revoking a device ends its session on every guard, including the synchronous ones', async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'remote-test-secret-0123456789abcdef'
  const auth = require('../lib/auth.ts')
  const user = { id: 'u9', username: 'frank', role: 'admin' }
  const { code } = await store.createPairing('frank')
  const device = await store.redeemPairing(code, 'Pixel · Chrome')
  const token = auth.createSessionToken(user, { deviceId: device.id })
  assert.equal(auth.isValidAuthToken(token), true)
  const req = { cookies: { get: () => ({ value: token }) } }
  assert.equal(auth.isAuthorizedRequest(req), true)
  await store.revokeDevice(device.id, 'frank', false)
  assert.equal(auth.isValidAuthToken(token), false, 'isValidAuthToken')
  assert.equal(auth.isAuthorizedRequest(req), false, 'isAuthorizedRequest (used by ~30 API routes)')
  assert.equal(auth.isValidAuthToken(auth.createSessionToken(user)), true, 'laptop sessions are unaffected')
  assert.equal(auth.isValidAuthToken(auth.createSessionToken(user, { deviceId: 'never-paired' })), false)
})

test('remote desktop: wrong passwords are limited and control starts off after a restart', async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'remote-test-secret-0123456789abcdef'
  const { NextRequest } = require('next/server')
  const auth = require('../lib/auth.ts')
  const users = require('../lib/users.ts')
  const route = require('../app/api/remote/desktop/route.ts')
  const admin = (await users.getUserByUsername('gina')) || await users.createUser({ name: 'Gina', username: 'gina', password: 'gina-password-123', role: 'admin' })
  const cookie = `${auth.AUTH_COOKIE_NAME}=${auth.createSessionToken(admin)}`
  const post = body => route.POST(new NextRequest('http://127.0.0.1:3001/api/remote/desktop', {
    method: 'POST', body: JSON.stringify(body), headers: { cookie, 'content-type': 'application/json', 'x-real-ip': '198.51.100.4' },
  }))

  // Left "on" in the file by an earlier run: a fresh server treats it as off
  await store.updateRemote(s => { s.desktopEnabled = true; s.desktopEnabledAt = new Date().toISOString() })
  const status = await (await route.GET(new NextRequest('http://127.0.0.1:3001/api/remote/desktop', { headers: { cookie } }))).json()
  assert.equal(status.enabled, false)
  assert.equal((await post({ input: { type: 'key', key: 'enter' } })).status, 409)

  for (let i = 0; i < 5; i++) assert.equal((await post({ action: 'enable', password: 'wrong' })).status, 403)
  assert.equal((await post({ action: 'enable', password: 'gina-password-123' })).status, 429, 'locked out even with the right password')
})
