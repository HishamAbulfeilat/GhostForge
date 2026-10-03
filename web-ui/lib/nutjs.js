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
try {
  nut = require('@nut-tree/nut-js')
} catch (e) {
  nutError = e && e.code === 'MODULE_NOT_FOUND'
    ? 'not-installed'
    : (e && e.message) || 'load-failed'
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

async function pressKey(key) {
  const keys = { enter: 'Return', tab: 'Tab', escape: 'Escape', space: 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right' }
  if (nut) {
    await nut.keyboard.pressKey(nut.Key[key.toUpperCase()] || nut.Key.Space)
    await nut.keyboard.releaseKey(nut.Key[key.toUpperCase()] || nut.Key.Space)
    return `Pressed ${key} via nut.js`
  }
  if (darwin) {
    const k = keys[key.toLowerCase()] || key
    await appleScript(`tell application "System Events" to key code ${keyCodeFor(k)}`)
    return `Pressed ${k}`
  }
  return 'Key press not supported on this platform without nut.js'
}

function keyCodeFor(key) {
  const map = { Return: 36, Tab: 48, Escape: 53, Space: 49, Up: 126, Down: 125, Left: 123, Right: 124 }
  return map[key] ?? key
}

async function scroll(direction, amount = 3) {
  if (nut) {
    if (direction === 'up') await nut.mouse.scrollUp(amount)
    else await nut.mouse.scrollDown(amount)
    return `Scrolled ${direction} ${amount} via nut.js`
  }
  if (darwin) {
    const key = direction === 'up' ? 'Page Up' : 'Page Down'
    await appleScript(`tell application "System Events" to key code ${keyCodeFor(key)}`)
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