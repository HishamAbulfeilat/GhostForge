const test = require('node:test')
const assert = require('node:assert/strict')

const qa = require('../lib/quick-actions.ts')

test('Windows host gets Windows wording for mac-scoped actions and nothing mac-only', () => {
  const win = qa.getQuickActionsForHost('win32', { macControl: false, browserControl: false })
  const ids = win.map(a => a.id)
  for (const id of ['apps', 'terminal', 'screenshot', 'volume', 'browser', 'files', 'hardware', 'games', 'security', 'lock', 'clipboard']) {
    assert.ok(ids.includes(id), `${id} should be available on Windows`)
  }
  assert.match(win.find(a => a.id === 'terminal').prompt, /PowerShell/)
  assert.match(win.find(a => a.id === 'lock').prompt, /PC/)
  assert.ok(win.every(a => a.scope !== 'mac'))
  assert.ok(win.every(a => !/\bMac\b|macOS|Finder|Terminal\.app/.test(a.prompt)), 'no mac wording on Windows')
  // mac-only vision actions have no Windows implementation and stay hidden
  assert.ok(!ids.includes('screen_understand'))
})

test('Linux host without mac control hides mac-only actions; macOS keeps all', () => {
  const linux = qa.getQuickActionsForHost('linux', { macControl: false, browserControl: false })
  assert.ok(!linux.some(a => a.scope === 'mac'))
  assert.ok(!linux.some(a => a.id === 'browser'))
  const mac = qa.getQuickActionsForHost('darwin')
  assert.equal(mac.length, qa.JARVIS_QUICK_ACTIONS.length)
})

test('quick actions with a tool resolve deterministically; tool-less ones fall through to the model', () => {
  assert.equal(qa.getJarvisQuickAction('lock').tool, 'lock_screen')
  assert.equal(qa.getJarvisQuickAction('search').tool, undefined)
  assert.ok(Array.isArray(qa.QUICK_ACTION_CATEGORIES) && qa.QUICK_ACTION_CATEGORIES.length > 0)
})
