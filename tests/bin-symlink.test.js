#!/usr/bin/env node
// npm installs the package bins as symlinks (npm i -g, npm link). The bin
// wrappers must resolve the link to find the repo, not the link's directory.

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim()

const symlinksWork = process.platform !== 'win32'

for (const name of ['ghostforge', 'gf']) {
  test(`bin/${name} runs through an npm-style symlink chain`, { skip: !symlinksWork && 'symlinks need POSIX' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bin-link-'))
    try {
      const globalBin = path.join(dir, 'bin')
      const nested = path.join(dir, 'lib', 'node_modules', '.bin')
      fs.mkdirSync(globalBin, { recursive: true })
      fs.mkdirSync(nested, { recursive: true })
      // Absolute link (npm i -g) and a relative link pointing at that link.
      fs.symlinkSync(path.join(ROOT, 'bin', name), path.join(nested, name))
      fs.symlinkSync(path.relative(globalBin, path.join(nested, name)), path.join(globalBin, name))

      for (const link of [path.join(nested, name), path.join(globalBin, name)]) {
        const result = spawnSync('bash', [link, '--version'], { cwd: dir, encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
        assert.equal(result.stdout.trim(), VERSION)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}
