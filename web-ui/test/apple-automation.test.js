const test = require('node:test')
const assert = require('node:assert/strict')
const { knownAppleScript, validateAppleScript } = require('../lib/apple-automation')

test('builds deterministic AppleScript for common Mac actions', () => {
  assert.match(knownAppleScript('open Safari'), /tell application "Safari" to activate/)
  assert.equal(knownAppleScript('open the GhostForge dashboard'), 'open location "http://localhost:3001/dashboard"')
  assert.equal(knownAppleScript('go to https://example.com'), 'open location "https://example.com"')
  assert.equal(knownAppleScript('set volume to 250'), 'set volume output volume 100')
  const screenshotScript = knownAppleScript('take a screenshot')
  assert.match(screenshotScript, /GhostForge\/screenshots/)
  assert.match(screenshotScript, /quoted form of outputFile/)
  assert.equal(screenshotScript.includes("'$HOME"), false)
})

test('blocks destructive generated AppleScript', () => {
  assert.equal(validateAppleScript('do shell script "sudo rm -rf /"').ok, false)
  assert.equal(validateAppleScript('tell application "Finder" to activate').ok, true)
})
