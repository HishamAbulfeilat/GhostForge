const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

function loadTypeScriptModule(relativePath, dependencies = {}) {
  const filePath = path.resolve(__dirname, '..', relativePath)
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(dependencies, request)) return dependencies[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const loaded = new Module(filePath, module)
    loaded.filename = filePath
    loaded.paths = Module._nodeModulePaths(path.dirname(filePath))
    loaded._compile(compiled, filePath)
    return loaded.exports
  } finally {
    Module._load = originalLoad
  }
}

const dashboardModel = loadTypeScriptModule('app/agents/dashboard-model.ts')
const { agentWorldCounts, buildAgentWorld, filterAgentWorld } = loadTypeScriptModule(
  'app/agents/agent-world-model.ts',
  { './dashboard-model': dashboardModel },
)

const now = Date.parse('2026-10-01T12:00:00.000Z')
const snapshot = {
  health: 96,
  running: true,
  phase: 4,
  updatedAt: '2026-10-01T11:59:30.000Z',
  workflow: { leader: 'boss', mode: 'parallel' },
  sources: [
    { id: 'cloud:west', label: 'Cloud west', kind: 'cloud', status: 'online', project: 'GhostForge', updatedAt: '2026-10-01T11:59:30.000Z' },
  ],
  sessions: [
    { id: 'cloud-worker', sourceId: 'cloud:west', sourceKind: 'cloud', state: 'working', taskId: 'T-2', provider: 'copilot', project: 'GhostForge', progress: 50 },
  ],
  agents: {
    boss: { provider: 'claude', state: 'working', task: 'T-1', leader: true, role: 'boss' },
    localWorker: { provider: 'copilot', state: 'idle', task: null },
  },
  tasks: [
    { id: 'T-1', title: 'Plan', status: 'done', owner: 'boss' },
    { id: 'T-2', title: 'Build', status: 'in_progress', owner: 'cloud-worker', leader: 'boss', dependencies: ['T-1'] },
  ],
  messages: [{ ts: '2026-10-01T11:59:00.000Z', from: 'cloud-worker', to: 'boss', text: 'Build started', sourceId: 'cloud:west', project: 'GhostForge' }],
}

test('buildAgentWorld derives all visible topology from the snapshot', () => {
  const world = buildAgentWorld(snapshot, now)
  assert.equal(world.sessions.length, 3)
  assert.equal(world.sources.length, 2)
  assert.equal(world.tasks[1].status, 'in-progress')
  assert.equal(world.sessions.find(session => session.id === 'cloud-worker').taskTitle, 'Build')
  assert.deepEqual(world.edges.map(edge => edge.kind).sort(), ['assignment', 'assignment', 'dependency', 'leadership'])
  assert.deepEqual(agentWorldCounts(world), { active: 2, sessions: 3, openTasks: 1, blocked: 0, sources: 2 })
  assert.equal(world.events[0].text, 'Build started')
})

test('buildAgentWorld marks old explicit connector data stale without inventing timestamps', () => {
  const world = buildAgentWorld({
    sources: [{ id: 'remote:phone', kind: 'remote', status: 'online', updatedAt: '2026-10-01T11:00:00.000Z' }],
    sessions: [{ id: 'phone-agent', sourceId: 'remote:phone', sourceKind: 'remote', state: 'working', updatedAt: '2026-10-01T11:00:00.000Z' }],
  }, now)
  assert.equal(world.sources[0].status, 'degraded')
  assert.equal(world.sources[0].stale, true)
  assert.equal(world.sessions[0].state, 'stale')
})

test('filterAgentWorld keeps only matching projects and source topology', () => {
  const world = buildAgentWorld(snapshot, now)
  const filtered = filterAgentWorld(world, { project: 'GhostForge', workspace: '', source: 'cloud:west' })
  assert.deepEqual(filtered.sessions.map(session => session.id), ['cloud-worker'])
  assert.deepEqual(filtered.tasks.map(task => task.id), ['T-1', 'T-2'])
  assert.equal(filtered.edges.some(edge => edge.kind === 'dependency'), true)
  assert.deepEqual(filtered.events.map(event => event.text), ['Build started'])
})

test('empty snapshots produce honest empty collections and zero counts', () => {
  const world = buildAgentWorld({}, now)
  assert.deepEqual(agentWorldCounts(world), { active: 0, sessions: 0, openTasks: 0, blocked: 0, sources: 0 })
  assert.deepEqual(world.sessions, [])
  assert.deepEqual(world.tasks, [])
  assert.equal(world.updatedAt, null)
})

test('source-only metadata populates filters and scoped views exclude unscoped events', () => {
  const world = buildAgentWorld({
    sources: [{ id: 'remote:lab', kind: 'remote', project: 'Lab', workspace: 'Device bench' }],
    messages: [
      { text: 'Global note', from: 'boss', to: 'all' },
      { text: 'Lab note', from: 'device', to: 'boss', sourceId: 'remote:lab', project: 'Lab', workspace: 'Device bench' },
    ],
  }, now)
  assert.deepEqual(world.projects, ['Lab'])
  assert.deepEqual(world.workspaces, ['Device bench'])
  const filtered = filterAgentWorld(world, { project: 'Lab', workspace: '', source: 'remote:lab' })
  assert.deepEqual(filtered.events.map(event => event.text), ['Lab note'])
})
