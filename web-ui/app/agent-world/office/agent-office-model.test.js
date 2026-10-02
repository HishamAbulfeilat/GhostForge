const test = require('node:test')
const assert = require('node:assert/strict')
const { adaptAgentOfficeSnapshot, DESK_SLOTS } = require('./agent-office-model.js')

test('agents sit at distinct desks with a desk layout item each', () => {
  const result = adaptAgentOfficeSnapshot({
    agents: [{ id: 'a1', name: 'Ada', state: 'working' }, { id: 'a2', name: 'Bo' }],
    tasks: [{ assignee: 'a1', description: 'Fix the build', status: 'in-progress' }],
  })
  assert.equal(result.agents.length, 2)
  assert.equal(result.layout.length, 2)
  assert.notDeepEqual([result.agents[0].x, result.agents[0].y], [result.agents[1].x, result.agents[1].y])
  assert.equal(result.layout[0].type, 'desk')
  assert.equal(result.layout[0].label, 'Ada')
})

test('current task becomes the thought bubble and drives the action', () => {
  const { agents } = adaptAgentOfficeSnapshot({
    agents: [{ id: 'a1', name: 'Ada' }, { id: 'a2', name: 'Bo' }],
    tasks: [{ assignee: 'a1', description: 'Fix the build', status: 'working' }],
  })
  assert.equal(agents[0].thought, 'Fix the build')
  assert.equal(agents[0].action, 'work')
  assert.equal(agents[1].thought, '')
  assert.equal(agents[1].action, 'idle')
})

test('boss goes to the boss office, not a desk', () => {
  const { agents, layout } = adaptAgentOfficeSnapshot({
    agents: [{ id: 'a1', name: 'Ada' }],
    boss: { id: 'boss', name: 'boss', state: 'running' },
  })
  const boss = agents.find(a => a.isBoss)
  assert.ok(boss)
  assert.equal(boss.name, 'Boss')
  assert.ok(boss.y < 12 && boss.x < 14, 'boss stands in the meeting room')
  assert.equal(layout.length, 1)
})

test('empty or malformed snapshots yield an empty office', () => {
  assert.deepEqual(adaptAgentOfficeSnapshot({}).agents, [])
  assert.deepEqual(adaptAgentOfficeSnapshot({ agents: 'nope', tasks: null }).layout, [])
})

test('agents beyond desk capacity are counted, not stacked', () => {
  const agents = Array.from({ length: DESK_SLOTS.length + 3 }, (_, i) => ({ id: `a${i}`, name: `A${i}` }))
  const result = adaptAgentOfficeSnapshot({ agents })
  assert.equal(result.agents.length, DESK_SLOTS.length)
  assert.equal(result.hidden, 3)
})

test('long tasks are clipped for the bubble', () => {
  const { agents } = adaptAgentOfficeSnapshot({
    agents: [{ id: 'a1', name: 'Ada' }],
    tasks: [{ assignee: 'a1', description: 'x'.repeat(500) }],
  })
  assert.ok(agents[0].thought.length <= 140)
})
