// /api/files path policy (lib/file-access.ts): non-admins are confined to the
// workspace root, never see dotfiles or credential stores, and symlinks can't
// lead outside the root.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw err
    }
  },
})

const fa = require('../lib/file-access.ts')

const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'gf-files-')))
const root = join(home, 'GhostForge')
const outside = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'gf-outside-')))
fs.mkdirSync(join(root, 'web-ui'), { recursive: true })
fs.mkdirSync(join(root, '.git'), { recursive: true })
fs.mkdirSync(join(home, '.ghostforge', 'bridge'), { recursive: true })
fs.mkdirSync(join(home, '.ssh'), { recursive: true })
fs.writeFileSync(join(root, 'README.md'), 'hello')
fs.writeFileSync(join(root, 'web-ui', '.env.local'), 'AUTH_SECRET=x')
fs.writeFileSync(join(root, '.git', 'config'), '[core]')
fs.writeFileSync(join(home, '.ghostforge', 'users.json'), '{"users":[]}')
fs.writeFileSync(join(home, '.ssh', 'id_ed25519'), 'key')
fs.writeFileSync(join(home, 'notes.txt'), 'notes')
fs.writeFileSync(join(outside, 'secret.txt'), 'outside')
const canSymlink = (() => {
  try {
    fs.symlinkSync(join(home, '.ssh'), join(root, 'ssh-link'))
    fs.symlinkSync(outside, join(root, 'outside-link'))
    fs.symlinkSync(join(outside, 'secret.txt'), join(root, 'secret-link.txt'))
    return true
  } catch { return false }
})()

const user = { admin: false, home, env: {} }
const admin = { admin: true, home, env: {} }

test.after(() => {
  hooks.deregister()
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

test('a non-admin can read inside the workspace root', () => {
  assert.equal(fa.resolveReadPath('~/GhostForge/README.md', user), join(root, 'README.md'))
  assert.equal(fa.resolveReadPath('~/GhostForge', user), root)
  assert.equal(fa.defaultFilesPath(user), root)
})

test('a non-admin cannot reach credential stores or other home files', () => {
  for (const p of ['~/.ghostforge/users.json', '~/.ghostforge/bridge', '~/.ssh/id_ed25519', '~/notes.txt', '~', `${root}/../.ghostforge/users.json`]) {
    assert.throws(() => fa.resolveReadPath(p, user), fa.FileAccessError, p)
  }
})

test('a non-admin cannot read dotfiles or dot-folders inside the root', () => {
  assert.throws(() => fa.resolveReadPath('~/GhostForge/web-ui/.env.local', user), /hidden/)
  assert.throws(() => fa.resolveReadPath('~/GhostForge/.git/config', user), /hidden/)
  assert.equal(fa.isListable('.env', user), false)
  assert.equal(fa.isListable('.gitignore', user), false)
  assert.equal(fa.isListable('README.md', user), true)
})

test('credential stores stay denied even when GF_FILES_ROOT is the home folder', () => {
  const wide = { admin: false, home, env: { GF_FILES_ROOT: '~' } }
  assert.equal(fa.resolveReadPath('~/notes.txt', wide), join(home, 'notes.txt'))
  assert.throws(() => fa.resolveReadPath('~/.ghostforge/users.json', wide), fa.FileAccessError)
  assert.throws(() => fa.resolveReadPath('~/.ssh/id_ed25519', wide), fa.FileAccessError)
  assert.throws(() => fa.resolveWritePath('~/.ghostforge/users.json', wide), fa.FileAccessError)
})

test('symlinks inside the root cannot lead outside it', { skip: !canSymlink && 'symlinks unavailable' }, () => {
  assert.throws(() => fa.resolveReadPath('~/GhostForge/ssh-link/id_ed25519', user), fa.FileAccessError)
  assert.throws(() => fa.resolveReadPath('~/GhostForge/outside-link/secret.txt', user), fa.FileAccessError)
  assert.throws(() => fa.resolveReadPath('~/GhostForge/secret-link.txt', user), fa.FileAccessError)
  assert.throws(() => fa.resolveWritePath('~/GhostForge/outside-link/new.txt', user), fa.FileAccessError)
  // Admins are confined to home, also after resolving symlinks
  assert.throws(() => fa.resolveReadPath('~/GhostForge/outside-link/secret.txt', admin), fa.FileAccessError)
})

test('writes never go through a symlink at the final component', { skip: !canSymlink && 'symlinks unavailable' }, () => {
  assert.throws(() => fa.resolveWritePath('~/GhostForge/secret-link.txt', admin), /symlink|outside/)
  assert.equal(fs.readFileSync(join(outside, 'secret.txt'), 'utf8'), 'outside')
})

test('a non-admin can write a new file in the root, but not outside or to a dotfile', () => {
  const target = fa.resolveWritePath('~/GhostForge/new-file.txt', user)
  assert.equal(target, join(root, 'new-file.txt'))
  fa.writeFileNoFollow(target, 'written')
  assert.equal(fs.readFileSync(join(root, 'new-file.txt'), 'utf8'), 'written')
  assert.throws(() => fa.resolveWritePath('~/.zshrc', user), fa.FileAccessError)
  assert.throws(() => fa.resolveWritePath('~/GhostForge/.env', user), /hidden/)
  assert.throws(() => fa.resolveWritePath('~/.ssh/authorized_keys', user), fa.FileAccessError)
  assert.throws(() => fa.resolveWritePath('~/GhostForge/missing-dir/x.txt', user), /not found/i)
})

test('admins keep the home folder (the Projects page links projects there) but not beyond', () => {
  assert.equal(fa.resolveReadPath('~/notes.txt', admin), join(home, 'notes.txt'))
  assert.equal(fa.isListable('.env', admin), true)
  assert.throws(() => fa.resolveReadPath(join(outside, 'secret.txt'), admin), fa.FileAccessError)
})

test('relative and malformed paths are handled safely', () => {
  assert.equal(fa.resolveReadPath('README.md', user), join(root, 'README.md'))
  assert.throws(() => fa.resolveReadPath('../notes.txt', user), fa.FileAccessError)
  assert.throws(() => fa.resolveReadPath('', user), fa.FileAccessError)
  assert.throws(() => fa.resolveReadPath('~/GhostForge/\0x', user), fa.FileAccessError)
})
