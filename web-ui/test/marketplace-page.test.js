'use strict'
// Marketplace page: mark/unmark failures must be shown (review #14), the
// Commands tab must not claim to install anything (review #10), and several
// cards can be busy at once.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { readMarkResponse, markRequestBody, NETWORK_FAILURE } = require('../lib/marketplace-client.ts')

const page = fs.readFileSync(path.resolve(__dirname, '../app/marketplace/page.tsx'), 'utf8')
const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body instanceof Error) throw body
    return body
  },
})

test('readMarkResponse returns the server error for failed writes and denials', async () => {
  const fail = await readMarkResponse(response(500, { error: 'Cannot write the marketplace registry (registry.json)' }))
  assert.deepEqual(fail, { ok: false, status: 500, unauthorized: false, error: 'Cannot write the marketplace registry (registry.json)' })

  const denied = await readMarkResponse(response(403, { error: 'Your account doesn\'t have the "admin_tools" permission' }))
  assert.equal(denied.ok, false)
  assert.match(denied.error, /admin_tools/)

  const html = await readMarkResponse(response(502, new SyntaxError('Unexpected token <')))
  assert.deepEqual(html, { ok: false, status: 502, unauthorized: false, error: 'Request failed (HTTP 502).' })
})

test('readMarkResponse flags an expired session so the page can go to /login', async () => {
  const res = await readMarkResponse(response(401, { error: 'Unauthorized' }))
  assert.equal(res.ok, false)
  assert.equal(res.unauthorized, true)
})

test('readMarkResponse returns installed and marked ids on success', async () => {
  const res = await readMarkResponse(response(200, { ok: true, installed: ['a', 3], marked: ['b'] }))
  assert.deepEqual(res, { ok: true, installed: ['a'], marked: ['b'] })
  assert.equal(NETWORK_FAILURE.ok, false)
  assert.deepEqual(JSON.parse(markRequestBody('x', true)), { action: 'mark', id: 'x' })
  assert.deepEqual(JSON.parse(markRequestBody('x', false)), { action: 'unmark', id: 'x' })
})

test('the page shows failures, redirects on 401 and tracks busy ids in a Set', () => {
  assert.doesNotMatch(page, /catch \{ \/\* ignore \*\/ \}/, 'mark failures must not be swallowed')
  assert.doesNotMatch(page, /actionId/, 'a single shared actionId resets other busy cards')
  assert.match(page, /const \[busy, setBusy\] = useState<Set<string>>/)
  assert.match(page, /readMarkResponse\(res\)/)
  assert.match(page, /result\.unauthorized\)[\s\S]{0,60}router\.push\('\/login'\)/)
  assert.match(page, /role="alert"/)
  assert.match(page, /setError\(result\.error\)/)
})

test('the Commands tab says "Mark installed" and offers the install command to copy', () => {
  const commands = page.slice(page.indexOf('function CommandsTab'), page.indexOf('function HuggingFaceTab'))
  assert.ok(commands.length > 0)
  assert.doesNotMatch(commands, /'Install'/, 'the web never runs an installer, so it must not say Install')
  assert.match(commands, /'Mark installed'/)
  assert.match(commands, /copy\(item\.id, item\.install_command/)
  assert.match(commands, /☑ marked/)
  // Only users who may change shared state see the mark buttons.
  assert.match(commands, /\{canEdit && \(/)
})
