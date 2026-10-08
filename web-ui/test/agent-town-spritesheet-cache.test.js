// The vendored AI Town Character shares one parsed spritesheet per (texture,
// frame data) and destroys it after its last user unmounts
// (vendor/ai-town/src/components/spritesheetCache.ts, recorded in NOTICE.md).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const dir = path.join(__dirname, '..', 'vendor', 'ai-town')
const source = fs.readFileSync(path.join(dir, 'src/components/spritesheetCache.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })

function loadWithFakePixi() {
  const log = { parsed: 0, destroyed: [], bases: 0 }
  class BaseTexture { static from(url) { log.bases++; return { url } } }
  class Spritesheet {
    constructor(base, data) { this.base = base; this.data = data }
    parse() { log.parsed++; return Promise.resolve({}) }
    destroy(destroyBase) { log.destroyed.push({ data: this.data, destroyBase }) }
  }
  const pixi = { BaseTexture, Spritesheet, SCALE_MODES: { NEAREST: 0 } }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => {
    if (name === 'pixi.js') return pixi
    throw new Error(`unexpected import ${name}`)
  }, mod, mod.exports)
  return { cache: mod.exports, log }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('characters with the same sprite share one parsed sheet', async () => {
  const { cache, log } = loadWithFakePixi()
  const f1 = {}, f2 = {}
  const a = await cache.acquireSpritesheet('/folk.png', f1)
  const b = await cache.acquireSpritesheet('/folk.png', f1)
  await cache.acquireSpritesheet('/folk.png', f2)
  assert.equal(a, b)
  assert.equal(log.parsed, 2)
  assert.equal(cache.cachedSpritesheets(), 2)
})

test('the last release destroys the textures, and the base texture once no sheet of that image is left', async () => {
  const { cache, log } = loadWithFakePixi()
  const f1 = {}, f2 = {}
  await cache.acquireSpritesheet('/folk.png', f1)
  await cache.acquireSpritesheet('/folk.png', f1)
  await cache.acquireSpritesheet('/folk.png', f2)
  cache.releaseSpritesheet('/folk.png', f1, 5)
  await wait(15)
  assert.equal(log.destroyed.length, 0, 'still in use by one character')
  cache.releaseSpritesheet('/folk.png', f1, 5)
  await wait(15)
  assert.deepEqual(log.destroyed, [{ data: f1, destroyBase: false }], 'f2 still uses the image')
  cache.releaseSpritesheet('/folk.png', f2, 5)
  await wait(15)
  assert.deepEqual(log.destroyed[1], { data: f2, destroyBase: true })
  assert.equal(cache.cachedSpritesheets(), 0)
})

test('a quick remount (Strict Mode) reuses the sheet instead of destroying it', async () => {
  const { cache, log } = loadWithFakePixi()
  const f1 = {}
  await cache.acquireSpritesheet('/folk.png', f1)
  cache.releaseSpritesheet('/folk.png', f1, 5)
  await cache.acquireSpritesheet('/folk.png', f1)
  await wait(15)
  assert.equal(log.destroyed.length, 0)
  assert.equal(log.parsed, 1)
})

test('Character uses the cache and the deviation is recorded', () => {
  const character = fs.readFileSync(path.join(dir, 'src/components/Character.tsx'), 'utf8')
  assert.match(character, /acquireSpritesheet\(textureUrl, spritesheetData\)/)
  assert.match(character, /releaseSpritesheet\(textureUrl, spritesheetData\)/)
  assert.doesNotMatch(character, /new Spritesheet\(/)
  assert.match(fs.readFileSync(path.join(dir, 'NOTICE.md'), 'utf8'), /spritesheetCache\.ts/)
})
