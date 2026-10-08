const test = require('node:test')
const assert = require('node:assert/strict')
const { adaptAgentTownSnapshot } = require('./agent-town-model.js')

test('maps reported workers and assigned task details to static, selectable characters', () => {
  const snapshot = {
    agents: [
      { id: 'copilot-tui', name: 'Copilot TUI', state: 'working' },
      { id: 'copilot-web', name: 'Copilot Web', state: 'idle' },
    ],
    tasks: [
      { id: 'T-141', assignee: 'copilot-tui', status: 'in-progress', description: 'Render the real town' },
    ],
  }
  const characters = adaptAgentTownSnapshot(snapshot)

  assert.equal(characters.length, 2)
  assert.equal(characters[0].id, 'copilot-tui')
  assert.equal(characters[0].description, 'Render the real town')
  assert.equal(characters[0].isSpeaking, true)
  assert.equal(characters[0].isThinking, true)
  assert.equal('speed' in characters[0], false)
  assert.equal('destination' in characters[0], false)
  assert.equal(characters[0].x, adaptAgentTownSnapshot(snapshot)[0].x)
  assert.equal(characters[0].y, adaptAgentTownSnapshot(snapshot)[0].y)
  assert.equal(characters[1].id, 'copilot-web')
  assert.equal(characters[1].description, '')
  assert.equal(characters[1].isSpeaking, false)
})

test('renders explicit boss data as its own character and avoids a duplicate boss worker', () => {
  const characters = adaptAgentTownSnapshot({
    agents: [{ id: 'worker' }, { id: 'boss', role: 'boss' }],
    boss: { id: 'boss', name: 'GhostForge Boss', status: 'working' },
    tasks: [],
  })

  assert.equal(characters.length, 2)
  assert.equal(characters[0].id, 'boss')
  assert.equal(characters[0].name, 'GhostForge Boss')
  assert.equal(characters[0].character, 'f8')
  assert.equal(characters[0].role, 'boss')
  assert.equal(characters[0].x, 22)
  assert.equal(characters[0].y, 16)
  assert.equal(characters[0].isThinking, true)
})

test('keeps missing or malformed snapshot data empty instead of inventing agents', () => {
  assert.deepEqual(adaptAgentTownSnapshot(), [])
  assert.deepEqual(adaptAgentTownSnapshot({ agents: null, tasks: [null, 'invalid'] }), [])
})

test('sprites come from the id, so they do not change when others come and go', () => {
  const { spriteFor } = require('./agent-town-model.js')
  const one = adaptAgentTownSnapshot({ agents: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
  const two = adaptAgentTownSnapshot({ agents: [{ id: 'c' }] })
  assert.equal(two[0].character, one[2].character)
  assert.equal(one[2].character, spriteFor('c'))
  for (const id of ['a', 'b', 'c', 'session-1', 'x'.repeat(64)]) assert.match(spriteFor(id), /^f[1-7]$/, 'f8 stays the boss sprite')
})

test('with a slots memory, characters keep their slot when someone before them leaves', () => {
  const slots = new Map()
  const first = adaptAgentTownSnapshot({ agents: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, { slots })
  const second = adaptAgentTownSnapshot({ agents: [{ id: 'b' }, { id: 'c' }] }, { slots })
  assert.deepEqual(second.map(p => [p.x, p.y]), first.slice(1).map(p => [p.x, p.y]))
  // A newcomer takes the lowest free slot (the one 'a' left).
  const third = adaptAgentTownSnapshot({ agents: [{ id: 'b' }, { id: 'c' }, { id: 'd' }] }, { slots })
  assert.deepEqual([third[2].x, third[2].y], [first[0].x, first[0].y])
  assert.deepEqual(third.map(p => p.slot), [1, 2, 0])
  // Without memory the order decides, as before.
  assert.deepEqual(adaptAgentTownSnapshot({ agents: [{ id: 'b' }, { id: 'c' }] }).map(p => p.slot), [0, 1])
})
