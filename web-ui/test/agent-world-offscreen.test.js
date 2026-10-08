// Scenes stop rendering while scrolled off screen: the Pixi ticker (AI Town),
// the Phaser loop (Agent Office), the walkers, the bubble layout loop and the
// minimap all follow one IntersectionObserver per scene.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const web = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(web, p), 'utf8')
const shared = p => read(`app/agent-world/shared/${p}`)

test('useOnScreen observes the scene and disconnects on unmount', () => {
  const hooks = shared('hooks.ts')
  const hook = hooks.slice(hooks.indexOf('export function useOnScreen'), hooks.indexOf('/** Counts up every'))
  assert.match(hook, /new IntersectionObserver/)
  assert.match(hook, /return \(\) => observer\.disconnect\(\)/)
  assert.match(hook, /typeof IntersectionObserver === 'undefined'\) return/, 'stays on screen where unsupported')
})

test('AI Town pauses the Pixi stage, walkers, bubble loop and minimap off screen', () => {
  const town = shared('town/TownStage.tsx')
  assert.match(town, /const onScreen = useOnScreen\(sceneRef\)/)
  assert.match(town, /paused=\{!onScreen\} \/>/)
  assert.match(town, /useWalkers\(placed, reduced, !onScreen\)/)
  assert.match(town, /if \(!onScreen\) return\n    let frame = 0/, 'no bubble rAF loop while hidden')
  const game = read('vendor/ai-town/src/components/Game.tsx')
  assert.match(game, /raf=\{!paused\} renderOnComponentChange=\{!paused\}/)
  assert.match(read('vendor/ai-town/NOTICE.md'), /`paused`/)
  assert.match(shared('town/walkers.ts'), /if \(pausedRef\.current\) return/)
})

test('Agent Office sleeps the Phaser loop and stops walkers and minimap off screen', () => {
  const office = shared('office/OfficeStage.tsx')
  assert.match(office, /const onScreen = useOnScreen\(viewRef\)/)
  assert.match(office, /if \(onScreen\) loop\?\.wake\(\)\n    else loop\?\.sleep\(\)/)
  assert.match(office, /if \(!onScreenRef\.current\) game\.loop\.sleep\(\)/, 'a scene created off screen starts asleep')
  assert.match(office, /if \(!onScreenRef\.current\) return\n      let changed = false/)
  assert.match(office, /label="Agent Office minimap" paused=\{!onScreen\}/)
  const minimap = shared('Minimap.tsx')
  assert.match(minimap, /useEffect\(\(\) => \{\n    if \(paused\) return/)
})
