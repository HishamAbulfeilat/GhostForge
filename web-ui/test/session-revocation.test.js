'use strict'
// Sessions end when the account changes (review finding #8): deactivating a
// user, changing their password or deleting them ends their existing session
// cookie on every guard, including the synchronous isAuthorizedRequest used by
// most API routes. New accounts get random ids, so a re-created username never
// inherits the old person's session. Existing accounts and sessions from before
// the session version existed keep working.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = fs.mkdtempSync(join(tmpdir(), 'gf-sessions-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.ADMIN_USERNAME = 'owner'
process.env.ADMIN_PASSWORD = 'owner-password-123'
process.env.AUTH_SECRET = 'session-revocation-test-secret-0123456789'
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
const auth = require('../lib/auth.ts')

const USERS_FILE = join(fakeHome, '.ghostforge', 'users.json')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const reqWith = token => ({ cookies: { get: name => (name === auth.AUTH_COOKIE_NAME ? { value: token } : undefined) } })
const createSara = (username = 'sara') =>
  users.createUser({ name: 'Sara', username, password: 'sara-password-1', permissions: ['chat'] })

test.after(async () => {
  await sleep(100)
  hooks.deregister()
  fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

test('a deactivated account loses its session on the synchronous guard and getCurrentUser', async () => {
  await users.ensureUserStore()
  const sara = await createSara()
  const token = auth.createSessionToken(sara)
  assert.equal(auth.isAuthorizedRequest(reqWith(token)), true, 'active account: session works')
  assert.equal((await auth.getCurrentUser(reqWith(token)))?.username, 'sara')

  await users.updateUser(sara.id, { active: false })
  assert.equal(auth.isValidAuthToken(token), false, 'isValidAuthToken after deactivation')
  assert.equal(auth.isAuthorizedRequest(reqWith(token)), false, 'isAuthorizedRequest after deactivation')
  assert.equal(await auth.getCurrentUser(reqWith(token)), null)

  // Re-activating does not bring the old session back; a new sign-in works.
  const back = await users.updateUser(sara.id, { active: true })
  assert.equal(auth.isAuthorizedRequest(reqWith(token)), false, 'old session stays ended after re-activation')
  assert.equal(auth.isAuthorizedRequest(reqWith(auth.createSessionToken(back))), true, 'a fresh session works')
})

test('a password change ends sessions issued before it', async () => {
  const sara = await users.getUserByUsername('sara')
  const token = auth.createSessionToken(sara)
  assert.equal(auth.isAuthorizedRequest(reqWith(token)), true)
  await users.setUserPassword(sara.id, 'a-brand-new-password')
  assert.equal(auth.isAuthorizedRequest(reqWith(token)), false, 'setUserPassword')

  const after = await users.getUserByUsername('sara')
  const token2 = auth.createSessionToken(after)
  assert.equal(auth.isAuthorizedRequest(reqWith(token2)), true)
  await users.updateUser(after.id, { passwordHash: users.hashPassword('yet-another-password') })
  assert.equal(auth.isAuthorizedRequest(reqWith(token2)), false, 'updateUser with a new passwordHash')

  // Other edits (name, permissions) keep the session.
  const now = await users.getUserByUsername('sara')
  const token3 = auth.createSessionToken(now)
  await users.updateUser(now.id, { name: 'Sara C', permissions: ['chat', 'weather'] })
  assert.equal(auth.isAuthorizedRequest(reqWith(token3)), true, 'non-security edits keep sessions')
})

test('a deleted and re-created username does not inherit the old session', async () => {
  const old = await users.getUserByUsername('sara')
  const oldToken = auth.createSessionToken(old)
  assert.ok(await users.deleteUser(old.id))
  assert.equal(auth.isAuthorizedRequest(reqWith(oldToken)), false, 'deleted account')

  const reborn = await createSara()
  assert.notEqual(reborn.id, old.id, 'the new account gets a new id')
  assert.notEqual(reborn.id, users.userIdFor('sara'), 'ids are no longer derived from the username')
  assert.match(reborn.id, /^u_[0-9a-f]{20}$/)
  assert.equal(auth.isAuthorizedRequest(reqWith(oldToken)), false, "old person's cookie is not valid for the new account")
  assert.equal(await auth.getCurrentUser(reqWith(oldToken)), null)
})

test('legacy accounts (sha1 ids, no session version) and their existing sessions keep working', async () => {
  await sleep(50)
  const legacyId = users.userIdFor('legacy')
  const store = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
  store.users.push({
    id: legacyId, name: 'Legacy', username: 'legacy', role: 'user', passwordHash: users.hashPassword('legacy-password-1'),
    permissions: ['chat'], active: true, createdAt: new Date(0).toISOString(),
  })
  fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2)) // edited outside the server
  await sleep(2100) // past the async read cache

  // A token minted before `sv` existed: build it with the same signing helper.
  const legacyToken = auth.createSessionToken({ id: legacyId, name: 'Legacy', username: 'legacy', role: 'user' })
  const [body] = legacyToken.split('.')
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  delete payload.sv
  const { createHmac } = require('node:crypto')
  const newBody = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const preUpgradeToken = `${newBody}.${createHmac('sha256', process.env.AUTH_SECRET).update(newBody).digest('base64url')}`

  assert.equal(auth.isAuthorizedRequest(reqWith(preUpgradeToken)), true, 'pre-upgrade session of an active legacy user')
  assert.equal((await auth.getCurrentUser(reqWith(preUpgradeToken)))?.id, legacyId)
  assert.equal((await users.getUserById(legacyId))?.username, 'legacy', 'legacy id still resolves')

  await users.updateUser(legacyId, { active: false })
  assert.equal(auth.isAuthorizedRequest(reqWith(preUpgradeToken)), false, 'deactivating ends the pre-upgrade session too')
})

test('the synchronous check follows users.json edited by another process, and fails closed on garbage', async () => {
  const sara = await users.getUserByUsername('sara')
  const token = auth.createSessionToken(sara)
  assert.equal(auth.isAuthorizedRequest(reqWith(token)), true)

  const store = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
  store.users.find(u => u.id === sara.id).active = false
  const tmp = USERS_FILE + '.ext.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2))
  fs.renameSync(tmp, USERS_FILE)
  assert.equal(auth.isAuthorizedRequest(reqWith(token)), false, 'external deactivation is seen at once')

  // A corrupt file is never re-seeded and does not open sessions up.
  const good = fs.readFileSync(USERS_FILE, 'utf8')
  fs.writeFileSync(USERS_FILE, good.slice(0, 30))
  assert.equal(auth.isAuthorizedRequest(reqWith(token)), false)
  assert.equal(fs.readFileSync(USERS_FILE, 'utf8'), good.slice(0, 30), 'not overwritten')
  fs.writeFileSync(USERS_FILE, good)
})

test('a token for an id that was never an account is refused', () => {
  const ghost = auth.createSessionToken({ id: 'u_nobody', name: 'Nobody', username: 'nobody', role: 'admin' })
  assert.equal(auth.isAuthorizedRequest(reqWith(ghost)), false)
})

test('the session version is not exposed to the client', async () => {
  const sara = await users.getUserByUsername('sara')
  await users.setUserPassword(sara.id, 'another-password-2')
  const stored = await users.getUserByUsername('sara')
  assert.ok(stored.sessionVersion >= 1)
  assert.equal('sessionVersion' in users.toPublicUser(stored), false)
})
