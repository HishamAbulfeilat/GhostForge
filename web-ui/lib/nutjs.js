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
 * Send `text` to AppleScript as a *script argument* instead of interpolating
 * it into the source. osascript forwards trailing argv to the script's
 * `on run argv` handler as an already-decoded string, so quotes, backslashes
 * and newlines in `text` are never parsed as AppleScript source — no escaping
 * is needed, and none can be done wrong.
 *
 * `quoteInScript` places the value into the statement; it must reference
 * `theText`, which is bound to argv item 1.
 */
function appleScriptWithText(text, quoteInScript) {
  const script = `on run argv
  set theText to item 1 of argv
  ${quoteInScript}
end run`
  return execFileAsync('osascript', ['-e', script, String(text)], { timeout: 8000 })
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