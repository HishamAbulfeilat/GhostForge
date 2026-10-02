const MAP_WIDTH = 45
const MAP_HEIGHT = 32
const CHARACTER_COUNT = 8

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

function stableSlot(index, boss) {
  if (boss) return { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) }
  const slot = index % 28
  return {
    x: 4 + (slot % 7) * 5,
    y: 3 + Math.floor(slot / 7) * 6,
  }
}

function toCharacter(agent, index, tasks, isBoss = false) {
  const id = identity(agent)
  if (!id) return null
  const task = matchingTask(agent, tasks)
  const description = text(task, ['description', 'summary', 'title', 'text'])
    || text(agent, ['task', 'description', 'currentTask'])
  const taskStatus = text(task, ['status', 'state'])
  const status = taskStatus || text(agent, ['state', 'status']) || 'unknown'
  const role = isBoss ? 'boss' : text(agent, ['role', 'title', 'provider']) || 'agent'
  const point = stableSlot(index, isBoss)
  return {
    id,
    name: text(agent, ['name', 'displayName', 'agent']) || id,
    character: isBoss ? 'f8' : `f${(index % CHARACTER_COUNT) + 1}`,
    description,
    status,
    role,
    x: point.x,
    y: Math.min(point.y, MAP_HEIGHT - 3),
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
 * @param {{ agents?: unknown, tasks?: unknown, boss?: unknown }} snapshot
 * @returns {TownCharacter[]}
 */
function adaptAgentTownSnapshot(snapshot = {}) {
  const agents = records(snapshot.agents)
  const tasks = records(snapshot.tasks)
  const boss = asRecord(snapshot.boss) ?? agents.find(isBossRecord) ?? null
  const bossId = boss && (identity(boss) || 'boss')
  const ordinaryAgents = agents.filter(agent =>
    agent !== boss && !isBossRecord(agent) && identity(agent) !== bossId,
  )
  const players = ordinaryAgents
    .map((agent, index) => toCharacter(agent, index, tasks))
    .filter(Boolean)
  if (boss) {
    const mappedBoss = toCharacter({
      ...boss,
      id: bossId,
      name: text(boss, ['name', 'displayName']) || 'GhostForge Boss',
    }, players.length, tasks, true)
    if (mappedBoss && !players.some(player => player.id === mappedBoss.id)) players.unshift(mappedBoss)
  }
  return players
}

module.exports = { adaptAgentTownSnapshot }
