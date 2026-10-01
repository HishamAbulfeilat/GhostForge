const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const appDir = path.join(__dirname, '..', 'app', 'agents')
const page = fs.readFileSync(path.join(appDir, 'page.tsx'), 'utf8')
const shell = fs.readFileSync(path.join(appDir, 'AgentWorldShell.tsx'), 'utf8')
const world = fs.readFileSync(path.join(appDir, 'AgentWorld.tsx'), 'utf8')
const standalonePage = fs.readFileSync(path.join(__dirname, '..', 'app', 'agent-world', 'page.tsx'), 'utf8')
const navbar = fs.readFileSync(path.join(__dirname, '..', 'components', 'Navbar.tsx'), 'utf8')
const accessGuard = fs.readFileSync(path.join(__dirname, '..', 'components', 'AccessGuard.tsx'), 'utf8')
const loginPage = fs.readFileSync(path.join(__dirname, '..', 'app', 'login', 'page.tsx'), 'utf8')
const modelPath = path.join(appDir, 'dashboard-model.ts')
const modelSource = fs.readFileSync(modelPath, 'utf8')
const compiledModel = ts.transpileModule(modelSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const modelModule = new Module(modelPath, module)
modelModule.filename = modelPath
modelModule.paths = Module._nodeModulePaths(path.dirname(modelPath))
modelModule._compile(compiledModel, modelPath)
const {
  countOpenTasks,
  findAgentTask,
  formatElapsed,
  getAgentProgress,
  groupTasksByStatus,
  normalizeTaskStatus,
} = modelModule.exports

const tasks = [
  { id: 'T-1', title: 'Todo item', kind: 'feature', status: 'todo', owner: 'worker' },
  { id: 'T-2', title: 'Active item', kind: 'bugfix', status: 'in-progress', owner: 'worker' },
  { id: 'T-3', title: 'Review item', kind: 'test', status: 'review', owner: 'worker' },
  { id: 'T-4', title: 'Finished item', kind: 'docs', status: 'done', owner: 'worker' },
  { id: 'T-5', title: 'Blocked item', kind: 'security', status: 'blocked', owner: null },
]

test('agents dashboard retains authenticated snapshot loading and existing team controls', () => {
  assert.match(page, /<AgentWorldShell/)
  assert.match(standalonePage, /<AgentWorldShell standalone/)
  assert.match(shell, /fetch\(['"]\/api\/agents['"]/)
  assert.match(shell, /fetch\(['"]\/api\/auth\/me['"]/)
  assert.match(shell, /authResponse\.status === 401/)
  assert.match(shell, /\/login\?next=\$\{standalone \? '\/agent-world' : '\/agents'\}/)
  assert.match(shell, /user\.role === 'admin' \|\| authData\.user\.permissions\?\.includes\('admin_tools'\)/)
  assert.match(shell, /action: 'start'/)
  assert.match(shell, /action: 'stop'/)
  assert.match(shell, /action: 'say'/)
  assert.match(shell, /action: 'add'/)
  assert.match(navbar, /href: ['"]\/agents['"]/)
  assert.match(shell, /Start team/)
  assert.match(shell, /Stop team/)
  assert.match(shell, /Refresh/)
  assert.match(shell, /> Say</)
  assert.match(shell, /> Add</)
  assert.match(shell, /id="agent-message"/)
  assert.match(shell, /id="agent-task"/)
  assert.match(shell, /aria-label="Message recipient"/)
  assert.match(shell, /aria-label="Task kind"/)
  assert.match(world, /Phase/)
  assert.match(shell, /<AgentWorld world=\{world\}/)
  assert.match(accessGuard, /pathname === '\/agents' \|\| pathname === '\/agent-world'/)
  assert.match(loginPage, /searchParams\.get\('next'\) \?\? searchParams\.get\('from'\)/)
  assert.match(shell, /role=\{notice\.error \? 'alert' : 'status'\}/)
  assert.match(shell, /void load\(\{ background: true \}\)/)
  assert.match(shell, /Agent-team command completed\./)
  assert.match(shell, /Unable to load the Agent World snapshot\./)
  assert.match(shell, /Enter a message before sending\./)
  assert.match(shell, /Enter a task title before adding it\./)
  assert.match(shell, /document\.visibilityState === 'visible'/)
  assert.match(shell, /AbortController/)
})

test('kanban groups every required state and normalizes the boss in-progress spelling', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(groupTasksByStatus(tasks)).map(([status, items]) => [status, items.map(task => task.id)])),
    {
      todo: ['T-1'],
      'in-progress': ['T-2'],
      review: ['T-3'],
      done: ['T-4'],
      blocked: ['T-5'],
    },
  )
  assert.equal(normalizeTaskStatus('in_progress'), 'in-progress')
  assert.equal(normalizeTaskStatus('inprogress'), 'in-progress')
  assert.equal(countOpenTasks(tasks), 4)
  assert.match(world, /BOARD_COLUMNS\.map\(status/)
  assert.match(world, /statusTone/)
})

test('worker progress comes from assigned outcomes and current-task lookup honors the boss snapshot', () => {
  assert.deepEqual(getAgentProgress('worker', tasks), { completed: 1, total: 4, percentage: 25 })
  assert.deepEqual(getAgentProgress('unassigned', tasks), { completed: 0, total: 0, percentage: 0 })
  assert.equal(findAgentTask('worker', {
    provider: 'copilot', state: 'working', task: 'T-4', model: 'gpt', since: null, cooldownUntil: null,
  }, tasks).id, 'T-4')
  assert.equal(findAgentTask('worker', {
    provider: 'copilot', state: 'working', task: 'external-task', model: 'gpt', since: null, cooldownUntil: null,
  }, tasks).title, 'external-task')
  assert.equal(findAgentTask('worker', {
    provider: 'copilot', state: 'idle', task: null, model: null, since: null, cooldownUntil: null,
  }, [{ ...tasks[3] }]), null)
  assert.match(world, /Current task/)
  assert.match(world, /Provider \/ model/)
})

test('elapsed time uses the boss since timestamp and handles malformed or future timestamps', () => {
  const now = Date.parse('2026-10-01T03:00:00.000Z')
  assert.equal(formatElapsed('2026-10-01T00:30:00.000Z', now), '2h 30m')
  assert.equal(formatElapsed('2026-09-29T03:00:00.000Z', now), '2d 0h')
  assert.equal(formatElapsed('not-a-date', now), '—')
  assert.equal(formatElapsed('2026-10-02T00:00:00.000Z', now), '—')
  assert.match(modelSource, /since: string \| null/)
})

test('history is bounded, hydration-safe, and page has no physical RTL utilities', () => {
  assert.match(world, /world\.events\.slice\(-10\)\.reverse\(\)/)
  assert.match(world, /No events reported\./)
  assert.match(world, /dateTime=\{event\.timestamp/)
  assert.doesNotMatch(shell, /Math\.random/)
  assert.doesNotMatch(`${page}\n${shell}\n${world}`, /\b(?:ml|mr|pl|pr)-\d|\btext-(?:left|right)\b/)
})

test('Agent World renders snapshot-derived views, filters, and attribution', () => {
  assert.match(world, /filterAgentWorld\(world, filters\)/)
  assert.match(world, /agentWorldCounts\(filtered\)/)
  assert.match(world, /world\.sources\.map/)
  assert.match(world, /world\.sessions\.filter/)
  assert.match(world, /world\.edges\.filter/)
  assert.match(world, /aria-label="Agent World task board"/)
  assert.match(world, /Session register/)
  assert.match(world, /Filter by project/)
  assert.match(world, /Filter by workspace/)
  assert.match(world, /Filter by source/)
  assert.match(world, /https:\/\/taskville\.co\/#/)
  assert.match(world, /https:\/\/github\.com\/a16z-infra\/ai-town/)
  assert.match(world, /https:\/\/github\.com\/harishkotra\/agent-office/)
  assert.doesNotMatch(world, /3 live|fake worker|demo worker/i)
})
