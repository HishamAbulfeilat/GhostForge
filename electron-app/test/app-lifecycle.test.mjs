import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createQuitController, runCleanupTasks } from '../dist/main/app-lifecycle.js'

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
  assert.equal(controller.beginCleanup(), true)
  assert.equal(controller.beginCleanup(), false)
  assert.equal(controller.shouldMinimizeOnWindowClose(true), false)
  assert.equal(controller.isShutdownStarted(), true)
  assert.equal(controller.isCleanupComplete(), false)
  controller.finishCleanup()
  assert.equal(controller.isCleanupComplete(), true)
})

test('normal close still minimizes to tray without starting shutdown', () => {
  const controller = createQuitController()

  assert.equal(controller.shouldMinimizeOnWindowClose(true), true)
  assert.equal(controller.isShutdownStarted(), false)
  assert.equal(controller.shouldMinimizeOnWindowClose(false), false)
})

test('cleanup runs once in order and isolates failures', async () => {
  const calls = []
  const result = await runCleanupTasks([
    { name: 'listeners', run: () => calls.push('listeners') },
    { name: 'broken service', run: () => {
      calls.push('broken service')
      throw new Error('expected')
    } },
    { name: 'child process', run: async () => {
      await Promise.resolve()
      calls.push('child process')
    } },
  ], 1_000)

  assert.deepEqual(calls, ['listeners', 'broken service', 'child process'])
  assert.deepEqual(result.completed, ['listeners', 'child process'])
  assert.deepEqual(result.failed.map(({ name }) => name), ['broken service'])
  assert.equal(result.timedOut, false)
})

test('cleanup deadline is bounded when a child never exits', async () => {
  const startedAt = Date.now()
  const result = await runCleanupTasks([
    { name: 'stuck child', run: () => new Promise(() => {}) },
  ], 25)

  assert.equal(result.timedOut, true)
  assert.ok(Date.now() - startedAt < 500)
})
