const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const page = fs.readFileSync(path.join(__dirname, '..', 'app', 'agents', 'page.tsx'), 'utf8')
const navbar = fs.readFileSync(path.join(__dirname, '..', 'components', 'Navbar.tsx'), 'utf8')

test('agents page uses the documented snapshot fields and endpoint', () => {
  for (const field of ['health', 'running', 'agents', 'tasks', 'messages', 'phase', 'provider', 'state', 'model', 'task']) {
    assert.match(page, new RegExp(`\\b${field}\\b`), `missing snapshot field ${field}`)
  }
  assert.match(page, /fetch\(['"]\/api\/agents['"]/)
  assert.match(page, /action: 'start'/)
  assert.match(page, /action: 'stop'/)
  assert.match(page, /action: 'say'/)
  assert.match(page, /action: 'add'/)
})

test('agents page and navbar expose all team controls without physical RTL utilities', () => {
  assert.match(navbar, /href: ['"]\/agents['"]/)
  assert.match(page, /Start team/)
  assert.match(page, /Stop team/)
  assert.match(page, />Say</)
  assert.match(page, />Add</)
  assert.doesNotMatch(page, /\b(?:ml|mr|pl|pr)-\d|\btext-(?:left|right)\b/)
})
