const { adaptAgentTownSnapshot } = require('../town/agent-town-model.js')

// Grid units are 16px; the upstream office floor is 40x40 cells (640px).
// Desk slots avoid the meeting room, collab area, coffee area and the
// upstream's own three workstations (x 4-8, y 15-27).
const DESK_ROWS = [
  { y: 15, xs: [12, 16, 20, 24, 28, 32, 36] },
  { y: 19, xs: [12, 16, 20, 24, 28, 32, 36] },
  { y: 23, xs: [12, 16, 20] },
  { y: 27, xs: [12, 16, 20] },
  { y: 31, xs: [4, 8, 12, 16, 20] },
  { y: 35, xs: [4, 8, 12, 16, 20, 24, 28, 32, 36] },
]
const DESK_SLOTS = DESK_ROWS.flatMap(row => row.xs.map(x => ({ x, y: row.y })))
// Boss office = the meeting room, standing beside the table.
const BOSS_SPOT = { x: 4, y: 7 }
const THOUGHT_LIMIT = 140

function clip(value, limit) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

function actionFor(character) {
  if (character.isThinking) return 'work'
  if (character.description) return 'think'
  return 'idle'
}

/**
 * Map the GhostForge agent snapshot to Agent Office state: agents sit at desks,
 * the boss stands in the meeting room, the current task becomes the thought bubble.
 * No movement or activity is simulated; only reported data is shown.
 * Pass the same `slots` Map on every snapshot so agents keep their desks.
 * @param {{ agents?: unknown, tasks?: unknown, boss?: unknown }} snapshot
 * @param {{ slots?: Map<string, number> }} [options]
 */
function adaptAgentOfficeSnapshot(snapshot = {}, { slots } = {}) {
  const characters = adaptAgentTownSnapshot(snapshot, { slots })
  const agents = []
  const layout = []
  let hidden = 0
  for (const character of characters) {
    let x
    let y
    if (character.isBoss) {
      x = BOSS_SPOT.x
      y = BOSS_SPOT.y
    } else {
      // The town slot doubles as the desk number, so desks are kept the same way.
      const slot = DESK_SLOTS[character.slot]
      if (!slot) {
        hidden += 1
        continue
      }
      layout.push({ id: `desk-${character.id}`, type: 'desk', x: slot.x, y: slot.y, label: character.name })
      x = slot.x
      y = slot.y + 2
    }
    const thought = clip(character.description, THOUGHT_LIMIT)
    agents.push({
      id: character.id,
      name: character.isBoss ? `Boss ${character.name}`.replace(/^Boss (boss|leader)$/i, 'Boss') : character.name,
      x,
      y,
      direction: 'down',
      action: actionFor(character),
      currentTask: thought,
      thought,
      mood: 0,
      reputation: 0,
      riskLevel: 0,
      momentum: 0,
      role: character.role,
      status: character.status,
      isBoss: character.isBoss,
    })
  }
  return { agents, layout, hidden, capacity: DESK_SLOTS.length }
}

module.exports = { adaptAgentOfficeSnapshot, DESK_SLOTS, BOSS_SPOT }
