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

test('uses a stable boss identity when the snapshot omits one', () => {
  const characters = adaptAgentTownSnapshot({
    agents: [{ id: 'worker' }],
    boss: { state: 'working' },
    tasks: [],
  })

  assert.equal(characters.length, 2)
  assert.deepEqual(characters[0], {
    id: 'boss',
    name: 'GhostForge Boss',
    character: 'f8',
    description: '',
    status: 'working',
    role: 'boss',
    x: 22,
    y: 16,
    isBoss: true,
    isSpeaking: false,
    isThinking: true,
  })
})

test('keeps explicit boss data instead of a duplicate worker character', () => {
  const characters = adaptAgentTownSnapshot({
    agents: [{ id: 'worker' }, { id: 'boss', name: 'Agent row' }],
    boss: { id: 'boss', name: 'GhostForge Boss' },
    tasks: [],
  })

  assert.deepEqual(characters.map(character => character.id), ['boss', 'worker'])
})

test('keeps missing or malformed snapshot data empty instead of inventing agents', () => {
  assert.deepEqual(adaptAgentTownSnapshot(), [])
  assert.deepEqual(adaptAgentTownSnapshot({ agents: null, tasks: [null, 'invalid'] }), [])
})
