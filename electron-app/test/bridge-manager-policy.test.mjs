// Bridge manager decisions (no Electron): loopback bind on every platform and
// health polling that slows down instead of silently giving up.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { test } from 'node:test'

import {
  BRIDGE_HOST,
  FAST_POLL_INTERVAL_MS,
  SLOW_POLL_INTERVAL_MS,
  bridgeSpawnCommand,
  nextHealthPollDelay,
} from '../src/main/bridge-manager-policy.ts'

test('the bridge binds loopback on Windows as well', () => {
  const win = bridgeSpawnCommand('win32', 'C:\\gf\\mark-l-bridge', 8765, win32.join)
  assert.equal(win.cmd, 'python')
  const host = win.args[win.args.indexOf('--host') + 1]
  assert.equal(host, '127.0.0.1')
  assert.equal(BRIDGE_HOST, '127.0.0.1')
  assert.ok(!win.args.includes('0.0.0.0'))

  const unix = bridgeSpawnCommand('linux', '/gf/mark-l-bridge', 8765, posix.join)
  assert.deepEqual(unix, { cmd: 'bash', args: ['/gf/mark-l-bridge/start.sh'] })
})

test('health polling keeps going after 30 s while the same process is still starting', () => {
  assert.equal(nextHealthPollDelay(0, 'starting', true), FAST_POLL_INTERVAL_MS)
  assert.equal(nextHealthPollDelay(29_999, 'starting', true), FAST_POLL_INTERVAL_MS)
  assert.equal(nextHealthPollDelay(30_000, 'starting', true), SLOW_POLL_INTERVAL_MS)
  assert.equal(nextHealthPollDelay(10 * 60_000, 'starting', true), SLOW_POLL_INTERVAL_MS)
  assert.ok(SLOW_POLL_INTERVAL_MS > FAST_POLL_INTERVAL_MS)
})

test('health polling stops once the status settles or the process was replaced/exited', () => {
  for (const status of ['running', 'stopped', 'error']) {
    assert.equal(nextHealthPollDelay(1_000, status, true), null, status)
  }
  assert.equal(nextHealthPollDelay(1_000, 'starting', false), null)
})

test('bridge-manager uses the shared policy (no 0.0.0.0, no fixed 30 s give-up)', () => {
  const src = readFileSync(new URL('../src/main/bridge-manager.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /0\.0\.0\.0/)
  assert.match(src, /bridgeSpawnCommand\(process\.platform/)
  assert.match(src, /nextHealthPollDelay\(/)
  assert.doesNotMatch(src, /pollHealth\(30_000\)/)
})
