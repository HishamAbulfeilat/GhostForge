const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')
const SHA = '58f11f9b31770c10bcf3d7a0618325d22bd0ee9e'

test('agent-office ships both MIT licenses and a pinned-commit notice', () => {
  assert.match(read('vendor/agent-office/LICENSE'), /MIT License[\s\S]*Harish Kotra/)
  assert.match(read('vendor/agent-office/pixel-agents/LICENSE'), /MIT License[\s\S]*Pablo De Lucca/)
  assert.match(read('vendor/agent-office/NOTICE.md'), new RegExp(SHA))
  assert.match(fs.readFileSync(path.join(root, '..', 'THIRD_PARTY_NOTICES.md'), 'utf8'), new RegExp(SHA))
})

test('every bundled agent-office asset is documented in THIRD_PARTY_NOTICES.md', () => {
  const notices = fs.readFileSync(path.join(root, '..', 'THIRD_PARTY_NOTICES.md'), 'utf8')
  for (const file of fs.readdirSync(path.join(root, 'public/vendor/agent-office/characters'))) {
    assert.ok(notices.includes(file.replace(/\.png$/, '')), `${file} missing from THIRD_PARTY_NOTICES.md`)
  }
})

test('vendored scene has no Colyseus/Ollama server layer', () => {
  for (const f of ['src/game/Game.ts', 'src/game/schema.ts', 'src/events.ts']) {
    const code = read('vendor/agent-office', f).replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /colyseus\.js|@colyseus\/schema|ollama|\/assets\/characters/i, f)
  }
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.dependencies['colyseus.js'], undefined)
  assert.match(pkg.dependencies.phaser, /\^3/)
})

test('scene keeps upstream features: bubbles, emotes, name tags, focus ring, camera follow', () => {
  const game = read('vendor/agent-office/src/game/Game.ts')
  for (const marker of ['thoughtBubble', 'emoteBubble', 'focusRing', 'followTarget', 'OfficeScene', "'layout-sync'"]) {
    assert.ok(game.includes(marker), marker)
  }
})

test('office loads client-only from /agent-world?world=office', () => {
  const page = read('app/agent-world/page.tsx')
  assert.match(page, /dynamic\(\(\) => import\('\.\/office\/OfficeWorld'\),\s*\{\s*ssr: false/)
  assert.match(page, /world === 'office'[\s\S]*<OfficeWorld/)
  const host = read('app/agent-world/office/OfficeWorld.tsx')
  assert.match(host, /import\('phaser'\)/)
  assert.doesNotMatch(host, /^import .*from 'phaser'/m)
})
