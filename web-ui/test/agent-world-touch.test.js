// Agent Office touch controls (shared/office/touch.ts): one finger pans, two
// pinch-zoom, taps stay taps, and manual movement clears the follow target.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadShared, sharedDir } = require('./agent-world-shared-loader')

const load = loadShared(['office/touch.ts'])
const { attachTouchControls, PAN_SLOP_PX } = load('office/touch.ts')
test.after(() => load.cleanup())

function setup({ canPan = true, zoom = 1 } = {}) {
  const host = new EventTarget()
  const camera = { scrollX: 100, scrollY: 100, zoom, setZoom(z) { this.zoom = z } }
  const state = { released: 0, canPan }
  const detach = attachTouchControls(host, () => ({ camera, release: () => { state.released++ }, canPan: () => state.canPan }))
  const fire = (type, pointerId, x, y, pointerType = 'touch') =>
    host.dispatchEvent(Object.assign(new Event(type), { pointerId, pointerType, clientX: x, clientY: y }))
  return { host, camera, state, detach, fire }
}

test('one finger drags the view and releases the follow target', () => {
  const { camera, state, fire } = setup({ zoom: 2 })
  fire('pointerdown', 1, 50, 50)
  fire('pointermove', 1, 50 + PAN_SLOP_PX - 2, 50)
  assert.equal(camera.scrollX, 100, 'a tiny move is still a tap')
  assert.equal(state.released, 0)
  fire('pointermove', 1, 90, 30)
  assert.equal(camera.scrollX, 100 - 40 / 2)
  assert.equal(camera.scrollY, 100 + 20 / 2)
  assert.ok(state.released > 0)
  fire('pointerup', 1, 90, 30)
  fire('pointermove', 1, 200, 200)
  assert.equal(camera.scrollX, 80, 'no movement after the finger lifts')
})

test('two fingers pinch to zoom within the scene range', () => {
  const { camera, fire } = setup()
  fire('pointerdown', 1, 100, 100)
  fire('pointerdown', 2, 200, 100)
  fire('pointermove', 2, 300, 100)
  assert.equal(camera.zoom, 2)
  fire('pointermove', 2, 900, 100)
  assert.equal(camera.zoom, 3, 'capped at the wheel maximum')
  fire('pointermove', 2, 101, 100)
  assert.equal(camera.zoom, 1, 'never below 1')
})

test('mouse and pen are left to the scene, desk drags are not stolen, and detach removes the listeners', () => {
  const mouse = setup()
  mouse.fire('pointerdown', 1, 0, 0, 'mouse')
  mouse.fire('pointermove', 1, 100, 100, 'mouse')
  assert.equal(mouse.camera.scrollX, 100)
  const desk = setup({ canPan: false })
  desk.fire('pointerdown', 1, 0, 0)
  desk.fire('pointermove', 1, 100, 100)
  assert.equal(desk.camera.scrollX, 100)
  const gone = setup()
  gone.detach()
  gone.fire('pointerdown', 1, 0, 0)
  gone.fire('pointermove', 1, 100, 100)
  assert.equal(gone.camera.scrollX, 100)
})

test('the office stage attaches the touch controls and stops the browser from scrolling under them', () => {
  const stage = fs.readFileSync(path.join(sharedDir, 'office/OfficeStage.tsx'), 'utf8')
  assert.match(stage, /return attachTouchControls\(host,/)
  assert.match(stage, /release: \(\) => \{ s\.followTarget = null; s\.cinematicReleaseAt = 0 \}/)
  assert.match(stage, /touch-none/)
})
