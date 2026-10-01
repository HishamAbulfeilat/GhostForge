const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const root = resolve(__dirname, '..')
const tui = readFileSync(resolve(root, 'tui/index.js'), 'utf8')
const cli = resolve(root, 'scripts/device-status.mjs')

test('TUI exposes device status in the menu and dispatches its submenu', () => {
  assert.match(tui, /Device & Push Status/)
  assert.match(tui, /'device-status'/)
  assert.match(tui, /screenDeviceStatus\(\)/)
  assert.match(tui, /scripts\/device-status\.mjs/)
})

test('device CLI help is executable without credentials or network access', () => {
  const output = execFileSync(process.execPath, [cli, 'help'], { cwd: root, encoding: 'utf8' })
  assert.match(output, /GF_SESSION_TOKEN/)
  assert.match(output, /GF_ALLOW_REMOTE_WEB_UI=1/)
})

test('device CLI rejects remote hosts unless explicitly opted in', async () => {
  const module = await import(`${pathToFileURL(cli).href}?test=${Date.now()}`)
  assert.throws(
    () => module.resolveBaseUrl({ GF_WEB_UI_URL: 'https://example.test' }),
    /not loopback/,
  )
  assert.equal(module.resolveBaseUrl({ GF_WEB_UI_URL: 'https://example.test', GF_ALLOW_REMOTE_WEB_UI: '1' }), 'https://example.test')
})

test('device CLI requires a session token and validates push arguments', async () => {
  const module = await import(`${pathToFileURL(cli).href}?test=${Date.now()}-validation`)
  assert.throws(() => module.sessionHeaders({}), /GF_SESSION_TOKEN is required/)
  assert.throws(() => module.parseArgs(['push', '--title', 'Only title']), /--body/)
  assert.deepEqual(module.parseArgs(['push', '--title', 'Title', '--body', 'Body']), {
    command: 'push', title: 'Title', body: 'Body', url: '',
  })
})
