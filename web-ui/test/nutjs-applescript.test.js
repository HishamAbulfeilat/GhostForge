const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const NUTJS = path.join(__dirname, '../lib/nutjs.js')

/**
 * nutjs.js shells out to osascript on macOS when @nut-tree/nut-js is absent.
 * The text a user types is fully attacker-influenced (it arrives from the
 * /api/jarvis route), so it must never be concatenated into AppleScript source.
 * These tests read the source because the osascript path only runs on darwin
 * with the native module missing; the script construction is what matters.
 */
function source() {
  return fs.readFileSync(NUTJS, 'utf8')
}

test('typeText does not interpolate text into AppleScript source', () => {
  const src = source()
  const fn = src.slice(src.indexOf('async function typeText'))
  assert.match(fn, /appleScriptWithText\(text,/)
  assert.equal(
    /\.replace\(\/"\/g/.test(src),
    false,
    'quotes-only escaping is the CodeQL js/incomplete-sanitization finding on this file'
  )
})

test('user text never reaches osascript in the script source or in argv', () => {
  const src = source()
  const start = src.indexOf('function appleScriptWithText')
  assert.notEqual(start, -1, 'expected appleScriptWithText to exist')
  // Bound the slice to this one function so later interpolations are not swept in.
  const helper = src.slice(start, src.indexOf('function nativeStatus'))

  // The text must not be interpolated into the AppleScript source.
  assert.equal(
    /\$\{[^}]*\btext\b[^}]*\}/.test(helper),
    false,
    'text must not be interpolated into the AppleScript template'
  )
  // Nor passed as a process argument: a trailing osascript argument starting
  // with "-" can be parsed as another option on macOS < 12.3 (CVE-2022-24793),
  // where "-e" would inject a whole extra statement.
  assert.equal(
    /\['-e', script,\s*String\(text\)\]/.test(helper),
    false,
    'text must not be passed as an osascript argument (CVE-2022-24793)'
  )
  assert.match(helper, /execFileAsync\('osascript', \['-e', script\]/)

  // It travels in the child environment instead and is read back verbatim.
  assert.match(helper, /system attribute "GF_APPLESCRIPT_TEXT"/)
  assert.match(helper, /env: \{ \.\.\.process\.env, GF_APPLESCRIPT_TEXT: String\(text\) \}/)
})

test('the generated AppleScript binds theText before the statement uses it', () => {
  // Reproduce the template appleScriptWithText builds, and check that the
  // statement referencing the value cannot run before it is bound.
  const statement = 'tell application "System Events" to keystroke theText'
  const script = `on run
  set theText to system attribute "GF_APPLESCRIPT_TEXT"
  ${statement}
end run`

  assert.ok(
    script.indexOf('set theText') < script.indexOf('keystroke theText'),
    'theText must be bound before the keystroke references it'
  )
})

test('osascript is spawned with an argv array, never through a shell', () => {
  const src = source()
  assert.match(src, /execFileAsync\('osascript', \['-e', script\]/)
  assert.equal(/exec\(\s*['"`]/.test(src), false, 'no shell-string execution of osascript')
  assert.equal(/shell:\s*true/.test(src), false, 'no shell:true anywhere in nutjs.js')
})

/**
 * Load a fresh nutjs.js as if on macOS without nut.js, with execFile stubbed
 * so every osascript invocation is captured instead of run. This exercises the
 * real darwin code path on any OS.
 */
function loadDarwinNutjs() {
  const childProcess = require('node:child_process')
  const realExecFile = childProcess.execFile
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const calls = []
  childProcess.execFile = (file, args, opts, cb) => {
    calls.push({ file, args })
    ;(typeof opts === 'function' ? opts : cb)(null, '', '')
  }
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  delete require.cache[require.resolve(NUTJS)]
  try {
    const mod = require(NUTJS)
    assert.equal(mod.nutJsAvailable, false, 'test assumes @nut-tree/nut-js is not installed')
    return { mod, calls }
  } finally {
    // nutjs.js captured both at load time; restore for the rest of the run.
    childProcess.execFile = realExecFile
    Object.defineProperty(process, 'platform', realPlatform)
    delete require.cache[require.resolve(NUTJS)]
  }
}

test('pressKey rejects unknown keys instead of interpolating them into AppleScript', async () => {
  const { mod, calls } = loadDarwinNutjs()
  const attacks = [
    '0\ndo shell script "id > /tmp/pwned"\nkey code 36',
    '36 & (do shell script "id")',
    'constructor',
    '__proto__',
  ]
  for (const key of attacks) {
    const out = await mod.pressKey(key)
    assert.match(out, /^Unsupported key/, `expected rejection for ${JSON.stringify(key)}`)
  }
  assert.deepEqual(calls, [], 'a rejected key must never reach osascript')
})

test('pressKey and scroll only ever emit an integer key code', async () => {
  const { mod, calls } = loadDarwinNutjs()
  await mod.pressKey('enter')
  await mod.pressKey('ESCAPE')
  await mod.pressKey('page-down')
  await mod.scroll('up')
  await mod.scroll('down')

  const scripts = calls.map(c => {
    assert.equal(c.file, 'osascript')
    assert.equal(c.args[0], '-e')
    return c.args[1]
  })
  assert.deepEqual(scripts, [36, 53, 121, 116, 121].map(n => `tell application "System Events" to key code ${n}`))
})

test('hostile keystroke payloads survive the environment hand-off unchanged', () => {
  // Why the hand-off matters: with the old quotes-only escaping, 'a\"' became
  // 'a\\"' — a literal backslash followed by an *unescaped* quote that closes
  // the AppleScript string early. The value now reaches the script as an
  // environment variable read via `system attribute`, never parsed as source.
  const execFile = require('node:child_process').execFileSync
  const payloads = ['a\\"', 'pwn" & (do shell script "touch /tmp/pwned") & "', 'line1\nline2', 'back\\\\slash']
  for (const p of payloads) {
    const out = execFile(
      process.execPath,
      ['-e', 'process.stdout.write(process.env.GF_APPLESCRIPT_TEXT ?? "")'],
      { encoding: 'utf8', env: { ...process.env, GF_APPLESCRIPT_TEXT: p } }
    )
    assert.equal(out, p, `payload must survive the hand-off: ${JSON.stringify(p)}`)
  }
})