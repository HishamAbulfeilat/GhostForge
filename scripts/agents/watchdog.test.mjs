// Unit tests for the boss watchdog (run: node --test scripts/agents/watchdog.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { check, isAlive } from './watchdog.mjs'

function withTempRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-watchdog-'))
  const dir = path.join(root, '.agent-sync', 'state')
  try {
    return run(root, dir)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('isAlive: the current process is alive, pid 0/NaN is not', () => {
  assert.equal(isAlive(process.pid), true)
  assert.equal(isAlive(0), false)
  assert.equal(isAlive(Number.NaN), false)
})

test('check: an explicit STOP is respected (no restart)', () => {
  withTempRoot((root, dir) => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'STOP'), 'user')
    assert.equal(check(root, dir), 'stopped-by-user')
    assert.equal(fs.existsSync(path.join(dir, 'boss.log')), false)
  })
})

test('check: a live boss pid is left alone', () => {
  withTempRoot((root, dir) => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'boss.pid'), String(process.pid))
    assert.equal(check(root, dir), 'alive')
    assert.equal(fs.existsSync(path.join(dir, 'boss.log')), false)
  })
})
