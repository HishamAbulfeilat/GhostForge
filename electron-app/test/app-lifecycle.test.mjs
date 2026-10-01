import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  runBoundedCleanup,
  shouldMinimizeWindowToTray,
} from '../dist/main/headless-smoke.js'

const mainSourcePath = fileURLToPath(new URL('../src/main/index.ts', import.meta.url))
const traySourcePath = fileURLToPath(new URL('../src/main/tray.ts', import.meta.url))
const daemonSourcePath = fileURLToPath(new URL('../src/main/jarvis-daemon.ts', import.meta.url))

test('minimize-to-tray is limited to ordinary window close', () => {
  assert.equal(shouldMinimizeWindowToTray(false, true), true)
  assert.equal(shouldMinimizeWindowToTray(true, true), false)
  assert.equal(shouldMinimizeWindowToTray(false, false), false)
})

test('bounded cleanup invokes every task once and reports task failures', async () => {
  const calls = []

  await assert.rejects(
    runBoundedCleanup([
      { name: 'first', run: () => calls.push('first') },
      { name: 'failed', run: () => { calls.push('failed'); throw new Error('failure') } },
      { name: 'last', run: () => calls.push('last') },
    ], 100),
    /Cleanup failed: failed: failure/,
  )
  assert.deepEqual(calls.sort(), ['failed', 'first', 'last'])
})

test('bounded cleanup starts all tasks and rejects if any task stalls', async () => {
  const calls = []

  await assert.rejects(
    runBoundedCleanup([
      { name: 'stalled', run: () => { calls.push('stalled'); return new Promise(() => {}) } },
      { name: 'completed', run: () => { calls.push('completed') } },
    ], 20),
    /Cleanup timed out after 20ms; pending: stalled/,
  )
  assert.deepEqual(calls.sort(), ['completed', 'stalled'])
})

test('quit wiring bypasses close-to-tray and only reports smoke success after cleanup', async () => {
  const [source, traySource, daemonSource] = await Promise.all([
    readFile(mainSourcePath, 'utf8'),
    readFile(traySourcePath, 'utf8'),
    readFile(daemonSourcePath, 'utf8'),
  ])

  assert.match(source, /ipcMain\.handle\('window:close', \(\) => \{[\s\S]*?isExplicitWindowClose = true;[\s\S]*?mainWindow\?\.close\(\);/)
  assert.match(source, /app\.on\('before-quit', \(event\) => \{[\s\S]*?event\.preventDefault\(\)/)
  assert.ok(source.indexOf("app.on('before-quit'") < source.indexOf('app.requestSingleInstanceLock()'))
  assert.match(source, /shouldMinimizeWindowToTray\(skipTrayInterception, config\.minimizeToTray\)/)
  assert.match(source, /const skipTrayInterception = isQuitting \|\| isExplicitWindowClose/)
  assert.match(source, /if \(process\.platform !== 'darwin'\) \{[\s\S]*?app\.quit\(\)/)
  assert.match(traySource, /label: 'Quit',[\s\S]*?app\.quit\(\)/)
  assert.match(daemonSource, /label: 'Quit JARVIS',[\s\S]*?app\.quit\(\)/)
  assert.match(source, /if \(cleanupPromise\) return/)
  assert.match(source, /if \(cleanupComplete\) return/)
  assert.match(source, /cleanupPromise\.then\(\(\) => \{[\s\S]*?HEADLESS_CLEAN_LOG/)
  assert.match(source, /cleanupPromise\.then\(\(\) => \{[\s\S]*?cleanupComplete = true/)
  assert.match(source, /HEADLESS_CLEANUP_FAILED_LOG[\s\S]{0,240}app\.exit\(1\)/)
  assert.match(source, /name: 'bridge', run: \(\) => bridgeManager\.stopBridge\(\)/)
})
