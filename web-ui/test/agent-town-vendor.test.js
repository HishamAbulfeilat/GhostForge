const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')

test('vendored ai-town ships its MIT license and pinned-commit notice', () => {
  assert.match(read('vendor/ai-town/LICENSE'), /MIT License/)
  assert.match(read('vendor/ai-town/NOTICE.md'), /8e05997f2409275669c8344b84a51692e83f3f33/)
})

test('every bundled ai-town asset is documented in THIRD_PARTY_NOTICES.md', () => {
  const notices = fs.readFileSync(path.join(root, '..', 'THIRD_PARTY_NOTICES.md'), 'utf8')
  for (const file of fs.readdirSync(path.join(root, 'vendor/ai-town/assets'))) {
    assert.ok(notices.includes(file), `${file} missing from THIRD_PARTY_NOTICES.md`)
  }
})

test('vendor code has no Convex or Clerk data layer', () => {
  for (const f of ['Game', 'PixiGame', 'Player', 'Character', 'PixiStaticMap', 'PixiViewport']) {
    assert.doesNotMatch(read('vendor/ai-town/src/components', `${f}.tsx`), /convex|clerk/i)
  }
})

test('pixi deps stay on upstream majors and the town loads client-only', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.match(pkg.dependencies['pixi.js'], /\^7/)
  assert.match(pkg.dependencies['@pixi/react'], /\^7/)
  assert.match(pkg.dependencies['pixi-viewport'], /\^5/)
  assert.match(read('app/agent-world/page.tsx'), /dynamic\(\(\) => import\('\.\/town\/TownWorld'\),\s*\{\s*ssr: false/)
  // The shared town stage (loaded only inside the ssr:false TownWorld) lazy-loads the Pixi renderer.
  assert.match(read('app/agent-world/shared/town/TownStage.tsx'), /lazy\(\(\) => import\('\.\.\/\.\.\/\.\.\/\.\.\/vendor\/ai-town\/src\/components\/Game'\)\)/)
})
