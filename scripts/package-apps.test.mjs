import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PLATFORMS, buildCommand, parseArgs, run } from './package-apps.mjs'

const pkg = JSON.parse(readFileSync(new URL('../electron-app/package.json', import.meta.url), 'utf8'))

test('every platform maps to an existing electron-app npm script', () => {
  for (const [platform, script] of Object.entries(PLATFORMS)) {
    assert.ok(pkg.scripts[script], `${platform} -> ${script} missing from electron-app/package.json`)
  }
  assert.deepEqual(Object.keys(PLATFORMS).sort(), ['android', 'linux', 'mac', 'win'])
})

test('parseArgs allowlists platforms and rejects bad input', () => {
  assert.deepEqual(parseArgs(['mac', '--dry-run']), { platform: 'mac', dryRun: true })
  assert.deepEqual(parseArgs(['win']), { platform: 'win', dryRun: false })
  assert.throws(() => parseArgs(['macos']), /Unknown platform/)
  assert.throws(() => parseArgs(['windows']), /Unknown platform/)
  assert.throws(() => parseArgs(['__proto__']), /Unknown platform/)
  assert.throws(() => parseArgs([]), /Missing platform/)
  assert.throws(() => parseArgs(['mac', 'win']), /Unexpected argument/)
  assert.throws(() => parseArgs(['mac', '--x']), /Unknown option/)
  assert.deepEqual(parseArgs(['--help']), { help: true })
})

test('buildCommand targets electron-app with fixed args', () => {
  const { args, cwd } = buildCommand('linux')
  assert.deepEqual(args, ['run', 'build:linux'])
  assert.match(cwd.replaceAll('\\', '/'), /electron-app$/)
})

test('--dry-run prints the command and does not spawn', () => {
  const logs = []
  const code = run(['android', '--dry-run'], {
    spawn: () => assert.fail('must not spawn'), log: (m) => logs.push(m),
  })
  assert.equal(code, 0)
  assert.match(logs[0], /\[dry-run\].*npm(\.cmd)? run build:android/)
})

test('run spawns with a timeout and propagates exit status', () => {
  let seen
  const code = run(['win'], {
    spawn: (cmd, args, opts) => { seen = { args, opts }; return { status: 3 } }, log: () => {},
  })
  assert.equal(code, 3)
  assert.deepEqual(seen.args, ['run', 'build:win'])
  assert.ok(seen.opts.timeout > 0)
})
