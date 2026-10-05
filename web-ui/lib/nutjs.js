/**
 * Native desktop automation via nut.js (@nut-tree/nut-js) when installed,
 * falling back to AppleScript / cliclick so nothing breaks without it.
 *
 * nut.js is an OPTIONAL dependency — install with:
 *   cd web-ui && npm i @nut-tree/nut-js   (native bindings, ~needs Node 20+)
 *
 * This module is a .js file so the lazy require is invisible to the TS
 * typechecker (the package is not in dependencies).
 */

'use strict'

const { execFileSync, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)

let nut = null
let nutError = null
// The maintained open-source build is @nut-tree-fork/nut-js; the original package is accepted too.
// Each literal require() sits directly in a try so a missing package is a build warning, not an error.
const loadError = e => (e && e.code === 'MODULE_NOT_FOUND' ? 'not-installed' : (e && e.message) || 'load-failed')
try {
  nut = require('@nut-tree-fork/nut-js')
} catch {
  try {
    nut = require('@nut-tree/nut-js')
  } catch (e) {
    nutError = loadError(e)
  }
}

const darwin = process.platform === 'darwin'

function appleScript(script) {
  return execFileAsync('osascript', ['-e', script], { timeout: 8000 })
}

/**
 * Send `text` to AppleScript without ever putting it in the script source *or*
 * in the process argument list.
 *
 * Why not argv: passing the value after `-e` looks safe because osascript
 * stops looking for a program file once `-e` is given, but on macOS before
 * 12.3 a trailing argument beginning with `-` could still be parsed as another
 * option — `-e` in particular, which injects a whole extra AppleScript
 * statement (CVE-2022-24793). An end-of-options separator is the documented
 * mitigation but its handling is not in the man page, so the value is kept
 * out of argv entirely.
 *
 * Instead the text rides in the child environment and the script reads it back
 * with `system attribute`, which returns the value verbatim. Nothing to
 * escape, nothing to parse, and it is less visible than argv (macOS `ps`
 * exposes other processes' arguments to the same user).
 *
 * `statement` must reference `theText`; it runs inside a bare `run` handler.
 */
function appleScriptWithText(text, statement) {
  const script = `on run
  set theText to system attribute "GF_APPLESCRIPT_TEXT"
  ${statement}
end run`
  return execFileAsync('osascript', ['-e', script], {
    timeout: 8000,
    env: { ...process.env, GF_APPLESCRIPT_TEXT: String(text) },
  })
}

/** Human-readable status: whether nut.js is active and why not. */
function nativeStatus() {
  return {
    nutJs: !!nut,
    reason: nutError || null,
    fallback: darwin ? 'AppleScript' : 'no-op',
    platform: process.platform,
  }
}

async function moveMouse(x, y) {
  if (nut) {
    await nut.mouse.move(new nut.Point(x, y))
    return `Moved cursor to (${x}, ${y}) via nut.js`
  }
  if (darwin) {
    await appleScript(`tell application "System Events" to set position of first process whose frontmost is true to {${x}, ${y}}`)
    // Use cliclick when present for a real cursor move
    try {
      await execFileAsync('cliclick', [`m:${x},${y}`], { timeout: 3000 })
      return `Moved cursor to (${x}, ${y}) via cliclick`
    } catch {
      return `Requested cursor move to (${x}, ${y}) — install cliclick for native moves`
    }
  }
  return 'Mouse move not supported on this platform without nut.js'
}

async function click(x, y, button = 'left') {
  if (nut) {
    await nut.mouse.setPosition(new nut.Point(x, y))
    await nut.mouse.click(nut.Button[button === 'right' ? 'RIGHT' : 'LEFT'])
    return `Clicked ${button} at (${x}, ${y}) via nut.js`
  }
  if (darwin) {
    try {
      const b = button === 'right' ? 'right' : 'left'
      await execFileAsync('cliclick', [`c:${b === 'right' ? 'rc' : 'c'}:${x},${y}`], { timeout: 3000 })
      return `Clicked ${button} at (${x}, ${y}) via cliclick`
    } catch {
      return `Requested click at (${x}, ${y}) — install cliclick for native clicks`
    }
  }
  return 'Click not supported on this platform without nut.js'
}

async function typeText(text) {
  if (nut) {
    await nut.keyboard.type(text)
    return `Typed "${text.slice(0, 40)}" via nut.js`
  }
  if (darwin) {
    await appleScriptWithText(text, 'tell application "System Events" to keystroke theText')
    return `Typed "${text.slice(0, 40)}"`
  }
  return 'Typing not supported on this platform without nut.js'
}

// AppleScript key codes. This table is the whole allow-list: a key that is not
// in it is rejected, never interpolated into the script source. The key name
// arrives unvalidated from /api/jarvis, and a newline in it would otherwise
// start a second AppleScript statement (`tell … to` governs only the first).
const KEY_CODES = {
  enter: 36, return: 36, tab: 48, escape: 53, space: 49,
  up: 126, down: 125, left: 123, right: 124, pageup: 116, pagedown: 121,
}

/** The integer key code for a key name, or null when it is not allow-listed. */
function keyCodeFor(key) {
  const name = String(key ?? '').toLowerCase().replace(/[\s_-]/g, '')
  return Object.prototype.hasOwnProperty.call(KEY_CODES, name) ? KEY_CODES[name] : null
}

// nut.js Key enum members are PascalCase (Enter, Escape, PageUp…). The old
// lookup used key.toUpperCase() ("ENTER"), which never matched, so every key
// was silently pressed as Space.
const NUT_KEYS = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', space: 'Space',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', pageup: 'PageUp', pagedown: 'PageDown',
  backspace: 'Backspace', delete: 'Delete', home: 'Home', end: 'End',
}

async function pressKey(key) {
  if (nut) {
    const k = String(key ?? '').toLowerCase().replace(/[\s_-]/g, '')
    const name = Object.hasOwn(NUT_KEYS, k) ? NUT_KEYS[k] : undefined
    const nutKey = name ? nut.Key[name] : undefined
    if (nutKey === undefined) return `Unsupported key. Use one of: ${Object.keys(NUT_KEYS).join(', ')}`
    await nut.keyboard.pressKey(nutKey)
    await nut.keyboard.releaseKey(nutKey)
    return `Pressed ${key} via nut.js`
  }
  if (darwin) {
    const code = keyCodeFor(key)
    if (code === null) return `Unsupported key. Use one of: ${Object.keys(KEY_CODES).join(', ')}`
    await appleScript(`tell application "System Events" to key code ${code}`)
    return `Pressed ${String(key).toLowerCase()}`
  }
  return 'Key press not supported on this platform without nut.js'
}

async function scroll(direction, amount = 3) {
  if (nut) {
    if (direction === 'up') await nut.mouse.scrollUp(amount)
    else await nut.mouse.scrollDown(amount)
    return `Scrolled ${direction} ${amount} via nut.js`
  }
  if (darwin) {
    // 'Page Up' was never in the old table, so this used to emit the invalid
    // `key code Page Up`; both names are allow-listed now.
    await appleScript(`tell application "System Events" to key code ${keyCodeFor(direction === 'up' ? 'pageup' : 'pagedown')}`)
    return `Scrolled ${direction}`
  }
  return 'Scroll not supported on this platform without nut.js'
}

module.exports = {
  nativeStatus,
  moveMouse,
  click,
  typeText,
  pressKey,
  scroll,
  nutJsAvailable: !!nut,
}