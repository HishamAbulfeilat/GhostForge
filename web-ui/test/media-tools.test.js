const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw error
    }
  },
})

const { PAGE_ACCESS, canAccessPage } = require('../lib/title-profiles.ts')
const { PERMISSIONS } = require('../lib/permissions.ts')
const { buildMediaRequest } = require('../app/media-tools/requests.ts')
const page = readFileSync(resolve(__dirname, '../app/media-tools/page.tsx'), 'utf8')
const navbar = readFileSync(resolve(__dirname, '../components/Navbar.tsx'), 'utf8')
const route = readFileSync(resolve(__dirname, '../app/api/device-controls/route.ts'), 'utf8')

test.after(() => hooks.deregister())

test('media tools page is gated by the youtube permission and linked in the navbar', () => {
  const access = PAGE_ACCESS.find(item => item.path === '/media-tools')
  assert.deepEqual({ permission: access?.permission, nav: access?.nav }, { permission: 'youtube', nav: true })
  assert.ok(PERMISSIONS.some(p => p.key === 'youtube'))
  assert.ok(PERMISSIONS.some(p => p.key === 'game_manager'))
  assert.equal(canAccessPage(null, '/media-tools'), false)
  assert.equal(canAccessPage({ role: 'user', permissions: [] }, '/media-tools'), false)
  assert.equal(canAccessPage({ role: 'user', permissions: ['youtube'] }, '/media-tools'), true)
  assert.equal(canAccessPage({ role: 'admin', permissions: [] }, '/media-tools'), true)
  assert.match(navbar, /href: '\/media-tools'.*label: 'Media'/)
})

test('page verifies the session and shows actionable loading and error states', () => {
  assert.match(page, /fetch\('\/api\/auth\/me'\)/)
  assert.match(page, /\/login\?next=\/media-tools/)
  assert.match(page, /Verifying access/)
  assert.match(page, /'Running…'/)
  assert.match(page, /bridge is running \(port 8765\)/)
  assert.match(page, /session has expired/)
  assert.match(page, /can\('game_manager'\)/)
  assert.match(page, /\/api\/device-controls/)
})

test('device controls route enforces per-target permissions before calling the bridge', () => {
  assert.match(route, /requirePermission\(req, target === 'youtube' \? 'youtube' : 'game_manager'\)/)
  assert.ok(route.indexOf('requirePermission(req') < route.indexOf('/api/mark-l/youtube'))
})

test('youtube requests are validated and shaped for the bridge contract', () => {
  assert.deepEqual(buildMediaRequest('youtube', 'play', '  lofi beats '), {
    request: { target: 'youtube', action: 'play', query: 'lofi beats' },
  })
  assert.deepEqual(buildMediaRequest('youtube', 'play', '  '), { error: 'Enter a search query.' })
  assert.deepEqual(buildMediaRequest('youtube', 'summarize', 'https://youtu.be/abc123'), {
    request: { target: 'youtube', action: 'summarize', url: 'https://youtu.be/abc123' },
  })
  assert.match(buildMediaRequest('youtube', 'get_info', 'https://evil.example/watch?v=1').error, /valid YouTube URL/)
  assert.deepEqual(buildMediaRequest('youtube', 'trending', '', 'jo'), {
    request: { target: 'youtube', action: 'trending', region: 'JO' },
  })
  assert.match(buildMediaRequest('youtube', 'trending', '', '1').error, /country code/)
  assert.match(buildMediaRequest('youtube', 'rm-rf', 'x').error, /Choose a YouTube action/)
})

test('game updater requests are validated and shaped for the bridge contract', () => {
  assert.deepEqual(buildMediaRequest('game-updater', 'list', 'ignored'), {
    request: { target: 'game-updater', action: 'list' },
  })
  assert.deepEqual(buildMediaRequest('game-updater', 'update', ' Portal 2 '), {
    request: { target: 'game-updater', action: 'update', game_name: 'Portal 2' },
  })
  assert.deepEqual(buildMediaRequest('game-updater', 'update', ''), {
    request: { target: 'game-updater', action: 'update' },
  })
  assert.deepEqual(buildMediaRequest('game-updater', 'download_status', ''), {
    request: { target: 'game-updater', action: 'download_status' },
  })
  assert.match(buildMediaRequest('game-updater', 'format', '').error, /Choose a game updater action/)
})
