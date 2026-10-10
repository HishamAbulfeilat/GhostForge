// agent-world addition (not upstream; see ../../NOTICE.md): upstream Character
// parses a new Spritesheet for every character instance and never destroys
// it. This shares one parsed sheet per (texture, frame data) between all
// characters, counts its users, and destroys its textures shortly after the
// last one unmounts; the base texture goes when no sheet of that image is left.
import { BaseTexture, ISpritesheetData, SCALE_MODES, Spritesheet } from 'pixi.js'

type Entry = { users: number; sheet: Spritesheet; ready: Promise<Spritesheet>; release?: ReturnType<typeof setTimeout> }

const cache = new Map<string, Map<ISpritesheetData, Entry>>()

/** Number of parsed sheets currently cached (for tests and diagnostics). */
export function cachedSpritesheets(): number {
  let n = 0
  for (const byData of cache.values()) n += byData.size
  return n
}

/** The shared sheet for this texture and frame data; pair with releaseSpritesheet. */
export function acquireSpritesheet(textureUrl: string, data: ISpritesheetData): Promise<Spritesheet> {
  let byData = cache.get(textureUrl)
  if (!byData) cache.set(textureUrl, byData = new Map())
  let entry = byData.get(data)
  if (!entry) {
    const sheet = new Spritesheet(BaseTexture.from(textureUrl, { scaleMode: SCALE_MODES.NEAREST }), data)
    entry = { users: 0, sheet, ready: sheet.parse().then(() => sheet) }
    byData.set(data, entry)
  }
  clearTimeout(entry.release)
  entry.release = undefined
  entry.users++
  return entry.ready
}

/**
 * One user is done with the sheet. When none is left after `delayMs` (so a
 * quick remount, e.g. React Strict Mode, reuses it) its textures are destroyed.
 */
export function releaseSpritesheet(textureUrl: string, data: ISpritesheetData, delayMs = 1000): void {
  const byData = cache.get(textureUrl)
  const entry = byData?.get(data)
  if (!byData || !entry) return
  entry.users = Math.max(0, entry.users - 1)
  if (entry.users) return
  clearTimeout(entry.release)
  entry.release = setTimeout(() => {
    if (entry.users || byData.get(data) !== entry) return
    byData.delete(data)
    if (!byData.size) cache.delete(textureUrl)
    const destroy = () => entry.sheet.destroy(!cache.has(textureUrl))
    entry.ready.then(destroy, destroy)
  }, delayMs)
}
