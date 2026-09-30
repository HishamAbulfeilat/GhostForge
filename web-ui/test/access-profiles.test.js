const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

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

const {
  TITLE_PROFILES,
  PAGE_ACCESS,
  BASE_PERMISSIONS,
  profileForTitle,
  getProfile,
  permissionsForProfile,
  canAccessPage,
  allowedPages,
} = require('../lib/title-profiles.ts')
const { ALL_PERMISSIONS } = require('../lib/permissions.ts')
const { TOOL_PERMISSION } = require('../lib/tool-permissions.ts')

test.after(() => {
  hooks.deregister()
})

// ── referential integrity: every permission string used elsewhere must be a
// real key from permissions.ts, otherwise the gated page/tool is silently
// unreachable for every non-admin user. ────────────────────────────────────

test('every PAGE_ACCESS permission (other than null/"admin") is a real permission key', () => {
  const known = new Set(ALL_PERMISSIONS)
  for (const page of PAGE_ACCESS) {
    if (page.permission === null || page.permission === 'admin') continue
    assert.ok(known.has(page.permission), `page "${page.path}" requires unknown permission "${page.permission}"`)
  }
})

test('every TITLE_PROFILES permission is a real permission key', () => {
  const known = new Set(ALL_PERMISSIONS)
  for (const profile of TITLE_PROFILES) {
    for (const perm of profile.permissions) {
      assert.ok(known.has(perm), `profile "${profile.id}" grants unknown permission "${perm}"`)
    }
  }
  for (const perm of BASE_PERMISSIONS) {
    assert.ok(known.has(perm), `BASE_PERMISSIONS references unknown permission "${perm}"`)
  }
})

test('every TOOL_PERMISSION value is a real permission key', () => {
  const known = new Set(ALL_PERMISSIONS)
  for (const [tool, perm] of Object.entries(TOOL_PERMISSION)) {
    assert.ok(known.has(perm), `tool "${tool}" maps to unknown permission "${perm}"`)
  }
})

// ── profileForTitle keyword matching ────────────────────────────────────────

test('profileForTitle matches specific titles before the generic engineer fallback', () => {
  assert.equal(profileForTitle('Senior DevOps Engineer').id, 'devops')
  assert.equal(profileForTitle('Data Scientist').id, 'data')
  assert.equal(profileForTitle('Backend Software Engineer').id, 'engineer')
})

test('profileForTitle only matches whole keywords, not substrings', () => {
  // "hr" should not match inside "chariot" or similar; use an explicit non-matching title
  assert.equal(profileForTitle('Astronaut').id, 'general')
})

test('profileForTitle falls back to General for blank or unmatched titles', () => {
  assert.equal(profileForTitle('').id, 'general')
  assert.equal(profileForTitle('   ').id, 'general')
  assert.equal(profileForTitle('Astronaut').id, 'general')
})

test('getProfile resolves a known id and returns undefined for an unknown one', () => {
  assert.equal(getProfile('engineer')?.id, 'engineer')
  assert.equal(getProfile('not-a-real-profile'), undefined)
})

test('permissionsForProfile merges BASE_PERMISSIONS with the profile permissions, de-duplicated', () => {
  const engineer = getProfile('engineer')
  const perms = permissionsForProfile(engineer)
  assert.equal(new Set(perms).size, perms.length)
  for (const p of BASE_PERMISSIONS) assert.ok(perms.includes(p))
  for (const p of engineer.permissions) assert.ok(perms.includes(p))
})

// ── canAccessPage / allowedPages ─────────────────────────────────────────────

test('canAccessPage allows anyone (even signed out) through pages outside the catalog', () => {
  assert.equal(canAccessPage(null, '/some/unlisted/page'), true)
})

test('canAccessPage denies signed-out users any cataloged page', () => {
  assert.equal(canAccessPage(null, '/jarvis'), false)
  assert.equal(canAccessPage(undefined, '/settings'), false)
})

test('canAccessPage lets admins through every page regardless of permission', () => {
  const admin = { role: 'admin', permissions: [] }
  assert.equal(canAccessPage(admin, '/users'), true)
  assert.equal(canAccessPage(admin, '/mac-control'), true)
})

test('canAccessPage gates "admin"-only pages from non-admin users even with a wildcard permission', () => {
  const user = { role: 'user', permissions: ['*'] }
  assert.equal(canAccessPage(user, '/users'), false)
})

test('canAccessPage checks the specific permission for gated pages, and allows null-permission pages to anyone signed in', () => {
  const user = { role: 'user', permissions: ['terminal'] }
  assert.equal(canAccessPage(user, '/terminal'), true)
  assert.equal(canAccessPage(user, '/files'), false)
  assert.equal(canAccessPage(user, '/settings'), true) // permission: null
})

test('canAccessPage matches nested sub-paths of a cataloged page', () => {
  const user = { role: 'user', permissions: ['chat'] }
  assert.equal(canAccessPage(user, '/jarvis/some/nested/route'), true)
})

test('a user with the "n8n" permission can reach /workflows (regression: was gated behind a non-existent "workflows" key)', () => {
  const user = { role: 'user', permissions: ['n8n'] }
  assert.equal(canAccessPage(user, '/workflows'), true)
})

test('allowedPages returns exactly the subset canAccessPage would allow, for a limited user', () => {
  const user = { role: 'user', permissions: ['chat', 'file_read'] }
  const allowed = allowedPages(user)
  for (const page of PAGE_ACCESS) {
    assert.equal(allowed.includes(page), canAccessPage(user, page.path))
  }
})
