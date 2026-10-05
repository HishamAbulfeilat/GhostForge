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

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
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
