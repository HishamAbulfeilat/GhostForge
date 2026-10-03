// Regression: large child-process output must not fail with ENOBUFS (run: node --test scripts/agents/boss-buffer.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_BUFFER, gitTry, sh } from './boss.mjs'

test('MAX_BUFFER is well above the 1 MiB Node default', () => {
  assert.ok(MAX_BUFFER >= 64 * 1024 * 1024)
})

test('gitTry succeeds with more than 1 MiB of output', () => {
  // Alias shells out to node to emit 3 MiB through git's stdout.
  const r = gitTry(process.cwd(), '-c', 'alias.big=!node -e "process.stdout.write(\'x\'.repeat(3*1024*1024))"', 'big')
  assert.equal(r.ok, true, r.out.slice(0, 200))
  assert.ok(r.out.length > 1024 * 1024)
})

test('sh succeeds with more than 1 MiB of output', () => {
  const r = sh('node', ['-e', "process.stdout.write('y'.repeat(3*1024*1024))"], process.cwd())
  assert.equal(r.ok, true, r.out.slice(0, 200))
  assert.ok(r.out.length > 1024 * 1024)
})
