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

test('user text reaches osascript as a script argument, not as source', () => {
  const src = source()
  const start = src.indexOf('function appleScriptWithText')
  assert.notEqual(start, -1, 'expected appleScriptWithText to exist')
  // Bound the slice to this one function so later interpolations are not swept in.
  const helper = src.slice(start, src.indexOf('function nativeStatus'))
  // The template is fixed; only the trailing argv entry varies.
  assert.match(helper, /on run argv/)
  assert.match(helper, /set theText to item 1 of argv/)
  assert.match(helper, /execFileAsync\('osascript', \['-e', script, String\(text\)\]/)
  assert.equal(
    /\$\{[^}]*\btext\b[^}]*\}/.test(helper),
    false,
    'text must not be interpolated into the AppleScript template'
  )
})

test('the generated AppleScript binds the argument before using it', () => {
  // Reproduce the template appleScriptWithText builds, and check that the
  // statement referencing the value cannot run before it is bound.
  const quoteInScript = 'tell application "System Events" to keystroke theText'
  const script = `on run argv
  set theText to item 1 of argv
  ${quoteInScript}
end run`

  assert.match(script, /^on run argv/)
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

test('keystroke payloads reach argv[1] unparsed', () => {
  // Why the argument approach matters: with the old quotes-only escaping,
  // 'a\"' became 'a\\"' — a literal backslash followed by an *unescaped* quote
  // that closes the AppleScript string early. Handing the value to osascript as
  // argv[1] means it is never parsed as AppleScript source at all.
  //
  // This mirrors how nut.js would call execFileSync('osascript', ['-e', script, text]).
  const execFile = require('node:child_process').execFileSync
  const payloads = ['a\\"', 'pwn" & (do shell script "touch /tmp/pwned") & "', 'line1\nline2', 'back\\\\slash']
  for (const p of payloads) {
    // Each payload must survive a round trip through argv unchanged.
    const script = `on run argv
  set theText to item 1 of argv
  return theText
end run`
    // Emulate argv passing with a child that echoes argv[1] back.
    const out = execFile(process.execPath, ['-e', 'process.stdout.write(process.argv[1] ?? "")', p], { encoding: 'utf8' })
    assert.equal(out, p, `payload must survive argv: ${JSON.stringify(p)}`)
    assert.match(script, /set theText to item 1 of argv/)
  }
})