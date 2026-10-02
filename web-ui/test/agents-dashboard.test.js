const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const appDir = path.join(__dirname, '..', 'app', 'agents')
const page = fs.readFileSync(path.join(appDir, 'page.tsx'), 'utf8')
const board = fs.readFileSync(path.join(appDir, 'AgentKanbanBoard.tsx'), 'utf8')
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
  buildDependencyGraph,
  findAgentTask,
  formatElapsed,
  getEnabledAgentIds,
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
  assert.match(page, /href="\/agents\/builder"/)
  assert.match(page, /Team \+ workflow builder/)
  assert.match(page, /fetch\(['"]\/api\/agents['"]/)
  assert.match(page, /fetch\(['"]\/api\/auth\/me['"]/)
  assert.match(page, /authResponse\.status === 401/)
  assert.match(page, /router\.replace\('\/login\?next=\/agents'\)/)
  assert.match(page, /user\.role === 'admin' \|\| user\.permissions\?\.includes\('admin_tools'\)/)
  assert.match(page, /action: 'start'/)
  assert.match(page, /action: 'stop'/)
  assert.match(page, /action: 'say'/)
  assert.match(page, /action: 'add'/)
  assert.match(navbar, /href: ['"]\/agents['"]/)
  assert.match(page, /Start team/)
  assert.match(page, /Stop team/)
  assert.match(page, /Refresh/)
  assert.match(page, />Say</)
  assert.match(page, />Add</)
  assert.match(page, /id="agent-message"/)
  assert.match(page, /id="agent-task"/)
  assert.match(page, /aria-label="Message recipient"/)
  assert.match(page, /aria-label="Task kind"/)
  assert.match(page, /Phase/)
  assert.match(page, /<AgentKanbanBoard agents=\{snapshot\.boss \? \{ \.\.\.snapshot\.agents, boss: snapshot\.boss \} : snapshot\.agents\} tasks=\{snapshot\.tasks\} messages=\{displayMessages\}/)
  assert.match(accessGuard, /pathname !== '\/agents'/)
  assert.match(loginPage, /searchParams\.get\('next'\) \?\? searchParams\.get\('from'\)/)
  assert.match(page, /role=\{notice\.error \? 'alert' : 'status'\}/)
  assert.match(page, /onClick=\{\(\) => void load\(\)\}/)
  assert.match(page, /Agent-team command completed\./)
  assert.match(page, /Unable to load agent team\./)
  assert.match(page, /Enter a message before sending\./)
  assert.match(page, /Enter a task title before adding it\./)
  const builder = fs.readFileSync(path.join(appDir, 'builder', 'page.tsx'), 'utf8')
  assert.match(builder, /fetch\('\/api\/auth\/me'/)
  assert.match(builder, /router\.replace\('\/login\?next=\/agents\/builder'\)/)
  assert.match(builder, /user\.permissions\?\.includes\('admin_tools'\)/)
})

test('agents dashboard queues refreshes behind one in-flight load and polls only while visible and running', () => {
  assert.match(page, /const loadPromise = useRef<Promise<void> \| null>\(null\)/)
  assert.match(page, /if \(loadPromise\.current\) \{\s*refreshQueued\.current = true\s*return loadPromise\.current\s*\}/)
  assert.match(page, /do \{\s*refreshQueued\.current = false[\s\S]*?\} while \(refreshQueued\.current\)/)
  assert.match(page, /await load\(\)/)
  assert.match(page, /function subscribeToDashboardUpdates\(load: \(\) => Promise<void>, running: boolean \| undefined\): \(\(\) => void\) \| undefined \{\s*if \(!running\) return/)
  assert.match(page, /document\.visibilityState === ['"]visible['"]/)
  assert.match(page, /window\.setInterval\(refreshWhenVisible, 15_000\)/)
  assert.match(page, /document\.addEventListener\(['"]visibilitychange['"], refreshWhenVisible\)/)
  assert.match(page, /window\.clearInterval\(interval\)/)
  assert.match(page, /document\.removeEventListener\(['"]visibilitychange['"], refreshWhenVisible\)/)
  assert.match(page, /new AbortController\(\)/)
  assert.match(page, /controller\?\.abort\(\)/)
  assert.match(page, /signal\s*\}\)/)
  assert.match(page, /if \(loadController\.current === controller\) \{\s*loadController\.current = null\s*loadPromise\.current = null\s*\}/)
  assert.match(page, /loadController\.current = null\s*loadPromise\.current = null\s*controller\?\.abort\(\)/)
})

test('dashboard assignment pickers exclude disabled agents and fall back to boss/any', () => {
  const agents = {
    enabled: { provider: 'copilot', state: 'idle', task: null, model: null, since: null, cooldownUntil: null, enabled: true },
    disabled: { provider: 'claude', state: 'idle', task: null, model: null, since: null, cooldownUntil: null, enabled: false },
    boss: { provider: 'claude', state: 'working', task: null, model: 'opus', since: null, cooldownUntil: null, enabled: true },
  }
  assert.deepEqual(getEnabledAgentIds(agents), ['enabled', 'boss'])
  assert.match(page, /getEnabledAgentIds\(snapshot\.agents\)\.filter\(id => id !== 'boss'\)/)
  assert.match(page, /keepAvailableSelection\(current, 'boss', enabledAgentIds\)/)
  assert.match(page, /keepAvailableSelection\(current, 'any', enabledAgentIds\)/)
  assert.match(page, /keepAvailableSelection\(current, 'all', recipientIds\)/)
  assert.match(page, /value=\{assignee\}/)
  assert.match(page, /confirmTeamStop\(\(\) => void run\('stop', \{ action: 'stop' \}\)\)/)
  assert.match(page, /AbortController/)
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
  assert.match(board, /BOARD_COLUMNS\.map\(status/)
  assert.match(board, /statusStyles/)
  assert.match(board, /badgeStyles/)
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
  assert.match(board, /Tasks complete \(estimate\)/)
  assert.match(board, /Current task/)
  assert.match(board, /Provider/)
  assert.match(board, /Model/)
})

test('dependency graph resolves task links and safely reports missing, ambiguous, and cyclic references', () => {
  const graph = buildDependencyGraph([
    { ...tasks[0], dependencies: ['T-2', ' missing ', 'T-4', 'T-2'] },
    { ...tasks[1], dependencies: ['T-1'] },
    { ...tasks[2], id: 'T-4' },
    { ...tasks[3], id: 'T-4' },
  ])

  assert.deepEqual(graph.map(node => ({
    key: node.key,
    dependencies: node.dependencyNodeKeys,
    missing: node.missingDependencies,
    ambiguous: node.ambiguousDependencies,
    cyclic: node.cyclic,
  })), [
    { key: 'task-0', dependencies: ['task-1'], missing: ['missing'], ambiguous: ['T-4'], cyclic: true },
    { key: 'task-1', dependencies: ['task-0'], missing: [], ambiguous: [], cyclic: true },
    { key: 'task-2', dependencies: [], missing: [], ambiguous: [], cyclic: false },
    { key: 'task-3', dependencies: [], missing: [], ambiguous: [], cyclic: false },
  ])
  assert.deepEqual(buildDependencyGraph([]), [])
})

test('dependency graph exposes acceptance criteria through keyboard-operable UI and responsive task links', () => {
  const graph = buildDependencyGraph([{
    ...tasks[0],
    dependencies: ['T-2'],
    acceptanceCriteria: ['  Criterion one ', '', 'Criterion two'],
  }])
  assert.equal(graph[0].task.acceptanceCriteria[0], '  Criterion one ')
  assert.match(board, /buildDependencyGraph\(tasks\)/)
  assert.match(board, /aria-labelledby="workflow-dependencies-heading"/)
  assert.match(board, /<ol className="grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"/)
  assert.match(board, /href=\{`#\$\{dependency\.anchorId\}`\}/)
  assert.match(board, /<details/)
  assert.match(board, /<summary className=/)
  assert.match(board, /Acceptance criteria \(\{criteria\.length\}\)/)
  assert.match(board, /Unavailable task:/)
  assert.match(board, /Ambiguous task ID:/)
  assert.match(board, /Circular dependency/)
})

test('elapsed time uses the boss since timestamp and handles malformed or future timestamps', () => {
  const now = Date.parse('2026-10-01T03:00:00.000Z')
  assert.equal(formatElapsed('2026-10-01T00:30:00.000Z', now), '2h 30m')
  assert.equal(formatElapsed('2026-09-29T03:00:00.000Z', now), '2d 0h')
  assert.equal(formatElapsed('not-a-date', now), '—')
  assert.equal(formatElapsed('2026-10-02T00:00:00.000Z', now), '—')
  assert.match(modelSource, /since: string \| null/)
  assert.match(board, /formatElapsed\(agent\.since, now\)/)
  assert.match(board, /setNow\(Date\.now\(\)\)/)
})

test('history is bounded, hydration-safe, and page has no duplicate worker or task grid', () => {
  assert.match(board, /messages\.slice\(-6\)\.reverse\(\)/)
  assert.match(board, /Recent history/)
  assert.match(board, /teamMessage\.text/)
  assert.match(board, /dateTime=\{teamMessage\.datetime\}/)
  assert.match(board, /No recent team history\./)
  assert.match(board, /now === null \|\| .*formatElapsed\(agent\.since, now\)/)
  assert.match(page, /formatDisplayMessages\(snapshot\?\.messages\)/)
  assert.match(page, /Unknown sender/)
  assert.match(page, /Unknown recipient/)
  assert.doesNotMatch(page, /aria-labelledby="workers-heading"/)
  assert.doesNotMatch(page, /snapshot\.tasks\.map/)
  assert.match(page, /function formatDisplayMessages[\s\S]*date\.toLocaleString\(/)
  assert.match(page, /useEffect\(\(\) => \{\s*setDisplayMessages\(formatDisplayMessages\(snapshot\?\.messages\)\)/)
  assert.doesNotMatch(page, /function normalizeMessages[\s\S]{0,500}toLocaleString\(/)
  assert.doesNotMatch(page, /Math\.random|Date\.now\s*\(/)
  assert.doesNotMatch(`${page}\n${board}`, /\b(?:ml|mr|pl|pr)-\d|\btext-(?:left|right)\b/)
})
