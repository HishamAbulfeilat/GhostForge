import assert from 'node:assert/strict'
import test from 'node:test'

import { getHeadlessSwitches } from '../dist/main/headless-smoke.js'

test('headless smoke keeps the Chromium sandbox enabled', () => {
  assert.ok(
    !getHeadlessSwitches().includes('no-sandbox'),
    'Headless smoke must not disable Chromium sandboxing',
  )
})
