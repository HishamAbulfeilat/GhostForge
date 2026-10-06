// T-218: JARVIS and mac-control must never use predictable temp file names
// (tmpdir() + Date.now(), hard-coded /tmp/…). They go through lib/private-temp,
// which uses mkdtemp dirs (0o700) and exclusive 0o600 files.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const POSIX = process.platform !== 'win32'
const libPath = path.resolve(__dirname, '../lib/private-temp.ts')

function loadTs(filePath) {
  const compiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = new Module(filePath, module)
  mod.filename = filePath
  mod.paths = Module._nodeModulePaths(path.dirname(filePath))
  mod._compile(compiled, filePath)
  return mod.exports
}

const pt = loadTs(libPath)

test('makePrivateTempDir creates a unique gfai- dir under tmpdir() only the owner can access', async () => {
  const a = await pt.makePrivateTempDir()
  const b = await pt.makePrivateTempDir()
  try {
    assert.notEqual(a, b)
    for (const dir of [a, b]) {
      assert.equal(path.dirname(dir), os.tmpdir())
      assert.match(path.basename(dir), /^gfai-.{6}$/)
      const s = fs.lstatSync(dir)
      assert.ok(s.isDirectory() && !s.isSymbolicLink())
      if (POSIX) assert.equal(s.mode & 0o777, 0o700)
    }
  } finally {
    fs.rmSync(a, { recursive: true, force: true })
    fs.rmSync(b, { recursive: true, force: true })
  }
})

test('writePrivateFile creates the file exclusively with mode 0o600 and rejects unsafe names', async () => {
  const dir = await pt.makePrivateTempDir()
  try {
    const p = await pt.writePrivateFile(dir, 'code.py', 'print(1)')
    assert.equal(p, path.join(dir, 'code.py'))
    assert.equal(fs.readFileSync(p, 'utf8'), 'print(1)')
    if (POSIX) assert.equal(fs.statSync(p).mode & 0o777, 0o600)

    // 'wx': an existing (possibly attacker-planted) file is never reused
    await assert.rejects(pt.writePrivateFile(dir, 'code.py', 'x'), { code: 'EEXIST' })

    for (const bad of ['../escape', 'a/b', 'a\\b', '.hidden', '', 'x'.repeat(65)]) {
      assert.throws(() => pt.privateTempPath(dir, bad), /Unsafe temp file name/, bad)
      await assert.rejects(pt.writePrivateFile(dir, bad, 'x'), /Unsafe temp file name/, bad)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('withPrivateTempDir removes the dir after success and after a throw', async () => {
  let seen
  const out = await pt.withPrivateTempDir(async dir => {
    seen = dir
    await pt.writePrivateFile(dir, 'a.txt', 'hi')
    return 42
  })
  assert.equal(out, 42)
  assert.equal(fs.existsSync(seen), false)

  await assert.rejects(pt.withPrivateTempDir(async dir => {
    seen = dir
    await pt.writePrivateFile(dir, 'b.txt', 'hi')
    throw new Error('boom')
  }), /boom/)
  assert.equal(fs.existsSync(seen), false)
})

test('sweepPrivateTemp removes old gfai- dirs/files, keeps fresh and foreign entries, never follows symlinks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-sweep-test-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-sweep-outside-'))
  try {
    const now = Date.now()
    const old = new Date(now - 2 * 3600_000)
    const mk = (name, isDir, size = 10) => {
      const p = path.join(root, name)
      if (isDir) {
        fs.mkdirSync(p)
        fs.writeFileSync(path.join(p, 'shot.png'), Buffer.alloc(size))
      } else {
        fs.writeFileSync(p, Buffer.alloc(size))
      }
      return p
    }
    const oldDir = mk('gfai-old111', true, 2048)
    const oldFile = mk('gfai-legacy-1.scpt', false, 100)
    const freshDir = mk('gfai-new222', true)
    const foreign = mk('other-app-file', false)
    fs.utimesSync(oldDir, old, old)
    fs.utimesSync(oldFile, old, old)
    fs.utimesSync(foreign, old, old)

    let link
    const target = path.join(outside, 'keep.txt')
    fs.writeFileSync(target, 'precious')
    if (POSIX) {
      link = path.join(root, 'gfai-link')
      fs.symlinkSync(outside, link)
      fs.lutimesSync(link, old, old)
    }

    const { cleared, freedBytes } = await pt.sweepPrivateTemp(3600_000, { root, now })
    assert.equal(cleared, POSIX ? 3 : 2)
    assert.equal(freedBytes, 2048 + 100)
    assert.equal(fs.existsSync(oldDir), false)
    assert.equal(fs.existsSync(oldFile), false)
    assert.equal(fs.existsSync(freshDir), true)
    assert.equal(fs.existsSync(foreign), true)
    if (POSIX) assert.equal(fs.existsSync(link), false)
    assert.equal(fs.readFileSync(target, 'utf8'), 'precious', 'symlink target must survive the sweep')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('JARVIS and mac-control routes use private temp dirs, not predictable /tmp names', () => {
  for (const rel of ['../app/api/jarvis/route.ts', '../app/api/mac-control/route.ts']) {
    const src = fs.readFileSync(path.resolve(__dirname, rel), 'utf8')
    assert.match(src, /from '@\/lib\/private-temp'/, `${rel} must use lib/private-temp`)
    assert.doesNotMatch(src, /[`'"]\/tmp\//, `${rel} must not hard-code /tmp paths`)
    assert.doesNotMatch(src, /\btmpdir\(\)/, `${rel} must not build paths from tmpdir() directly`)
    assert.doesNotMatch(src, /(gfai|gf-mac)-[^`'"\n]*\$\{(Date\.now\(\)|randomBytes|ts\b)/, `${rel} must not build time/random-based temp names`)
  }
  const jarvis = fs.readFileSync(path.resolve(__dirname, '../app/api/jarvis/route.ts'), 'utf8')
  assert.match(jarvis, /sweepPrivateTemp\(/, 'mac_cleanup must keep sweeping leftover gfai- temp dirs')
})
