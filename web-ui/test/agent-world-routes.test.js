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
const snapshot = {
  health: 84,
  running: true,
  agents: {
    boss: {
      provider: 'copilot',
      state: 'working',
      task: 'T-1',
      model: 'private-model',
      since: '2026-10-01T11:58:00.000Z',
      cooldownUntil: null,
      enabled: true,
      role: 'coordinator',
      strengths: ['review'],
      branch: 'agent/private',
    },
    claude: {
      provider: 'claude',
      state: 'disabled',
      task: null,
      model: null,
      since: null,
      cooldownUntil: null,
      enabled: false,
      role: 'worker',
      strengths: ['architecture'],
      branch: 'agent/claude',
    },
  },
  tasks: [
    { id: 'T-1', title: 'Build world', kind: 'feature', status: 'in-progress', owner: 'boss' },
    { id: 'T-2', title: 'Review world', kind: 'review', status: 'blocked', owner: 'claude' },
  ],
  messages: [
    { from: 'boss', to: 'claude', text: 'Please review' },
    { from: 'boss', to: 'all', text: 'Status' },
  ],
  phase: 3,
}

test('public and maintainer routes are mounted and use distinct variants', () => {
  const productPage = read('app/agent-world/page.tsx')
  const maintainerPage = read('app/maintainer-world/page.tsx')
  const middleware = read('middleware.ts')

  assert.match(productPage, /variant="product"/)
  assert.match(maintainerPage, /variant="maintainer"/)
  assert.match(middleware, /'\/agent-world'/)
  assert.match(middleware, /'\/maintainer-world'/)
})

test('theme choices are stable and persisted separately for each world', () => {
  assert.deepEqual(world.listThemeLabels(), ['TaskVille', 'AI Town', 'Agent Office'])
  assert.equal(world.getThemeStorageKey('product'), 'ghostforge-agent-world-theme:product')
  assert.equal(world.getThemeStorageKey('maintainer'), 'ghostforge-agent-world-theme:maintainer')
})

test('product projection hides disabled sessions and private message relationships', () => {
  const projection = world.deriveAgentWorldProjection(snapshot, 'product', now)

  assert.equal(projection.nodes.some(node => node.id === 'claude'), false)
  assert.equal(projection.nodes.some(node => node.id === 'workspace:local'), false)
  assert.deepEqual(projection.edges.map(edge => edge.type), ['owner'])
  assert.equal(projection.summary.blocked, 1)
  assert.equal(projection.summary.health, 84)
})

test('maintainer projection includes configured roles and real coordination edges', () => {
  const projection = world.deriveAgentWorldProjection(snapshot, 'maintainer', now)
  const boss = projection.nodes.find(node => node.id === 'boss')
  const claude = projection.nodes.find(node => node.id === 'claude')

  assert.equal(boss.role, 'coordinator')
  assert.match(boss.details.join(' '), /model: private-model/)
  assert.match(boss.details.join(' '), /branch: agent\/private/)
  assert.equal(claude.status, 'disabled')
  assert.equal(projection.edges.some(edge => edge.type === 'message' && edge.from === 'boss' && edge.to === 'claude'), true)
  assert.equal(projection.edges.some(edge => edge.to === 'all'), false)
})

test('stale, empty, and sensitive text states remain explicit', () => {
  const staleSnapshot = structuredClone(snapshot)
  staleSnapshot.agents.boss.since = '2026-10-01T10:00:00.000Z'
  staleSnapshot.tasks[0].title = 'Read C:\\Users\\operator\\repo token=private'
  const projection = world.deriveAgentWorldProjection(staleSnapshot, 'maintainer', now)
  const boss = projection.nodes.find(node => node.id === 'boss')

  assert.equal(boss.stale, true)
  assert.match(boss.task, /\[local path redacted\]/)
  assert.match(boss.task, /token=\[redacted\]/)

  const empty = world.deriveAgentWorldProjection(null, 'maintainer', now)
  assert.equal(empty.ready, false)
  assert.match(empty.notices.join(' '), /No agent or workflow data/)
  assert.match(empty.notices.join(' '), /offline/)
})

test('access profiles make Agent World authenticated and Maintainer World admin-only', () => {
  const profiles = read('lib/title-profiles.ts')
  const navbar = read('components/Navbar.tsx')

  assert.match(profiles, /path: '\/agent-world'.*permission: null/)
  assert.match(profiles, /path: '\/maintainer-world'.*permission: 'admin_tools'/)
  assert.match(navbar, /href: '\/agent-world'/)
  assert.match(navbar, /href: '\/maintainer-world'/)
})

test('view fetches the public and private API shapes and exposes an accessible fallback', () => {
  const view = read('components/AgentWorldView.tsx')

  assert.match(view, /\/api\/agents\?view=public/)
  assert.match(view, /variant === 'product' \? '\/api\/agents\?view=public' : '\/api\/agents'/)
  assert.match(view, /Accessible snapshot table/)
  assert.match(view, /role="progressbar"/)
  assert.match(view, /motion-safe:transition-colors/)
  assert.doesNotMatch(view, /\b(?:ml|mr|pl|pr|left|right)-/)
})
