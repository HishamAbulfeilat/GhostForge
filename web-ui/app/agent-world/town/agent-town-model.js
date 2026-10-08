const MAP_WIDTH = 45
const MAP_HEIGHT = 32
// Sprites f1-f7 for agents; f8 is the boss's.
const SPRITE_COUNT = 7

/**
 * @typedef {Object} TownCharacter
 * @property {string} id
 * @property {string} name
 * @property {string} character
 * @property {string} description
 * @property {string} status
 * @property {string} role
 * @property {number} x
 * @property {number} y
 * @property {number} slot
 * @property {boolean} isBoss
 * @property {boolean} isSpeaking
 * @property {boolean} isThinking
 */

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null
}

function records(value) {
  if (Array.isArray(value)) return value.map(asRecord).filter(Boolean)
  const object = asRecord(value)
  return object
    ? Object.entries(object).flatMap(([id, record]) => {
      const value = asRecord(record)
      return value ? [{ ...value, id }] : []
    })
    : []
}

function text(record, fields) {
  for (const field of fields) {
    const value = record?.[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

function identity(record) {
  return text(record, ['id', 'agentId', 'name', 'agent'])
}

function matchingTask(agent, tasks) {
  const id = identity(agent)
  return tasks.find(item => {
    const assignee = text(item, ['assignee', 'assignedTo', 'owner', 'agent', 'agentId', 'assigneeId'])
    return assignee && (assignee === id || assignee === text(agent, ['name', 'agent']))
  }) ?? null
}

/** FNV-1a: a small, stable hash of an id. */
function hashId(id) {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** The same id always gets the same sprite, whatever else is on the map. */
function spriteFor(id) {
  return `f${(hashId(id) % SPRITE_COUNT) + 1}`
}

/**
 * One slot number per id. An id keeps the slot `memory` gave it while it stays
 * in `ids`; a new id takes the lowest free slot; an id that left frees its
 * slot. `memory` (a Map the caller keeps between snapshots) is updated.
 * @param {string[]} ids
 * @param {Map<string, number>} [memory]
 * @returns {number[]}
 */
function assignSlots(ids, memory = new Map()) {
  const present = new Set(ids)
  for (const id of [...memory.keys()]) if (!present.has(id)) memory.delete(id)
  const taken = new Set(memory.values())
  let next = 0
  return ids.map(id => {
    const kept = memory.get(id)
    if (kept !== undefined) return kept
    while (taken.has(next)) next++
    memory.set(id, next)
    taken.add(next)
    return next
  })
}

function stableSlot(index, boss) {
  if (boss) return { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) }
  const slot = index % 28
  return {
    x: 4 + (slot % 7) * 5,
    y: 3 + Math.floor(slot / 7) * 6,
  }
}

function toCharacter(agent, slot, tasks, isBoss = false) {
  const id = identity(agent)
  if (!id) return null
  const task = matchingTask(agent, tasks)
  const description = text(task, ['description', 'summary', 'title', 'text'])
    || text(agent, ['task', 'description', 'currentTask'])
  const taskStatus = text(task, ['status', 'state'])
  const status = taskStatus || text(agent, ['state', 'status']) || 'unknown'
  const role = isBoss ? 'boss' : text(agent, ['role', 'title', 'provider']) || 'agent'
  const point = stableSlot(slot, isBoss)
  return {
    id,
    name: text(agent, ['name', 'displayName', 'agent']) || id,
    character: isBoss ? 'f8' : spriteFor(id),
    description,
    status,
    role,
    x: point.x,
    y: Math.min(point.y, MAP_HEIGHT - 3),
    slot,
    isBoss,
    isSpeaking: Boolean(description),
    isThinking: /^(working|running|in-progress|in_progress|active)$/i.test(status),
  }
}

function isBossRecord(record) {
  return ['id', 'name', 'role', 'agent'].some(field =>
    /^(boss|leader)$/i.test(text(record, [field])),
  )
}

/**
 * Convert only reported GhostForge agents, tasks, and boss data to static AI Town characters.
 * Positions are stable display slots; they do not imply movement or generated activity.
 * The sprite comes from a hash of the id. Pass the same `slots` Map on every
 * snapshot so a character keeps its slot until it leaves (see assignSlots).
 * @param {{ agents?: unknown, tasks?: unknown, boss?: unknown }} snapshot
 * @param {{ slots?: Map<string, number> }} [options]
 * @returns {TownCharacter[]}
 */
function adaptAgentTownSnapshot(snapshot = {}, { slots } = {}) {
  const agents = records(snapshot.agents)
  const tasks = records(snapshot.tasks)
  const boss = asRecord(snapshot.boss) ?? agents.find(isBossRecord) ?? null
  const ordinaryAgents = agents.filter(agent => agent !== boss && !isBossRecord(agent) && identity(agent))
  const slotOf = assignSlots(ordinaryAgents.map(identity), slots)
  const players = ordinaryAgents
    .map((agent, index) => toCharacter(agent, slotOf[index], tasks))
    .filter(Boolean)
  if (boss) {
    const mappedBoss = toCharacter(boss, 0, tasks, true)
    if (mappedBoss && !players.some(player => player.id === mappedBoss.id)) players.unshift(mappedBoss)
  }
  return players
}

module.exports = { adaptAgentTownSnapshot, assignSlots, spriteFor }
