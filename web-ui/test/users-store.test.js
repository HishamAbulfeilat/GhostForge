// users.json durability (lib/users.ts): atomic 0600 writes, no re-seed on a
// corrupt file, seeding under the store lock, throttled last-seen writes, and
// the setup wizard never widening permissions.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = fs.mkdtempSync(join(tmpdir(), 'gf-store-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.ADMIN_USERNAME = 'owner'
process.env.ADMIN_PASSWORD = 'owner-password-123'
process.env.NODE_ENV = 'test'

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
const { getProfile, permissionsForProfile, setupPermissionsFor } = require('../lib/title-profiles.ts')

const STORE_DIR = join(fakeHome, '.ghostforge')
const USERS_FILE = join(STORE_DIR, 'users.json')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const readStore = () => JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users

test.after(async () => {
  await sleep(100)
  hooks.deregister()
  fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

test('concurrent first-run seeding and user creation keep every account', async () => {
  // No users.json yet: seeding (ensureUserStore) and a createUser race.
  await Promise.all([
    users.ensureUserStore(),
    users.createUser({ name: 'Sara', username: 'sara', password: 'sara-password-1', permissions: ['chat'] }),
    users.ensureUserStore(),
  ])
  await sleep(50)
  const stored = readStore()
  assert.equal(stored.filter(u => u.role === 'admin').length, 1, 'exactly one seeded admin')
  assert.ok(stored.some(u => u.username === 'sara'), 'the created user survives seeding')
})

test('users.json is written atomically with mode 0600 and no temp files left behind', { skip: process.platform === 'win32' && 'POSIX modes only' }, async () => {
  const sara = await users.getUserByUsername('sara')
  await users.updateUser(sara.id, { name: 'Sara B' })
  assert.equal(fs.statSync(USERS_FILE).mode & 0o777, 0o600)
  assert.deepEqual(fs.readdirSync(STORE_DIR).filter(f => f.endsWith('.tmp')), [])
})

test('a corrupt users.json is never re-seeded over (accounts survive)', async () => {
  const before = readStore()
  const corrupt = JSON.stringify({ users: before }).slice(0, 40) // what a torn read used to see
  fs.writeFileSync(USERS_FILE, corrupt)
  await sleep(2100) // past the 2 s read cache, so the file is read again
  const result = await users.ensureUserStore().catch(err => err)
  // Either the last good copy is served or an error is raised — never a fresh store.
  if (Array.isArray(result)) {
    assert.ok(result.some(u => u.username === 'sara'), 'last good copy keeps sara')
  } else {
    assert.ok(result instanceof Error)
  }
  assert.equal(fs.readFileSync(USERS_FILE, 'utf8'), corrupt, 'the file was not overwritten by a re-seed')
  // Restore for the following tests
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users: before }, null, 2))
})

test('touchLastSeen rewrites the store at most once per minute per user', async () => {
  const sara = await users.getUserByUsername('sara')
  const t0 = Date.UTC(2030, 0, 1, 12, 0, 0)
  await users.touchLastSeen(sara.id, t0)
  assert.equal(readStore().find(u => u.id === sara.id).lastSeen, new Date(t0).toISOString())
  const mtime = fs.statSync(USERS_FILE).mtimeMs
  await sleep(20)
  await users.touchLastSeen(sara.id, t0 + 30_000)
  assert.equal(readStore().find(u => u.id === sara.id).lastSeen, new Date(t0).toISOString(), 'throttled within a minute')
  assert.equal(fs.statSync(USERS_FILE).mtimeMs, mtime, 'no write within the throttle window')
  await users.touchLastSeen(sara.id, t0 + users.LAST_SEEN_INTERVAL_MS + 1)
  assert.equal(readStore().find(u => u.id === sara.id).lastSeen, new Date(t0 + users.LAST_SEEN_INTERVAL_MS + 1).toISOString())
})

// ── setup wizard permissions (POST /api/setup) ─────────────────────────────

test('setup never widens a limited user to a more privileged profile', () => {
  const devops = getProfile('devops')
  assert.ok(devops, 'devops profile exists')
  assert.ok(permissionsForProfile(devops).includes('terminal'), 'devops would grant terminal')
  const legacy = { role: 'user', permissions: ['chat'] }
  const result = setupPermissionsFor(legacy, devops)
  assert.deepEqual(result, ['chat'])
  for (const p of ['terminal', 'file_write', 'mac_control', 'admin_tools', 'remote']) {
    assert.ok(!result.includes(p), `setup must not grant ${p}`)
  }
})

test('setup can only narrow: the result is the profile intersected with the current set', () => {
  const devops = getProfile('devops')
  const user = { role: 'user', permissions: ['chat', 'terminal', 'not_in_profile_xyz'] }
  const result = setupPermissionsFor(user, devops)
  assert.ok(result.every(p => user.permissions.includes(p)))
  assert.ok(result.includes('terminal'))
  assert.ok(!result.includes('not_in_profile_xyz'))
})

test('owner-assigned permissions are kept exactly through setup; admins are untouched', async () => {
  const sara = await users.getUserByUsername('sara')
  assert.equal(sara.permissionsAssigned, true, 'createUser with an explicit list marks it owner-assigned')
  assert.deepEqual(setupPermissionsFor(sara, getProfile('devops')), ['chat'])
  const explicit = { role: 'user', permissions: ['chat', 'calendar', 'youtube'], permissionsAssigned: true }
  assert.deepEqual(setupPermissionsFor(explicit, getProfile('devops')), ['chat', 'calendar', 'youtube'])
  assert.equal(setupPermissionsFor({ role: 'admin', permissions: ['*'] }, getProfile('devops')), null)
})
