import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createQuitController } from '../dist/main/app-lifecycle.js'

test('explicit quit bypasses the tray-minimize close guard', () => {
  const controller = createQuitController()

  assert.equal(controller.shouldMinimizeOnWindowClose(true), true)
  assert.equal(controller.isExplicitQuitRequested(), false)
  assert.equal(controller.requestExplicitQuit(), true)
  assert.equal(controller.isExplicitQuitRequested(), true)
  assert.equal(controller.shouldMinimizeOnWindowClose(true), false)
  assert.equal(controller.requestExplicitQuit(), false)
})

test('shutdown guards keep the close handler from re-entering during cleanup', () => {
  const controller = createQuitController()

  assert.equal(controller.shouldMinimizeOnWindowClose(true), true)
  controller.markShutdownStarted()
  assert.equal(controller.shouldMinimizeOnWindowClose(true), false)
  assert.equal(controller.isShutdownStarted(), true)
})
