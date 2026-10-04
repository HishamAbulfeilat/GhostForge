// Unit tests for the agent team (run: node --test scripts/agents/agents.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { routeModel, classifyTask, KIND_TIER } from './lib/models.mjs'
import { addTask, areasOverlap, say, readMessages, writeResult, takeResult, loadBoard, saveBoard } from './lib/bus.mjs'
import { commandFor, RATE_LIMIT_RE, winQuote } from './lib/providers.mjs'
import { Boss, describeGitError, lastJSON, pickTask, reviewDiff, shouldRestartBoss, stagePrompt } from './boss.mjs'
import { scoreOf, checks, needsDeps, pythonProbe, BRIDGE_TEST_MODULES } from './health.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('classifyTask maps free text to task kinds', () => {
  assert.equal(classifyTask('Fix SSRF in github-profile'), 'security')
  assert.equal(classifyTask('Add tests for the job store'), 'test')
  assert.equal(classifyTask('Fix crash when profile is empty'), 'bugfix')
  assert.equal(classifyTask('Refresh README'), 'docs')
  assert.equal(classifyTask('Agent Teams page'), 'feature')
})

test('routeModel sends deep work to deep models and chores to fast ones', () => {
  assert.deepEqual(routeModel('claude', { kind: 'security' }), { model: 'opus', tier: 'deep', kind: 'security' })
  assert.equal(routeModel('claude', { kind: 'feature' }).model, 'sonnet')
  assert.equal(routeModel('claude', { kind: 'docs' }).model, 'haiku')
  assert.equal(routeModel('copilot', { kind: 'security' }).model, 'auto')
  assert.equal(routeModel('unknown-provider', { kind: 'feature' }).model, 'auto')
  assert.equal(routeModel('claude', { kind: 'feature', model: 'opus' }).model, 'opus', 'explicit pin wins')
  assert.equal(routeModel('claude', { kind: 'docs' }, { claude: { fast: 'sonnet' } }).model, 'sonnet', 'team.json override')
  for (const tier of Object.values(KIND_TIER)) assert.ok(['deep', 'balanced', 'fast'].includes(tier))
})

test('areasOverlap treats path prefixes and empty areas as overlapping', () => {
  assert.equal(areasOverlap(['web-ui'], ['web-ui/lib/ai.ts']), true)
  assert.equal(areasOverlap(['web-ui/lib'], ['web-ui/app']), false)
  assert.equal(areasOverlap(['web-ui/app'], ['web-ui/application']), false, 'prefix must end at a path boundary')
  assert.equal(areasOverlap([], ['tui']), true, 'whole-repo task overlaps everything')
  assert.equal(areasOverlap(['tui\\index.js'], ['tui/']), true, 'normalizes separators and trailing slashes')
})

test('pickTask respects owner tags, area locks, and strengths', () => {
  const board = { phase: 1, nextId: 1, tasks: [] }
  addTask(board, { title: 'docs thing', kind: 'docs', area: ['README.md'] })
  addTask(board, { title: 'security thing', kind: 'security', area: ['web-ui/lib'] })
  addTask(board, { title: 'copilot only', kind: 'feature', area: ['tui'], agent: 'copilot' })
  assert.equal(pickTask(board.tasks, 'claude', ['security', 'docs']).title, 'security thing')
  assert.equal(pickTask(board.tasks, 'copilot', ['feature']).title, 'copilot only')
  board.tasks[1].status = 'in-progress'
  addTask(board, { title: 'overlaps busy', kind: 'security', area: ['web-ui/lib/ai.ts'] })
  assert.equal(pickTask(board.tasks, 'claude', ['security', 'docs']).title, 'docs thing', 'busy area is locked')
})

test('addTask dedupes open tasks by title', () => {
  const board = { phase: 1, nextId: 1, tasks: [] }
  const a = addTask(board, { title: 'same', kind: 'chore' })
  const b = addTask(board, { title: 'same', kind: 'chore' })
  assert.equal(a.id, b.id)
  assert.equal(board.tasks.length, 1)
})

test('team add preserves orchestration metadata through request ingestion to the board', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-team-add-'))
  const previousStateDir = process.env.GF_AGENT_STATE
  const env = { ...process.env, GF_AGENT_STATE: dir }
  try {
    const cli = spawnSync(process.execPath, [
      fileURLToPath(new URL('./team.mjs', import.meta.url)),
      'add', 'Preserve orchestration metadata',
      '--kind', 'feature',
      '--area', 'scripts/agents',
      '--agent', 'copilot-tui',
      '--leader', 'copilot-integration',
      '--workflow', 'sequential',
      '--dependencies', 'T-120,T-121',
      '--acceptance-criteria', 'Regression test passes;health check passes',
      '--from', 'web-ui',
    ], { encoding: 'utf8', env })
    assert.equal(cli.status, 0, cli.stderr)

    process.env.GF_AGENT_STATE = dir
    const boss = new Boss()
    const board = { phase: 4, nextId: 1, tasks: [] }
    boss.ingestRequests(board)
    saveBoard(dir, board)
    const queued = loadBoard(dir).tasks[0]

    assert.equal(queued.agent, 'copilot-tui')
    assert.equal(queued.assignee, 'copilot-tui')
    assert.equal(queued.leader, 'copilot-integration')
    assert.equal(queued.workflow, 'sequential')
    assert.deepEqual(queued.dependencies, ['T-120', 'T-121'])
    assert.deepEqual(queued.acceptanceCriteria, ['Regression test passes', 'health check passes'])
  } finally {
    if (previousStateDir === undefined) delete process.env.GF_AGENT_STATE
    else process.env.GF_AGENT_STATE = previousStateDir
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('team dispatch preserves the leader and defaults assignment to any through boss ingestion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-team-dispatch-'))
  const previousStateDir = process.env.GF_AGENT_STATE
  const env = { ...process.env, GF_AGENT_STATE: dir }
  try {
    const cli = spawnSync(process.execPath, [
      fileURLToPath(new URL('./team.mjs', import.meta.url)),
      'dispatch', 'Dispatch with defaults',
    ], { encoding: 'utf8', env })
    assert.equal(cli.status, 0, cli.stderr)

    process.env.GF_AGENT_STATE = dir
    const request = JSON.parse(fs.readFileSync(path.join(dir, 'requests.jsonl'), 'utf8'))
    assert.equal(request.agent, 'any')
    assert.equal(request.assignee, 'any')
    assert.equal(request.leader, 'boss')

    const boss = new Boss()
    const board = { phase: 4, nextId: 1, tasks: [] }
    boss.ingestRequests(board)
    const queued = board.tasks[0]
    assert.equal(queued.agent, 'any')
    assert.equal(queued.assignee, 'any')
    assert.equal(queued.leader, 'boss')
  } finally {
    if (previousStateDir === undefined) delete process.env.GF_AGENT_STATE
    else process.env.GF_AGENT_STATE = previousStateDir
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('bus round-trips board, messages, and results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bus-'))
  try {
    fs.mkdirSync(path.join(dir, 'results'))
    const board = loadBoard(dir)
    addTask(board, { title: 't', kind: 'chore' })
    saveBoard(dir, board)
    assert.equal(loadBoard(dir).tasks[0].id, 'T-001')

    say(dir, 'claude', 'copilot', 'hi')
    say(dir, 'boss', 'all', 'broadcast')
    say(dir, 'copilot', 'gemini', 'not for claude')
    assert.deepEqual(readMessages(dir, { to: 'claude' }).map(m => m.text), ['hi', 'broadcast'])

    writeResult(dir, 'T-001', { agent: 'claude', outcome: 'done', summary: 's' })
    assert.equal(takeResult(dir, 'T-001').outcome, 'done')
    assert.equal(takeResult(dir, 'T-001'), null, 'result is consumed once')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('provider adapters deny pushes for workers and are read-only for the boss', () => {
  const work = commandFor('claude', { prompt: 'p', model: 'sonnet', mode: 'work' })
  assert.equal(work.cmd, 'claude')
  assert.ok(work.args.includes('Bash(git push:*)'))
  assert.ok(commandFor('claude', { prompt: 'p', model: 'opus', mode: 'readonly' }).args.includes('plan'))
  const cop = commandFor('copilot', { prompt: 'p', model: 'auto', mode: 'work' })
  assert.deepEqual(cop.args.slice(0, 4), ['-p', 'p', '--model', 'auto'])
  assert.ok(cop.args.includes('shell(git push)'))
  assert.ok(!cop.args.includes('shell(git rebase)'), 'workers may rebase their own branch before integration')
  assert.ok(!work.args.includes('Bash(git rebase:*)'), 'workers may rebase their own branch before integration')
  assert.ok(!commandFor('codex', { prompt: 'p', model: 'auto', mode: 'work' }).args.includes('-m'), 'auto → provider default')
  assert.throws(() => commandFor('nope', {}), /Unknown provider/)
  assert.ok(RATE_LIMIT_RE.test('Error: 429 Too Many Requests'))
  assert.ok(RATE_LIMIT_RE.test("You've hit your session limit · resets 5:40am (Asia/Amman)"), 'Claude session-limit message')
  assert.ok(RATE_LIMIT_RE.test("You've hit your weekly limit"))
  assert.equal(winQuote('a b'), '"a b"')
  assert.equal(winQuote('--model'), '--model')
})

test('runtime prompts are staged inside the executing worktree', () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-prompt-'))
  try {
    const file = stagePrompt(worktree, 'tasks', 'T-001-copilot.md', 'task prompt')
    assert.equal(file, path.join(worktree, '.agent-sync', 'state', 'tasks', 'T-001-copilot.md'))
    assert.equal(fs.readFileSync(file, 'utf8'), 'task prompt')
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true })
  }
})

test('team config: every enabled worker has its own provider, worktree and branch', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../../.agent-sync/team.json', import.meta.url), 'utf8'))
  const workers = Object.entries(config.agents).filter(([, agent]) => agent.enabled)
  assert.ok(workers.length >= 1, 'at least one enabled worker')
  for (const [id, agent] of workers) {
    assert.ok(agent.provider && agent.worktree && agent.branch, `${id} needs provider, worktree and branch`)
  }
  assert.equal(new Set(workers.map(([, agent]) => agent.worktree)).size, workers.length, 'worktrees are not shared')
  assert.equal(new Set(workers.map(([, agent]) => agent.branch)).size, workers.length, 'branches are not shared')
})

test('lastJSON finds the verdict line in model output', () => {
  assert.deepEqual(lastJSON('Looks good.\n{"approve": true, "issues": []}\n'), { approve: true, issues: [] })
  assert.deepEqual(lastJSON('```json\n{"approve": false, "issues": ["x"]}\n```'), { approve: false, issues: ['x'] })
  assert.deepEqual(lastJSON('plan:\n{\n  "phaseComplete": false,\n  "tasks": []\n}\ndone'), { phaseComplete: false, tasks: [] })
  assert.equal(lastJSON('no json here'), null)
})

test('scoreOf weights checks and ignores skipped ones', () => {
  assert.equal(scoreOf([{ ok: true, weight: 20 }, { ok: false, weight: 20 }]), 50)
  assert.equal(scoreOf([{ ok: true, weight: 10 }, { ok: false, skipped: true, weight: 90 }]), 100)
  assert.equal(scoreOf([]), 0)
})

test('needsDeps skips — not fails — when a toolchain is absent, and runs when it is present', () => {
  let ran = 0
  const inner = () => (ran++, { ok: true, output: 'ok', ms: 1 })

  const absent = needsDeps(() => false, 'thing/node_modules missing — run `cd thing && npm ci`', inner)()
  assert.equal(absent.skipped, true, 'a missing dependency is not a code defect')
  assert.equal(absent.ok, false, 'a skip is never ok — it must stay visible in the report')
  assert.match(absent.output, /thing\/node_modules missing/, 'the hint names how to fix it')
  assert.equal(absent.ms, 0)
  assert.equal(ran, 0, 'the real check must not run without its deps')

  const present = needsDeps(() => true, 'unused', inner)()
  assert.deepEqual(present, { ok: true, output: 'ok', ms: 1 })
  assert.equal(present.skipped, undefined, 'a running check is never marked skipped')
  assert.equal(ran, 1, 'the real check runs once deps are present')
})

test('a skipped check is dropped from the score entirely, so an uninstalled tree cannot lower it', () => {
  // The shape that motivated the rule: mcp's suite cannot run without its
  // node_modules, and reporting that as a failure sent the boss after a defect
  // that was never in the code (the web-ui/app/.omc failure, T-010).
  const withDeps = scoreOf([{ ok: true, weight: 15 }, { ok: true, weight: 5 }])
  const withoutDeps = scoreOf([{ ok: true, weight: 15 }, { ok: false, skipped: true, weight: 5 }])
  assert.equal(withDeps, 100)
  assert.equal(withoutDeps, 100, 'skipping must not cost points')
})

test('the added checks skip on a checkout with no node_modules and no bridge tests', () => {
  // A bare tree: nothing installed anywhere. Every added check must SKIP, so a
  // fresh clone scores 100 instead of collapsing on missing toolchains. The
  // mark-l-bridge dir is left empty on purpose so this holds whether or not the
  // machine running it has pytest — a bare dir makes pytest exit 5, not 0.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-health-bare-'))
  try {
    for (const dir of ['mcp', 'tui', 'electron-app', 'web-ui', 'mark-l-bridge']) fs.mkdirSync(path.join(bare, dir))
    const byId = Object.fromEntries(checks(bare).map(c => [c.id, c]))
    for (const id of ['mcp-tests', 'tui-tests', 'electron-tests', 'bridge-tests']) {
      const r = byId[id].run()
      assert.equal(r.skipped, true, `${id} must skip without its toolchain`)
      assert.match(r.output, /missing|not found|not installed|no .* tests/, `${id} explains why it skipped`)
    }
  } finally {
    fs.rmSync(bare, { recursive: true, force: true })
  }
})

test('each added check is a real suite runner for the surface its label claims', () => {
  // Regression guard for the blind spot itself: a check that only syntax-checks
  // (mcp-parse) or byte-compiles (bridge-compile) must not be able to pose as
  // the suite it stands in for.
  const all = checks(ROOT)
  const find = id => all.find(c => c.id === id)
  assert.match(find('mcp-tests').label, /MCP server unit tests/)
  assert.match(find('tui-tests').label, /TUI unit tests/)
  assert.match(find('electron-tests').label, /Electron desktop app tests/)
  assert.match(find('bridge-tests').label, /bridge tests \(pytest\)/)
  for (const id of ['mcp-tests', 'tui-tests', 'electron-tests', 'bridge-tests']) {
    assert.ok(find(id).weight > 0, `${id} counts toward the score`)
  }
})

test('pythonProbe reports an importable interpreter and names what is missing otherwise', () => {
  // stdlib, so this passes on any machine with a working interpreter — and it
  // is the regression guard for running the probe without shell:true. With a
  // shell on Windows the `-c` argument gets word-split and python sees a bare
  // `import`, so the probe reported "json not installed" on a healthy install.
  const ok = pythonProbe(['json'])
  assert.equal(ok.ok, true, 'a stdlib import must succeed on any working interpreter')
  assert.ok(ok.cmd, 'names the interpreter to run pytest with')

  const missing = pythonProbe(['definitely_not_a_real_module_xyz'])
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /definitely_not_a_real_module_xyz not installed/)
  assert.equal(missing.cmd, undefined, 'a probe that failed cannot name a command')
})

test('the bridge pytest modules match what CI installs for the same suite', () => {
  // If these drift apart, health skips a suite CI still runs (or vice versa),
  // and the two disagree about whether the bridge is healthy.
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pr-check.yml'), 'utf8')
  const install = workflow.match(/pip install ([^\n#]*)/g).join(' ')
  for (const mod of BRIDGE_TEST_MODULES) {
    assert.ok(new RegExp(`\\b${mod === 'multipart' ? 'python-multipart' : mod}\\b`).test(install), `CI installs ${mod}`)
  }
  assert.ok(BRIDGE_TEST_MODULES.includes('pytest'), 'the suite itself must be probed')
})

test('strayNeedle never lets one worktree match a sibling that shares its prefix', async () => {
  const { strayNeedle } = await import('./boss.mjs')
  const claude = strayNeedle(path.join(os.tmpdir(), 'gf-claude'))
  const sibling = path.join(os.tmpdir(), 'gf-claude-2', 'web-ui', 'node_modules', 'next', 'dist', 'bin', 'next')
  const own = path.join(os.tmpdir(), 'gf-claude', 'web-ui', 'node_modules', 'next', 'dist', 'bin', 'next')
  assert.equal(`node ${sibling} dev`.includes(claude), false, 'sibling worktree must not match')
  assert.equal(`node ${own} dev`.includes(claude), true, 'own worktree must match')
})

test('pickTask waits for a task’s dependencies to be done', () => {
  const tasks = [
    { id: 'T-1', status: 'todo', agent: 'any', area: ['a'], phase: 1, kind: 'feature' },
    { id: 'T-2', status: 'todo', agent: 'any', area: ['b'], phase: 1, kind: 'feature', dependencies: ['T-1'] },
  ]
  assert.equal(pickTask(tasks, 'w', []).id, 'T-1')
  tasks[0].status = 'in-progress'
  assert.equal(pickTask(tasks, 'w', []), undefined, 'T-2 blocked until T-1 is done')
  tasks[0].status = 'done'
  assert.equal(pickTask(tasks, 'w', []).id, 'T-2')
})

test('bossModelFor uses the deep model for security and large diffs, the review model otherwise', async () => {
  const { bossModelFor } = await import('./boss.mjs')
  const boss = { model: 'opus', reviewModel: 'sonnet' }
  assert.equal(bossModelFor('feature', 120, boss), 'sonnet')
  assert.equal(bossModelFor('security', 10, boss), 'opus')
  assert.equal(bossModelFor('bugfix', 900, boss), 'opus')
  assert.equal(bossModelFor('feature', 120, { model: 'opus' }), 'opus', 'no reviewModel → single model')
})

test('releaseStuckTasks frees todo tasks pinned to a cooling-down or unknown agent', async () => {
  const { releaseStuckTasks } = await import('./boss.mjs')
  const now = Date.parse('2026-10-01T04:00:00Z')
  const tasks = [
    { id: 'T-1', status: 'todo', agent: 'claude' },
    { id: 'T-2', status: 'todo', agent: 'copilot-web' },
    { id: 'T-3', status: 'todo', agent: 'gone' },
    { id: 'T-4', status: 'in-progress', agent: 'claude' },
    { id: 'T-5', status: 'todo', agent: 'any' },
  ]
  const state = { claude: { cooldownUntil: '2026-10-01T04:20:00Z' }, 'copilot-web': { cooldownUntil: null } }
  assert.equal(releaseStuckTasks(tasks, state, now), 2)
  assert.deepEqual(tasks.map(t => t.agent), ['any', 'copilot-web', 'any', 'claude', 'any'])
})

test('blockTasksWithUnavailableDependencies blocks todo tasks whose dependency is blocked or unknown, cascading', async () => {
  const { blockTasksWithUnavailableDependencies } = await import('./boss.mjs')
  const tasks = [
    { id: 'T-1', status: 'blocked' },
    { id: 'T-2', status: 'todo', dependencies: ['T-1'] },
    { id: 'T-3', status: 'todo', dependencies: ['T-2'] },
    { id: 'T-4', status: 'todo', dependencies: ['T-99'] },
    { id: 'T-5', status: 'todo', dependencies: ['T-6'] },
    { id: 'T-6', status: 'in-progress' },
    { id: 'T-7', status: 'todo' },
  ]
  assert.equal(blockTasksWithUnavailableDependencies(tasks), 3)
  assert.deepEqual(tasks.map(t => t.status), ['blocked', 'blocked', 'blocked', 'blocked', 'todo', 'in-progress', 'todo'])
  assert.match(tasks[1].lastFailure, /T-1 \(blocked\)/)
  assert.match(tasks[3].lastFailure, /T-99 \(unknown\)/)
})

test('pickTask skips tasks with incomplete dependencies or an active hold cooldown', () => {
  const now = Date.parse('2026-10-02T10:00:00Z')
  const tasks = [
    { id: 'T-1', status: 'done', area: ['a/'], agent: 'any', kind: 'feature', phase: 1 },
    { id: 'T-2', status: 'todo', area: ['b/'], agent: 'any', kind: 'feature', phase: 1, dependencies: ['T-3'] },
    { id: 'T-3', status: 'todo', area: ['c/'], agent: 'any', kind: 'feature', phase: 1, holdUntil: '2026-10-02T10:30:00Z' },
    { id: 'T-4', status: 'todo', area: ['d/'], agent: 'any', kind: 'feature', phase: 1, dependencies: ['T-1'] },
  ]
  assert.equal(pickTask(tasks, 'x', [], now).id, 'T-4')
  assert.equal(pickTask(tasks, 'x', [], Date.parse('2026-10-02T11:00:00Z')).id, 'T-3', 'hold expired')
})

test('a security review with no verdict is held (no attempt burned); other kinds rely on health checks', async () => {
  const stub = {
    cfg: { boss: { review: true }, cooldownMinutes: 10 },
    log() {}, intWt: fs.mkdtempSync(path.join(os.tmpdir(), 'gf-hold-')),
    readonlyRun: async () => ({ output: 'no json here', code: 0 }),
  }
  const { execFileSync } = await import('node:child_process')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const review = Boss.prototype.review.bind(stub)
  assert.deepEqual(await review({ id: 'T-1', kind: 'security', title: 't', area: [] }, 'a', head, head), { approve: false, hold: true })
  assert.deepEqual(await review({ id: 'T-2', kind: 'feature', title: 't', area: [] }, 'a', head, head), { approve: true })

  const updates = []
  const holder = {
    cfg: { cooldownMinutes: 10 }, intWt: root, log() {}, say() {},
    updateTask: (id, patch) => updates.push([id, patch]),
  }
  const holdRef = 'refs/agent-hold/T-TEST-161'
  try {
    Boss.prototype.holdForReview.call(holder, { id: 'T-TEST-161', attempts: 1 }, 'claude-2', 'base1', head)
    const [, patch] = updates[0]
    assert.equal(patch.status, 'todo')
    assert.equal(patch.owner, null)
    assert.ok(Date.parse(patch.holdUntil) > Date.now())
    assert.deepEqual(patch.held, { agent: 'claude-2', base: 'base1', head })
    assert.ok(!('attempts' in patch), 'hold must not burn an attempt')
    assert.equal(execFileSync('git', ['rev-parse', holdRef], { cwd: root, encoding: 'utf8' }).trim(), head, 'commits pinned by ref')
  } finally {
    spawnSync('git', ['update-ref', '-d', holdRef], { cwd: root })
  }
})

test('reviewDiff stays bounded for a commit deleting many large files', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-review-diff-'))
  const run = (...args) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  try {
    run('init', '-q')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'test')
    run('config', 'core.autocrlf', 'false')
    fs.mkdirSync(path.join(repo, 'node_modules'))
    const big = 'x'.repeat(100) + '\n'
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(repo, 'node_modules', `f${i}.js`), big.repeat(1000)) // ~100 KB each
    fs.writeFileSync(path.join(repo, 'keep.txt'), 'keep\n')
    run('add', '-A'); run('commit', '-qm', 'base')
    const base = run('rev-parse', 'HEAD')
    run('rm', '-rq', '--cached', 'node_modules')
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n')
    run('add', '.gitignore'); run('commit', '-qm', 'untrack node_modules')
    const head = run('rev-parse', 'HEAD')

    const full = reviewDiff(repo, base, head)
    assert.equal(full.truncated, false, 'deleted preimages are omitted, so ~6 MB of deletions stays tiny')
    assert.ok(full.diff.length < 20_000, `diff is ${full.diff.length} chars`)
    assert.ok(!full.diff.includes('xxxxxxxxxx'), 'no deleted file content in the review diff')
    assert.match(full.diff, /deleted file mode/)
    assert.match(full.diff, /\+node_modules\//, 'real additions are still shown')
    assert.match(full.stat, /60 files changed|61 files changed/)
    assert.match(full.stat, /f59\.js/, 'stat lists every deleted file')

    const capped = reviewDiff(repo, base, head, 500)
    assert.equal(capped.truncated, true)
    assert.ok(capped.diff.length < 500 + 300, 'capped diff is bounded by the limit plus the marker')
    assert.match(capped.diff, /diff truncated for review/)
    assert.equal(capped.stat, full.stat, 'stat is never truncated')
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('spawn limits: >1 MiB child output succeeds and ENOBUFS is explained', async () => {
  const { createRequire } = await import('node:module')
  const { execFileSync } = await import('node:child_process')
  const { MAX_BUFFER, explainEnobufs } = createRequire(import.meta.url)('../spawn-limits.cjs')
  const emit = ['-e', "process.stdout.write('x'.repeat(3 * 1024 * 1024))"]
  // Default 1 MiB limit fails with ENOBUFS...
  let raw
  try { execFileSync(process.execPath, emit, { encoding: 'utf8', stdio: 'pipe' }) } catch (e) { raw = e }
  assert.ok(raw, 'default maxBuffer must overflow on 3 MiB')
  const msg = explainEnobufs(raw, 'node emit').message
  assert.match(msg, /node emit produced more than 256 MiB.*ENOBUFS/)
  // ...the shared limit does not.
  const out = execFileSync(process.execPath, emit, { encoding: 'utf8', stdio: 'pipe', maxBuffer: MAX_BUFFER })
  assert.equal(out.length, 3 * 1024 * 1024)
  // Non-ENOBUFS errors pass through untouched.
  const other = new Error('boom')
  assert.equal(explainEnobufs(other, 'x'), other)
})

test('shouldRestartBoss restarts only when the scripts/agents revision changed', () => {
  assert.equal(shouldRestartBoss('abc', 'abc'), false, 'unchanged')
  assert.equal(shouldRestartBoss('abc', 'def'), true, 'changed')
  assert.equal(shouldRestartBoss(null, 'def'), false, 'no startup revision recorded')
  assert.equal(shouldRestartBoss('abc', null), false, 'git lookup failed')
  assert.equal(shouldRestartBoss('', ''), false)
})

test('describeGitError names the failing command and is idempotent', () => {
  const e = Object.assign(new Error('spawnSync git ENOBUFS'), { code: 'ENOBUFS' })
  const msg = describeGitError(e, ['diff', '--stat', 'a..b'], '/repo')
  assert.match(msg, /\[git diff --stat a\.\.b\] in \/repo/)
  assert.match(msg, /ENOBUFS/)
  assert.match(msg, /maxBuffer/)
  assert.equal(describeGitError({ message: msg }, ['diff', '--stat', 'a..b'], '/repo'), msg)
})
