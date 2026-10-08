// Push via Server-Sent Events: the shared hub (also used by the external Agent
// World server), the CLI-sessions route's stream branch, and the client's
// polling fallback.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const webRoot = path.resolve(__dirname, '..')
const sharedDir = path.join(webRoot, 'app', 'agent-world', 'shared')
const flush = () => new Promise(resolve => setImmediate(resolve))
const world = (updatedAt, heartbeat = new Date().toISOString()) => ({
  heartbeat, counts: { sessions: 1 }, events: [],
  sessions: [{ id: 's1', updatedAt, status: 'working', health: 'ok', toolCalls: 1 }],
})
const events = chunks => chunks.join('').split('\n\n').filter(Boolean).map(block => {
  const type = /^event: (.+)$/m.exec(block)?.[1]
  const data = /^data: (.+)$/m.exec(block)?.[1]
  return { type, data: data ? JSON.parse(data) : undefined }
})

function fakeWatch() {
  const state = { started: 0, stopped: 0, fire: () => {} }
  state.watch = (roots, onChange) => {
    state.started++
    state.roots = roots
    state.fire = onChange
    return () => { state.stopped++ }
  }
  return state
}

test('a client gets the snapshot, then world only when it changed and heartbeat otherwise', async () => {
  const { createSnapshotHub } = await import('../app/agent-world/shared/server/push.mjs')
  let current = world('2026-10-05T10:00:00Z')
  const w = fakeWatch()
  const hub = createSnapshotHub({ build: async () => current, watch: w.watch, roots: [{ dir: '/x' }], intervalMs: 60_000, debounceMs: 5 })
  const got = []
  const unsubscribe = hub.subscribe(chunk => got.push(chunk))
  await flush(); await flush()
  assert.match(got[0], /^retry: \d+/)
  assert.deepEqual(events(got.slice(1)).map(e => e.type), ['world'])

  // A file change with nothing new in the snapshot: only a heartbeat.
  w.fire()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(events(got.slice(1)).map(e => e.type), ['world', 'heartbeat'])
  assert.ok(events(got.slice(1))[1].data.heartbeat)

  current = world('2026-10-05T10:05:00Z')
  w.fire()
  await new Promise(resolve => setTimeout(resolve, 20))
  const last = events(got.slice(1)).at(-1)
  assert.equal(last.type, 'world')
  assert.equal(last.data.sessions[0].updatedAt, '2026-10-05T10:05:00Z')
  unsubscribe()
})

test('watchers run only while clients are connected, and a disconnect cleans up', async () => {
  const { createSnapshotHub } = await import('../app/agent-world/shared/server/push.mjs')
  const w = fakeWatch()
  const hub = createSnapshotHub({ build: async () => world('2026-10-05T10:00:00Z'), watch: w.watch, intervalMs: 60_000 })
  assert.equal(w.started, 0, 'nothing is watched before a page connects')
  const a = hub.subscribe(() => {})
  const b = hub.subscribe(() => {})
  assert.equal(w.started, 1)
  assert.equal(hub.size, 2)
  a()
  assert.equal(w.stopped, 0)
  b()
  b() // twice is harmless
  assert.equal(w.stopped, 1, 'the last client leaving stops the watchers and timer')
  assert.equal(hub.size, 0)
  await flush()
})

test('a client whose send throws is dropped', async () => {
  const { createSnapshotHub } = await import('../app/agent-world/shared/server/push.mjs')
  const w = fakeWatch()
  let n = 0
  const hub = createSnapshotHub({ build: async () => world(String(n++)), watch: w.watch, intervalMs: 60_000, debounceMs: 1 })
  let calls = 0
  hub.subscribe(() => { if (++calls > 1) throw new Error('socket gone') })
  await flush(); await flush()
  assert.equal(hub.size, 0)
  assert.equal(w.stopped, 1)
})

test('the hub caps clients and ends streams after their maximum age', async () => {
  const { createSnapshotHub } = await import('../app/agent-world/shared/server/push.mjs')
  const w = fakeWatch()
  const hub = createSnapshotHub({ build: async () => world('t'), watch: w.watch, intervalMs: 60_000, maxClients: 1, maxStreamMs: 10 })
  let closed = false
  assert.ok(hub.subscribe(() => {}, () => { closed = true }))
  assert.equal(hub.full, true)
  assert.equal(hub.subscribe(() => {}), null)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(closed, true)
  assert.equal(hub.size, 0)
  assert.equal(w.stopped, 1)
})

test('the stream route keeps the guards and unsubscribes when the client disconnects', () => {
  const route = fs.readFileSync(path.join(webRoot, 'app/api/agents/cli-sessions/route.ts'), 'utf8')
  const get = route.slice(route.indexOf('export async function GET'))
  const order = ['hostedGuard(request)', 'requireAdminUser(request)', "GF_CLI_SESSIONS === '0'", 'streamSnapshots(request)']
  const at = order.map(s => get.indexOf(s))
  assert.ok(at.every(i => i >= 0), `GET must contain ${order.join(', ')}`)
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'hosted guard, then auth, then the off switch, then the stream')
  const stream = route.slice(route.indexOf('function streamSnapshots'), route.indexOf('async function requireAdminUser'))
  assert.match(stream, /request\.signal\.addEventListener\('abort', close/)
  assert.match(stream, /cancel\(\) \{[\s\S]*unsubscribe\?\.\(\)/)
  assert.match(stream, /hub\.full[\s\S]*status: 503/)
  const push = fs.readFileSync(path.join(sharedDir, 'server/push.mjs'), 'utf8')
  assert.match(push, /'cache-control': 'no-cache, no-transform'/, 'compression must not buffer the stream')
})

test('the page streams with polling as the fallback', () => {
  const api = fs.readFileSync(path.join(sharedDir, 'api.ts'), 'utf8')
  assert.match(api, /new EventSource\(streamUrl\)/)
  assert.match(api, /es\.readyState !== EventSource\.CLOSED/)
  assert.match(api, /Date\.now\(\) - lastPush\.current < refreshMs \* 1\.5/, 'polling only runs while the stream is quiet')
  assert.match(api, /closeStream\(\)\n    \}\n  \}, \[/, 'the stream closes on unmount')
  const page = fs.readFileSync(path.join(webRoot, 'app/agent-world/page.tsx'), 'utf8')
  assert.match(page, /streamUrl: `\$\{CLI_ENDPOINT\}\?stream=1`/)
})
