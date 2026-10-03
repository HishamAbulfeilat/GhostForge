// T-213: the command palette must hide pages the signed-in user can't open,
// using the same rule as the navbar (canAccessPage from lib/title-profiles).
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { renderPage } = require('./a11y-harness')

const FIXTURE = '../test/fixtures/command-palette-page.tsx'
const ADMIN_LABELS = ['Users', 'Security Scan', 'Test Runner', 'Code Health']

function profilePermissions(id) {
  const { getProfile, permissionsForProfile } = require('../lib/title-profiles.ts')
  return permissionsForProfile(getProfile(id))
}

async function paletteLabels(me, query = '') {
  const React = require('react')
  const page = await renderPage(FIXTURE, { '/api/auth/me': me })
  const { window } = page
  await React.act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  })
  await page.settle()
  if (query) {
    const input = window.document.getElementById('command-palette-input')
    assert.ok(input, 'palette input should render')
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    await React.act(async () => {
      setValue.call(input, query)
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await page.settle()
  }
  const labels = [...window.document.querySelectorAll('button p.font-medium')].map(p => p.textContent)
  await page.unmount()
  return labels
}

const user = (role, permissions) => ({
  user: { name: 'Ada', username: 'ada', role, permissions, setupComplete: true },
  isAdmin: role === 'admin',
})

test('a non-admin profile sees no admin-only palette entries', async () => {
  const labels = await paletteLabels(user('user', profilePermissions('engineer')))
  assert.ok(labels.includes('Web Terminal'), `engineer should see the terminal, got ${labels.join(', ')}`)
  for (const label of ADMIN_LABELS) assert.ok(!labels.includes(label), `non-admin must not see ${label}`)
})

test('searching for admin entries as a non-admin finds nothing', async () => {
  const labels = await paletteLabels(user('user', profilePermissions('devops')), 'admin')
  for (const label of ADMIN_LABELS) assert.ok(!labels.includes(label), `non-admin search must not surface ${label}`)
})

test('a non-admin only sees pages their profile grants, like the navbar', async () => {
  const labels = await paletteLabels(user('user', profilePermissions('general')))
  for (const hidden of ['Web Terminal', 'Model Manager', 'Mac Control', 'Dashboard', 'File Explorer']) {
    assert.ok(!labels.includes(hidden), `general profile must not see ${hidden}`)
  }
  for (const shown of ['Open JARVIS', 'Settings', 'Snippets', 'Reload Page']) {
    assert.ok(labels.includes(shown), `general profile should see ${shown}`)
  }
})

test('admins see the admin-only entries', async () => {
  const labels = await paletteLabels(user('admin', []))
  for (const label of ADMIN_LABELS) assert.ok(labels.includes(label), `admin should see ${label}`)
})

test('with no session the palette lists no gated pages', async () => {
  const labels = await paletteLabels({})
  for (const label of [...ADMIN_LABELS, 'Open JARVIS', 'Web Terminal', 'Settings']) {
    assert.ok(!labels.includes(label), `signed-out palette must not list ${label}`)
  }
  assert.ok(labels.includes('Toggle Theme'))
})

test('the palette reuses the navbar permission helper instead of its own rule', () => {
  const palette = readFileSync(resolve(__dirname, '../components/CommandPalette.tsx'), 'utf8')
  assert.match(palette, /import \{ canAccessPage \} from '@\/lib\/title-profiles'/)
  assert.match(palette, /import \{ useAccess \} from '@\/components\/AccessGuard'/)
  assert.doesNotMatch(palette, /role\s*===\s*'admin'/)
  assert.doesNotMatch(palette, /\b(ml|mr|pl|pr)-\d|text-(left|right)\b/)
})
