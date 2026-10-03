import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { isBlockedName, listDir, readFile } from '../files.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const cli = path.join(repo, 'cli', 'index.js')

function project() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-files-')))
  fs.mkdirSync(path.join(dir, 'src'))
  fs.mkdirSync(path.join(dir, '.git'))
  fs.mkdirSync(path.join(dir, 'node_modules'))
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello')
  fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'abc')
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1')
  fs.writeFileSync(path.join(dir, '.git', 'config'), 'x')
  return dir
}

test('lists a directory and hides blocked entries', () => {
  const dir = project()
  const names = listDir(dir).map(e => e.name)
  assert.deepEqual(names, ['src', 'README.md'])
  assert.equal(listDir(dir).find(e => e.name === 'README.md').size, 5)
})

test('reads a file and enforces the size cap', () => {
  const dir = project()
  assert.deepEqual(readFile(dir, 'src/a.txt'), { content: 'abc', size: 3, truncated: false })
  const r = readFile(dir, 'README.md', 2)
  assert.equal(r.content, 'he')
  assert.equal(r.truncated, true)
})

test('rejects path traversal', () => {
  const dir = project()
  assert.throws(() => readFile(dir, '../outside.txt'), /escapes/)
  assert.throws(() => listDir(dir, '..'), /escapes/)
  assert.throws(() => readFile(dir, path.resolve(dir, '..', 'x')), /escapes/)
})

test('rejects symlink escape', t => {
  const dir = project()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-out-'))
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope')
  try {
    fs.symlinkSync(outside, path.join(dir, 'link'), 'junction')
  } catch {
    return t.skip('symlinks unavailable')
  }
  assert.throws(() => readFile(dir, 'link/secret.txt'), /symlink/)
  assert.throws(() => listDir(dir, 'link'), /symlink/)
})

test('blocks .git, node_modules and .env* in any case or Windows variant', () => {
  const dir = project()
  for (const p of ['.env', '.ENV', '.Env.local', '.env.', '.env ', '.env::$DATA', '.GIT/config', '.git/config', 'node_modules', 'NODE_MODULES/x', 'src/../.env']) {
    assert.throws(() => readFile(dir, p), /not allowed/, p)
  }
  assert.equal(isBlockedName('ENV~1'), true)
  assert.equal(isBlockedName('environment.md'), false)
  assert.equal(isBlockedName('envelope.txt'), false)
})

test('blocks a symlink that points at a blocked file', t => {
  const dir = project()
  try {
    fs.symlinkSync(path.join(dir, '.env'), path.join(dir, 'innocent.txt'))
  } catch {
    return t.skip('symlinks unavailable')
  }
  assert.throws(() => readFile(dir, 'innocent.txt'), /not allowed/)
})

test('CLI entrypoint defaults the root to the caller cwd, not the install dir', () => {
  const dir = project()
  const run = (...args) => spawnSync(process.execPath, [cli, 'files', ...args], { cwd: dir, encoding: 'utf8' })
  const list = run('list')
  assert.equal(list.status, 0, list.stderr)
  assert.match(list.stdout, /README\.md/)
  assert.doesNotMatch(list.stdout, /cli\//)
  assert.equal(run('read', 'src/a.txt').stdout, 'abc')
  const denied = run('read', '.ENV')
  assert.notEqual(denied.status, 0)
  assert.doesNotMatch(denied.stdout, /SECRET/)
  assert.notEqual(run('read', '../x').status, 0)
})
