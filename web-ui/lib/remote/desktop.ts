/**
 * Remote desktop: capture this machine's screen and drive its mouse/keyboard
 * from a paired phone or another computer. Cross-platform (Windows, macOS,
 * Linux) through two optional packages, loaded lazily so nothing breaks
 * without them:
 *
 *   screenshot-desktop             screen capture (JPEG)
 *   @nut-tree-fork/nut-js          mouse + keyboard (or the original @nut-tree/nut-js)
 *
 * Coordinates arrive as fractions of the screen (0..1), so the phone never
 * needs to know the laptop's resolution or DPI scaling.
 */
import { createRequire } from 'module'

// Resolved at runtime (not bundled): both packages are optional native/OS helpers.
const req: NodeRequire = (() => {
  try { return (0, eval)('require') as NodeRequire } catch { return createRequire(`${process.cwd()}/`) }
})()

type Nut = {
  mouse: { setPosition(p: unknown): Promise<unknown>; click(b: unknown): Promise<unknown>; doubleClick(b: unknown): Promise<unknown>; scrollUp(n: number): Promise<unknown>; scrollDown(n: number): Promise<unknown>; config?: { mouseSpeed: number } }
  keyboard: { type(...t: unknown[]): Promise<unknown>; pressKey(...k: unknown[]): Promise<unknown>; releaseKey(...k: unknown[]): Promise<unknown>; config?: { autoDelayMs: number } }
  screen: { width(): Promise<number>; height(): Promise<number> }
  Point: new (x: number, y: number) => unknown
  Button: Record<string, unknown>
  Key: Record<string, unknown>
}
type Shot = (opts?: { format?: 'jpg' | 'png'; screen?: string | number }) => Promise<Buffer>

let nut: Nut | null | undefined
let shot: Shot | null | undefined

function loadNut(): Nut | null {
  if (nut !== undefined) return nut
  for (const name of ['@nut-tree-fork/nut-js', '@nut-tree/nut-js']) {
    try {
      nut = req(name) as Nut
      if (nut.keyboard.config) nut.keyboard.config.autoDelayMs = 0
      if (nut.mouse.config) nut.mouse.config.mouseSpeed = 4000
      return nut
    } catch { /* try the next */ }
  }
  nut = null
  return nut
}

function loadShot(): Shot | null {
  if (shot !== undefined) return shot
  try { shot = req('screenshot-desktop') as Shot } catch { shot = null }
  return shot
}

export function desktopSupport() {
  return {
    capture: Boolean(loadShot()),
    control: Boolean(loadNut()),
    platform: process.platform,
    install: 'cd web-ui && npm i screenshot-desktop @nut-tree-fork/nut-js',
  }
}

/** JPEG width/height from its SOF marker (no image library needed). */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return null
}

export async function captureScreen(): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const s = loadShot()
  if (!s) throw Object.assign(new Error('Screen capture needs the screenshot-desktop package (cd web-ui && npm i screenshot-desktop).'), { status: 501 })
  const jpeg = await s({ format: 'jpg' })
  const size = jpegSize(jpeg) || { width: 0, height: 0 }
  return { jpeg, ...size }
}

/** Friendly key names → nut.js Key enum members. This table is the whole allow-list. */
const KEYS: Record<string, string> = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', space: 'Space',
  backspace: 'Backspace', delete: 'Delete', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  ctrl: 'LeftControl', control: 'LeftControl', shift: 'LeftShift', alt: 'LeftAlt', option: 'LeftAlt',
  cmd: 'LeftSuper', meta: 'LeftSuper', win: 'LeftSuper', super: 'LeftSuper',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `F${i + 1}`])),
  ...Object.fromEntries('abcdefghijklmnopqrstuvwxyz'.split('').map(c => [c, c.toUpperCase()])),
  ...Object.fromEntries('0123456789'.split('').map(d => [d, `Num${d}`])),
}

/** Resolve "ctrl+shift+t" style combos to nut.js keys, or null if any part is not allowed. */
export function resolveKeys(combo: string, keyEnum: Record<string, unknown>): unknown[] | null {
  const parts = String(combo || '').toLowerCase().split('+').map(p => p.trim()).filter(Boolean)
  if (!parts.length || parts.length > 4) return null
  // Own properties only: "constructor" or "__proto__" must not resolve through Object.prototype
  const keys = parts.map(p => (Object.hasOwn(KEYS, p) ? keyEnum[KEYS[p]] : undefined))
  return keys.every(k => k !== undefined) ? keys : null
}

export type DesktopInput =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right'; double?: boolean }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; direction: 'up' | 'down'; amount?: number }

const frac = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null)

/** Apply one input from a remote device. Coordinates are fractions of the screen. */
export async function sendInput(input: DesktopInput): Promise<string> {
  const n = loadNut()
  if (!n) throw Object.assign(new Error('Mouse/keyboard control needs @nut-tree-fork/nut-js (cd web-ui && npm i @nut-tree-fork/nut-js).'), { status: 501 })
  switch (input.type) {
    case 'click': {
      const fx = frac(input.x), fy = frac(input.y)
      if (fx === null || fy === null) throw Object.assign(new Error('x and y must be numbers between 0 and 1'), { status: 400 })
      const [w, h] = await Promise.all([n.screen.width(), n.screen.height()])
      await n.mouse.setPosition(new n.Point(Math.round(fx * (w - 1)), Math.round(fy * (h - 1))))
      const button = n.Button[input.button === 'right' ? 'RIGHT' : 'LEFT']
      await (input.double ? n.mouse.doubleClick(button) : n.mouse.click(button))
      return `${input.double ? 'Double-clicked' : 'Clicked'} ${input.button || 'left'}`
    }
    case 'text': {
      const text = String(input.text || '').slice(0, 2000)
      if (text) await n.keyboard.type(text)
      return `Typed ${text.length} characters`
    }
    case 'key': {
      const keys = resolveKeys(input.key, n.Key)
      if (!keys) throw Object.assign(new Error(`Unsupported key: ${String(input.key).slice(0, 30)}`), { status: 400 })
      await n.keyboard.pressKey(...keys)
      await n.keyboard.releaseKey(...keys)
      return `Pressed ${input.key}`
    }
    case 'scroll': {
      const amount = Number.isFinite(input.amount) ? Math.max(1, Math.min(20, Math.round(input.amount as number))) : 5
      await (input.direction === 'up' ? n.mouse.scrollUp(amount) : n.mouse.scrollDown(amount))
      return `Scrolled ${input.direction}`
    }
    default:
      throw Object.assign(new Error('Unknown input'), { status: 400 })
  }
}
