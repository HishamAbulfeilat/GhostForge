const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const base = path.resolve(__dirname, '..')

function read(file) {
  return fs.readFileSync(path.join(base, file), 'utf8')
}

function loadTypeScriptModule(file) {
  const filePath = path.join(base, file)
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText
  const loaded = new Module(filePath, module)
  loaded.filename = filePath
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath))
  loaded._compile(compiled, filePath)
  return loaded.exports
}

const world = loadTypeScriptModule('lib/agent-world.ts')
const now = Date.parse('2026-10-01T12:00:00.000Z')
const data = {
  connectors: [
    { id: 'ghostforge-local', source: 'local', project: 'GhostForge', status: 'online' },
    { id: 'remote-cloud', source: 'cloud', project: 'Cloud project', status: 'stale' },
  ],
  sessions: [
    {
      id: 'claude-session',
      source: 'remote-cloud',
      provider: 'claude',
      agent: 'claude-worker',
      state: 'working',
      task: 'T-2',
      updatedAt: '2026-10-01T11:59:00.000Z',
    },
  ],
  agents: [
    {
      id: 'boss',
      source: 'ghostforge-runtime',
      provider: 'copilot-app',
      state: 'working',
      task: 'T-1',
      since: '2026-10-01T11:58:00.000Z',
      leader: true,
      role: 'co-lead',
      model: 'private-model',
    },
    {
      id: 'copilot-cli-worker',
      source: 'ghostforge-runtime',
      provider: 'copilot',
      state: 'idle',
    },
    {
      id: 'claude-worker',
      source: 'remote-cloud',
      provider: 'claude',
      state: 'working',
      task: 'T-2',
      since: '2026-10-01T11:57:00.000Z',
    },
    {
      id: 'boss-shaped-name',
      source: 'ghostforge-runtime',
      provider: 'copilot',
      state: 'disabled',
    },
  ],
  tasks: [
    { id: 'T-0', source: 'ghostforge-runtime', title: 'Prepare base', kind: 'chore', status: 'done', owner: 'boss', dependencies: [] },
    { id: 'T-1', source: 'ghostforge-runtime', title: 'Build world', kind: 'feature', status: 'in-progress', owner: 'boss', progress: 35, dependencies: ['T-0'] },
    { id: 'T-2', source: 'remote-cloud', title: 'Review world', kind: 'review', status: 'blocked', owner: 'claude-worker', dependencies: [] },
  ],
  events: [
    { source: 'remote-cloud', from: 'claude-worker', to: 'claude-session', text: 'Reviewing' },
  ],
}

test('public and maintainer routes are mounted with separate access profiles', () => {
  const productPage = read('app/agent-world/page.tsx')
  const maintainerPage = read('app/maintainer-world/page.tsx')
  const middleware = read('middleware.ts')
  const profiles = read('lib/title-profiles.ts')

  assert.match(productPage, /variant="product"/)
  assert.match(maintainerPage, /variant="maintainer"/)
  assert.match(middleware, /'\/agent-world'/)
  assert.match(middleware, /'\/maintainer-world'/)
  assert.match(profiles, /path: '\/agent-world'.*permission: null/)
  assert.match(profiles, /path: '\/maintainer-world'.*permission: 'admin_tools'/)
})

test('theme contract restores GhostForge Forge and migrates the intermediate TaskVille value', () => {
  assert.deepEqual(world.listThemeLabels(), ['GhostForge Forge', 'Agent Office', 'AI Town'])
  assert.equal(world.migrateStoredTheme('taskville'), 'forge')
  assert.equal(world.migrateStoredTheme('forge'), 'forge')
  assert.equal(world.getThemeStorageKey('product'), 'ghostforge-agent-world-theme:product')
  assert.equal(world.getThemeStorageKey('maintainer'), 'ghostforge-agent-world-theme:maintainer')
})

test('product projection excludes session/message detail while retaining real source, owner, and dependency topology', () => {
  const projection = world.deriveAgentWorldProjection(data, 'product', { health: 84, phase: 3, running: true }, now)

  assert.equal(projection.nodes.some(node => node.kind === 'session'), false)
  assert.equal(projection.nodes.some(node => node.id === 'workspace:local'), false)
  assert.equal(projection.edges.some(edge => edge.type === 'message' || edge.type === 'session'), false)
  assert.equal(projection.edges.some(edge => edge.type === 'owner'), true)
  assert.equal(projection.edges.some(edge => edge.type === 'dependency'), true)
  assert.equal(projection.summary.sources, 2)
  assert.equal(projection.summary.blocked, 1)
  assert.equal(projection.summary.health, 84)
})

test('maintainer projection distinguishes app, CLI, Claude, leadership, sessions, and stale sources', () => {
  const projection = world.deriveAgentWorldProjection(data, 'maintainer', { running: true }, now)
  const boss = projection.nodes.find(node => node.entityId === 'boss')
  const cli = projection.nodes.find(node => node.entityId === 'copilot-cli-worker')
  const claude = projection.nodes.find(node => node.entityId === 'claude-worker')
  const session = projection.nodes.find(node => node.entityId === 'claude-session')
  const remote = projection.nodes.find(node => node.entityId === 'remote-cloud')
  const disabled = projection.nodes.find(node => node.entityId === 'boss-shaped-name')
  const activeTask = projection.nodes.find(node => node.entityId === 'T-1')

  assert.equal(boss.role, 'co-lead')
  assert.match(boss.details.join(' '), /provider: copilot-app/)
  assert.equal(cli.role, 'Copilot CLI')
  assert.equal(claude.role, 'Claude Code')
  assert.equal(session.role, 'Claude Code')
  assert.equal(remote.stale, true)
  assert.equal(disabled.active, false)
  assert.equal(disabled.leader, false)
  assert.equal(disabled.progress, null)
  assert.equal(activeTask.progress, 0.35)
  assert.equal(projection.edges.some(edge => edge.type === 'session'), true)
  assert.equal(projection.edges.some(edge => edge.type === 'message'), true)
  assert.match(projection.notices.join(' '), /stale or offline/)
})

test('positions are deterministic per real node ID and materially differ by world', () => {
  const projection = world.deriveAgentWorldProjection(data, 'maintainer', { running: true }, now)
  const forgeOne = Object.fromEntries(world.layoutWorldNodes(projection.nodes, 'forge'))
  const forgeTwo = Object.fromEntries(world.layoutWorldNodes([...projection.nodes].reverse(), 'forge'))
  const office = Object.fromEntries(world.layoutWorldNodes(projection.nodes, 'office'))
  const town = Object.fromEntries(world.layoutWorldNodes(projection.nodes, 'town'))

  assert.deepEqual(forgeOne, forgeTwo)
  assert.notDeepEqual(forgeOne, office)
  assert.notDeepEqual(forgeOne, town)
  for (const position of Object.values(forgeOne)) {
    assert.equal(position.x >= 0 && position.x <= 1000, true)
    assert.equal(position.y >= 0 && position.y <= 600, true)
  }
})

test('empty, offline, stale, and sensitive text states remain explicit', () => {
  const empty = world.deriveAgentWorldProjection({
    connectors: [],
    sessions: [],
    agents: [],
    tasks: [],
    events: [],
  }, 'maintainer', { running: false }, now)

  assert.equal(empty.ready, false)
  assert.match(empty.notices.join(' '), /No real agent/)
  assert.match(empty.notices.join(' '), /runtime is offline/)
  assert.match(empty.notices.join(' '), /No bounded local or federated session/)
  assert.match(world.sanitizeText('C:\\Users\\operator\\repo token=private'), /\[local path redacted\].*token=\[redacted\]/)
})

test('view renders original spatial scenes, focusable figures, real SVG topology, and text/table fallbacks', () => {
  const view = read('components/AgentWorldView.tsx')

  assert.match(view, /ForgeBackdrop/)
  assert.match(view, /OfficeBackdrop/)
  assert.match(view, /TownBackdrop/)
  assert.match(view, /<EdgeTopology/)
  assert.match(view, /<path[\s\S]*markerEnd/)
  assert.match(view, /aria-label=\{`\$\{kindLabels\[node\.kind\]\}/)
  assert.match(view, /new AbortController\(\)/)
  assert.match(view, /activeRequest\.current\?\.abort\(\)/)
  assert.match(view, /group-focus:block/)
  assert.match(view, /Accessible snapshot table/)
  assert.match(view, /Workflow relationship list/)
  assert.match(view, /role="progressbar"/)
  assert.match(view, /motion-safe:transition/)
  assert.match(view, /overflow-x-auto/)
  assert.doesNotMatch(view, /\b(?:ml|mr|pl|pr|left|right)-/)
})
