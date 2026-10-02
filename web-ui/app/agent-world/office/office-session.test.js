const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const webUi = path.join(__dirname, '..', '..', '..')
const read = (...p) => fs.readFileSync(path.join(webUi, ...p), 'utf8')

// Transpile the TS sources into a temp tree with the same relative layout.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-office-'))
for (const file of ['vendor/agent-office/src/snapshot-room.ts', 'app/agent-world/office/office-session.ts']) {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const dest = path.join(out, file.replace(/\.ts$/, '.js'))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, outputText)
}
const room = require(path.join(out, 'vendor/agent-office/src/snapshot-room.js'))
const { startOfficeSession } = require(path.join(out, 'app/agent-world/office/office-session.js'))
test.after(() => fs.rmSync(out, { recursive: true, force: true }))

const agent = (id, thought = '') => ({
  id, name: id, x: 2, y: 3, direction: 'down', action: thought ? 'work' : 'idle',
  currentTask: thought, thought, mood: 0, reputation: 0, riskLevel: 0, momentum: 0,
})
const flush = () => new Promise(resolve => setImmediate(resolve))

// What OfficeScene does once the scene is up: join, then wait for first state.
async function joinLikeScene() {
  const joined = await new room.Client('ignored').joinOrCreate('office')
  return new Promise(resolve => joined.onStateChange.once(state => resolve(state)))
}

test('Strict Mode mount -> unmount -> mount leaves a live office the scene can join', async () => {
  const scenes = []
  const loader = async (isCancelled) => {
    await flush() // dynamic imports resolve after the synchronous Strict Mode cleanup
    if (isCancelled()) return undefined
    const scene = { stopped: false }
    scenes.push(scene)
    return () => { scene.stopped = true }
  }
  const model = { agents: [agent('a1', 'Fix the build')], layout: [] }

  const first = startOfficeSession(model, loader, assert.fail)
  first.stop() // Strict Mode's simulated unmount
  const second = startOfficeSession(model, loader, assert.fail)
  await flush()

  assert.equal(scenes.length, 1, 'only the surviving mount starts a scene')
  const state = await joinLikeScene()
  assert.equal(state, second.office.state)
  assert.equal(state.agents.size, 1)

  // Later snapshot refreshes reach the joined state.
  second.office.update([agent('a1', 'Fix the build'), agent('a2')], [])
  assert.equal(state.agents.size, 2)

  // The disposed first office ignores updates.
  first.office.update([agent('zz')], [])
  assert.equal(first.office.state.agents.get('zz'), undefined)

  second.stop()
  assert.equal(scenes[0].stopped, true)
  await assert.rejects(new room.Client().joinOrCreate('office'), /No GhostForge snapshot office/)
})

test('a stale stop does not unbind a newer office', async () => {
  const loader = async () => () => {}
  const older = startOfficeSession({ agents: [], layout: [] }, loader, assert.fail)
  const newer = startOfficeSession({ agents: [], layout: [] }, loader, assert.fail)
  older.stop()
  assert.equal(await new room.Client().joinOrCreate('office'), newer.office.room)
  newer.stop()
})

test('scene load errors are reported unless the session was stopped', async () => {
  const errors = []
  const failing = async () => { await flush(); throw new Error('boom') }
  startOfficeSession({ agents: [], layout: [] }, failing, e => errors.push(e.message)).stop()
  const live = startOfficeSession({ agents: [], layout: [] }, failing, e => errors.push(e.message))
  await flush(); await flush()
  assert.deepEqual(errors, ['boom'])
  live.stop()
})

test('OfficeWorld creates and disposes the office in one effect and clears the ref', () => {
  const host = read('app/agent-world/office/OfficeWorld.tsx')
  assert.doesNotMatch(host, /new SnapshotOffice\(/)
  assert.doesNotMatch(host, /useEffect\(\(\) => \(\) => officeRef\.current\?\.dispose\(\)/)
  assert.match(host, /officeRef\.current = session\.office[\s\S]*return \(\) => \{[\s\S]*officeRef\.current = null[\s\S]*session\.stop\(\)/)
})

// Emulates the vendored scene's onChange thought handling against fake time.
function runBubble({ cancelStaleHide }) {
  let now = 0
  const timers = []
  const office = new room.SnapshotOffice()
  const realSetInterval = global.setInterval
  global.setInterval = (fn, ms) => { timers.push({ fn, every: ms, at: ms }); return timers.length }
  try {
    office.update([agent('a1', 'Fix the build')], [])
  } finally {
    global.setInterval = realSetInterval
  }
  let visible = false
  let pendingHide
  const hides = []
  office.state.agents.get('a1').onChange(() => {
    visible = true
    if (cancelStaleHide && pendingHide) pendingHide.removed = true
    pendingHide = { at: now + room.THOUGHT_HIDE_MS, removed: false }
    hides.push(pendingHide)
  })
  office.state.agents.get('a1').notify() // first show, as onAdd + first change would
  let hiddenMs = 0
  for (; now <= 60000; now += 100) {
    for (const t of timers) while (t.at <= now) { t.fn(); t.at += t.every }
    for (const h of hides) if (!h.removed && h.at === now) { visible = false; h.removed = true }
    if (!visible) hiddenMs += 100
  }
  office.dispose()
  return hiddenMs
}

test('current-task thought bubble stays visible across refreshes', () => {
  assert.ok(room.THOUGHT_REFRESH_MS < room.THOUGHT_HIDE_MS)
  assert.equal(runBubble({ cancelStaleHide: true }), 0)
  // Without cancelling the stale hide (upstream behaviour) the bubble flickers off.
  assert.ok(runBubble({ cancelStaleHide: false }) > 0)
})

test('vendored scene cancels the stale thought hide before scheduling a new one', () => {
  const game = read('vendor/agent-office/src/game/Game.ts')
  assert.match(game, /thoughtHide\?\.remove\(false\);\s*thoughtHide = this\.time\.delayedCall\(6000,/)
  assert.match(read('vendor/agent-office/NOTICE.md'), /thoughtHide\?\.remove\(false\)/)
})
