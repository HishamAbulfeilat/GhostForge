// Agent Office seating (shared/office/seating.ts): agents keep their desk
// between snapshots until they leave.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadShared } = require('./agent-world-shared-loader')
const { DESK_SLOTS } = require('../app/agent-world/office/agent-office-model.js')

const load = loadShared(['office/seating.ts'])
const { seatAgents, assignDesks, shortName } = load('office/seating.ts')
test.after(() => load.cleanup())

const agent = id => ({ id, name: id, x: 0, y: 0, direction: 'down', action: 'idle', currentTask: '', thought: '', mood: 0, reputation: 0, riskLevel: 0, momentum: 0 })
const model = ids => ({ agents: ids.map(agent), layout: [] })

test('agents keep their desk when an agent seated before them leaves', () => {
  const memory = new Map()
  const first = seatAgents(model(['a', 'b', 'c']), DESK_SLOTS, {}, memory)
  const second = seatAgents(model(['b', 'c']), DESK_SLOTS, {}, memory)
  assert.deepEqual(second.seats.get('b'), first.seats.get('b'))
  assert.deepEqual(second.seats.get('c'), first.seats.get('c'))
  // The newcomer gets the desk 'a' left.
  const third = seatAgents(model(['b', 'c', 'd']), DESK_SLOTS, {}, memory)
  assert.deepEqual(third.seats.get('d'), first.seats.get('a'))
  // No memory: order decides, as before.
  assert.deepEqual(seatAgents(model(['b', 'c']), DESK_SLOTS, {}).seats.get('b'), first.seats.get('a'))
})

test('desk numbers past the capacity hide the agent instead of doubling up', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `s${i}`)
  const seated = seatAgents(model(ids), DESK_SLOTS, {}, new Map())
  assert.equal(seated.agents.length + seated.hidden, 40)
  assert.equal(seated.agents.length, seated.capacity)
  assert.equal(new Set([...seated.seats.values()].map(s => `${s.x},${s.y}`)).size, seated.capacity)
})

test('assignDesks frees the desks of agents that left and fills the lowest free one', () => {
  const memory = new Map()
  assert.deepEqual(assignDesks(['a', 'b', 'c'], memory), [0, 1, 2])
  assert.deepEqual(assignDesks(['c', 'a'], memory), [2, 0])
  assert.deepEqual(assignDesks(['c', 'a', 'x', 'y'], memory), [2, 0, 1, 3])
  assert.equal(shortName('gf-integration #3'), 'gf-integra…#3')
})
