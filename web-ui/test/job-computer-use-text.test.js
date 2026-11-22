// The computer-use fallback types text the vision model chose. A newline would
// press Enter and could submit the form, so only one plain line is ever typed.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) {
        for (const ext of ['.ts', '.js', '/index.ts']) {
          try { return nextResolve(specifier + ext, context) } catch { /* next */ }
        }
      }
      throw err
    }
  },
})
const { computerUseText } = require('../lib/job-hunter/agent.ts')
test.after(() => hooks.deregister())

const CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127, 0x2028, 0x2029) + ']')

test('computer-use text never contains Enter, Tab or other control keys', () => {
  const input = 'Jane Doe\nthen submit\r\n\tok' + String.fromCharCode(0x2028) + 'x'
  const typed = computerUseText(input)
  assert.equal(CONTROL.test(input), true)
  assert.equal(CONTROL.test(typed), false)
  assert.equal(typed, 'Jane Doe then submit ok x')
})

test('computer-use text keeps ordinary text and the 500 character cap', () => {
  assert.equal(computerUseText('Amman, Jordan'), 'Amman, Jordan')
  assert.equal(computerUseText('a'.repeat(900)).length, 500)
  assert.equal(computerUseText(undefined), '')
})
