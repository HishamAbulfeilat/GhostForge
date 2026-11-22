// Self-updater git steps against a real temporary repository (no Electron):
// rollback restores the pre-update HEAD and pops only the updater's own stash.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  findStashRef,
  pullFastForward,
  rollbackUpdate,
  snapshotBeforeUpdate,
} from '../src/main/update-git.ts'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1', HOME: tmpdir(),
}
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim()

/** origin (bare) with main at A, a clone at A, then origin advanced to B. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'gf-update-git-'))
  const origin = join(dir, 'origin.git')
  const seed = join(dir, 'seed')
  const clone = join(dir, 'clone')
  sh(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  sh(dir, 'clone', '-q', origin, seed)
  writeFileSync(join(seed, 'app.txt'), 'v1\n')
  sh(seed, 'add', '.'); sh(seed, 'commit', '-q', '-m', 'A'); sh(seed, 'push', '-q', 'origin', 'HEAD:main')
  sh(dir, 'clone', '-q', '-b', 'main', origin, clone)
  writeFileSync(join(seed, 'app.txt'), 'v2\n')
  sh(seed, 'commit', '-q', '-am', 'B'); sh(seed, 'push', '-q', 'origin', 'HEAD:main')
  const git = async args => ({ stdout: execFileSync('git', args, { cwd: clone, env: GIT_ENV, encoding: 'utf8' }) })
  return { dir, clone, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('clean tree: rollback after a successful pull restores HEAD and never pops an unrelated stash', async () => {
  const { clone, git, cleanup } = setup()
  try {
    // An older, unrelated stash the user keeps around.
    writeFileSync(join(clone, 'app.txt'), 'user experiment\n')
    sh(clone, 'stash', 'push', '-q', '-m', 'my experiment')
    const before = sh(clone, 'rev-parse', 'HEAD')

    const snapshot = await snapshotBeforeUpdate(git, 'ghostforge-auto-update-test-1')
    assert.equal(snapshot.head, before)
    assert.equal(snapshot.stashMessage, null, 'a clean tree creates no stash')

    await pullFastForward(git)
    assert.equal(readFileSync(join(clone, 'app.txt'), 'utf8'), 'v2\n')
    assert.notEqual(sh(clone, 'rev-parse', 'HEAD'), before)

    // install/build failed → rollback
    await rollbackUpdate(git, snapshot)
    assert.equal(sh(clone, 'rev-parse', 'HEAD'), before, 'HEAD is back on the pre-update commit')
    assert.equal(readFileSync(join(clone, 'app.txt'), 'utf8'), 'v1\n')
    assert.match(sh(clone, 'stash', 'list'), /my experiment/, 'the unrelated stash is untouched')
  } finally {
    cleanup()
  }
})

test('dirty tree: local changes are stashed under a unique message and restored on rollback', async () => {
  const { clone, git, cleanup } = setup()
  try {
    sh(clone, 'stash', 'list') // none yet
    writeFileSync(join(clone, 'other.txt'), 'older\n')
    sh(clone, 'stash', 'push', '-q', '--include-untracked', '-m', 'older stash')
    writeFileSync(join(clone, 'notes.txt'), 'local work\n')
    const before = sh(clone, 'rev-parse', 'HEAD')

    const snapshot = await snapshotBeforeUpdate(git, 'ghostforge-auto-update-test-2')
    assert.equal(snapshot.stashMessage, 'ghostforge-auto-update-test-2')
    assert.equal(existsSync(join(clone, 'notes.txt')), false)
    assert.ok(await findStashRef(git, 'ghostforge-auto-update-test-2'))

    await pullFastForward(git)
    await rollbackUpdate(git, snapshot)

    assert.equal(sh(clone, 'rev-parse', 'HEAD'), before)
    assert.equal(readFileSync(join(clone, 'notes.txt'), 'utf8'), 'local work\n')
    assert.equal(existsSync(join(clone, 'other.txt')), false, 'the older stash was not applied')
    const stashes = sh(clone, 'stash', 'list')
    assert.match(stashes, /older stash/)
    assert.doesNotMatch(stashes, /ghostforge-auto-update-test-2/)
  } finally {
    cleanup()
  }
})

test('pull is fast-forward only', async () => {
  const { clone, git, cleanup } = setup()
  try {
    writeFileSync(join(clone, 'local.txt'), 'diverge\n')
    sh(clone, 'add', '.'); sh(clone, 'commit', '-q', '-m', 'local commit')
    await assert.rejects(pullFastForward(git))
    assert.equal(sh(clone, 'log', '-1', '--format=%s'), 'local commit', 'no merge commit was created')
  } finally {
    cleanup()
  }
})

test('self-updater uses the snapshot/rollback helpers instead of a bare stash pop', () => {
  const src = readFileSync(new URL('../src/main/self-updater.ts', import.meta.url), 'utf8')
  assert.match(src, /snapshotBeforeUpdate\(this\.git\)/)
  assert.match(src, /rollbackUpdate\(this\.git, snapshot\)/)
  assert.match(src, /pullFastForward\(this\.git\)/)
  assert.doesNotMatch(src, /git stash pop'/)
  assert.doesNotMatch(src, /'git pull origin main'/)
})
