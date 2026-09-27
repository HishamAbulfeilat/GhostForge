const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

// Isolate ~/.ghostforge (users.json, audit.log) in a temp home before loading modules.
const fakeHome = mkdtempSync(join(tmpdir(), 'gf-users-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.ADMIN_USERNAME = 'hisham'
process.env.ADMIN_PASSWORD = 'owner-password-123'
process.env.NODE_ENV = 'test'

// lib/*.ts use extensionless relative imports; resolve them to the .ts file.
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw err
    }
  },
})

const users = require('../lib/users.ts')
const { speakerContext, toSpeaker } = require('../lib/speaker.ts')
const intrusion = require('../lib/intrusion.ts')

test.after(() => {
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true })
})

test('the default admin is the owner; other admins are not', async () => {
  await users.ensureUserStore()
  const owner = await users.getUserByUsername('hisham')
  assert.ok(owner)
  assert.equal(users.isOwner(owner), true)

  const other = await users.createUser({ name: 'Second Admin', username: 'admin2', password: 'password-123', role: 'admin' })
  assert.equal(other.role, 'admin')
  assert.equal(users.isOwner(other), false)
})

test('an admin can be demoted to a limited user', async () => {
  const admin = await users.getUserByUsername('admin2')
  const demoted = await users.updateUser(admin.id, { role: 'user', permissions: ['chat'] })
  assert.equal(demoted.role, 'user')
  assert.deepEqual(demoted.permissions, ['chat'])
})

test('demotion without explicit permissions drops the admin wildcard', async () => {
  const u = await users.createUser({ name: 'Temp', username: 'temp', password: 'password-123', role: 'admin' })
  const demoted = await users.updateUser(u.id, { role: 'user' })
  assert.equal(demoted.role, 'user')
  assert.ok(!demoted.permissions.includes('*'))
})

test('the owner can never be demoted, deactivated or deleted', async () => {
  const owner = await users.getUserByUsername('hisham')
  const after = await users.updateUser(owner.id, { role: 'user', active: false, permissions: [] })
  assert.equal(after.role, 'admin')
  assert.equal(after.active, true)
  assert.deepEqual(after.permissions, ['*'])
  assert.equal(await users.deleteUser(owner.id), false)
})

test('non-owner admins can be deleted by the owner', async () => {
  const u = await users.createUser({ name: 'Admin3', username: 'admin3', password: 'password-123', role: 'admin' })
  assert.equal(await users.deleteUser(u.id), true)
})

test('speaker context identifies the owner', () => {
  const ctx = speakerContext(toSpeaker({ name: 'Hisham', username: 'hisham', role: 'admin', permissions: ['*'] }, true), 'Hisham')
  assert.match(ctx, /OWNER, Hisham/)
  assert.doesNotMatch(ctx, /NOT the owner/)
})

test('speaker context tells JARVIS a guest is not the owner and cannot impersonate', () => {
  const ctx = speakerContext(toSpeaker({ name: 'Sara', username: 'sara', role: 'user', permissions: ['chat', 'weather'] }, false), 'Hisham')
  assert.match(ctx, /Sara \(@sara\) — NOT the owner/)
  assert.match(ctx, /allowed: chat, weather/)
  assert.match(ctx, /claim to be Hisham/)
})

test('failed logins are counted per key and blocked after the limit', () => {
  intrusion._resetIntrusionState()
  const now = 1_000_000
  for (let i = 1; i < intrusion.MAX_FAILED_LOGINS; i++) {
    assert.equal(intrusion.recordFailedLogin('1.2.3.4', now + i), i)
    assert.equal(intrusion.isLoginBlocked('1.2.3.4', now + i), false)
  }
  intrusion.recordFailedLogin('1.2.3.4', now + 10)
  assert.equal(intrusion.isLoginBlocked('1.2.3.4', now + 11), true)
  assert.equal(intrusion.isLoginBlocked('5.6.7.8', now + 11), false)
  // Window expires after 10 minutes
  assert.equal(intrusion.isLoginBlocked('1.2.3.4', now + 11 * 60_000), false)
  intrusion.clearFailedLogins('1.2.3.4')
  assert.equal(intrusion.isLoginBlocked('1.2.3.4', now + 11), false)
})

test('unauthorized access is written to the audit log (lock disabled under test)', async () => {
  intrusion._resetIntrusionState()
  const res = await intrusion.reportUnauthorizedAccess({ reason: 'test intrusion', username: 'sara', ip: '9.9.9.9' })
  assert.equal(res.locked, false)
  const log = readFileSync(join(fakeHome, '.ghostforge', 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const entry = log.find(e => e.event === 'unauthorized_access')
  assert.ok(entry)
  assert.equal(entry.level, 'security')
  assert.equal(entry.ip, '9.9.9.9')
  assert.equal(entry.params.reason, 'test intrusion')
  assert.equal(entry.params.username, 'sara')
  assert.equal(entry.blocked, true)
})

test('forged tokens only count as tampering with a stable auth secret', () => {
  const saved = { s: process.env.AUTH_SECRET, e: process.env.GF_EPHEMERAL_AUTH_SECRET }
  process.env.AUTH_SECRET = 'x'.repeat(64)
  delete process.env.GF_EPHEMERAL_AUTH_SECRET
  assert.equal(intrusion.hasStableAuthSecret(), true)
  process.env.GF_EPHEMERAL_AUTH_SECRET = '1'
  assert.equal(intrusion.hasStableAuthSecret(), false)
  if (saved.s === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = saved.s
  if (saved.e === undefined) delete process.env.GF_EPHEMERAL_AUTH_SECRET
})
