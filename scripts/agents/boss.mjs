#!/usr/bin/env node
// The boss — supervisor for the GhostForge agent team (Claude Code, Copilot CLI,
// and any other provider enabled in .agent-sync/team.json).
//
// Why a boss: agents that coordinate by editing shared files race each other
// and conflict. Here the boss is the only writer of the board and the only one
// that merges or pushes, so the workers can't collide:
//
//   • Each agent works in its own git worktree on its own branch, reset to the
//     latest integrated code before every task.
//   • Tasks carry a file area; the boss never runs two overlapping areas at once.
//   • Each finished task is reviewed (deep model, read-only), merged into
//     `agent/integration`, and health-checked; a merge that makes health worse
//     is rolled back and the task bounced with the failure output.
//   • The boss relays what changed to every agent (messages bus).
//   • When the board runs dry it runs the full health score; failing checks
//     become tasks, and at 100 it plans the next improvements, phase by phase.
//   • Every few merges it pushes `agent/integration` and opens/updates ONE PR to main.
//
// Usage:
//   node scripts/agents/boss.mjs start     run forever (Ctrl-C or `team.mjs stop` to end)
//   node scripts/agents/boss.mjs setup     create worktrees + install deps, then exit
//   node scripts/agents/boss.mjs once      setup + a single scheduling tick (smoke test)

import { spawn, spawnSync, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stateDir, loadBoard, saveBoard, addTask, areasOverlap, say, readMessages, takeResult, readJSON, writeJSON } from './lib/bus.mjs'
import { routeModel, classifyTask } from './lib/models.mjs'
import { commandFor, RATE_LIMIT_RE, winQuote } from './lib/providers.mjs'
import { healthScore } from './health.mjs'

const IS_WIN = process.platform === 'win32'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const PHASE_GOALS = {
  1: 'Make GhostForge fully working and polished: every feature in web-ui, TUI, Electron, the Python bridge, MCP server, marketplace and Job Hunter works end to end; every JARVIS tool works and is covered by tests; fix bugs, add missing tests, remove dead code, improve UX and accessibility.',
  2: 'Productize the agent team so GhostForge users can run it themselves: start/stop/monitor multi-agent teams and workflows from the web UI, TUI and JARVIS; support multiple providers (Claude Code, Copilot CLI, Codex, Gemini, any OpenAI-compatible endpoint) with task-based model routing (auto by default); reusable team/workflow templates; docs.',
  3: 'Continuous improvement: performance, security hardening, accessibility, test coverage, developer experience, and new capabilities for JARVIS.',
}

const SEEDS = {
  1: [
    { title: 'Deeper OpenJarvis bridge: expose /api/openjarvis/* endpoints in mark-l-bridge/server.py with a graceful stub when the package is not installed', kind: 'feature', area: ['mark-l-bridge'] },
    { title: 'Marketplace: verify every catalog install_command works cross-platform (Windows/macOS/Linux); fix macOS-only ones', kind: 'bugfix', area: ['marketplace'] },
    { title: 'Add a web-ui ESLint flat config (eslint.config.mjs) so `eslint .` and CI lint work', kind: 'chore', area: ['web-ui/eslint.config.mjs', 'web-ui/package.json'] },
    { title: 'Knip: remove or wire up the unused files reported by `cd web-ui && npx knip`', kind: 'refactor', area: ['web-ui/components'] },
    { title: 'JARVIS: add tests proving every tool in web-ui/lib/tool-permissions.ts is registered, permission-gated, and callable', kind: 'test', area: ['web-ui/test'] },
    { title: 'Tests: add root unit tests under tests/*.test.js and run them from scripts/test.js', kind: 'test', area: ['tests', 'scripts/test.js'] },
    { title: 'Docs: refresh README.md feature list and bridge section to match the current code', kind: 'docs', area: ['README.md'] },
  ],
  2: [
    { title: 'Agent Teams page in web-ui (/agents): start/stop the boss, live board, messages, health score, per-agent model and provider', kind: 'feature', area: ['web-ui/app/agents', 'web-ui/app/api/agents'] },
    { title: 'TUI: "Agent Team" menu — start/stop/status/say/add task, backed by scripts/agents/team.mjs', kind: 'feature', area: ['tui'] },
    { title: 'JARVIS tool `agent_team` {start, stop, status, say, add_task} with permission gating and tests', kind: 'feature', area: ['web-ui/lib/agent-team', 'web-ui/lib/tool-permissions.ts'] },
    { title: 'Multi-provider agents: add an OpenAI-compatible provider adapter (any base URL/key/model) plus tests for every adapter in scripts/agents/lib/providers.mjs', kind: 'feature', area: ['scripts/agents/lib'] },
    { title: 'Reusable team templates: .agent-sync/templates/*.json (pair, trio, reviewer-heavy) selectable by boss.mjs --template', kind: 'feature', area: ['.agent-sync/templates', 'scripts/agents/boss.mjs'] },
    { title: 'Docs: user guide for running agent teams from GhostForge (docs/AGENT-TEAMS.md) and link it from README', kind: 'docs', area: ['docs/AGENT-TEAMS.md'] },
  ],
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** The last parseable JSON object in model output (models wrap JSON in prose/fences). */
export function lastJSON(text = '') {
  const lines = text.split('\n').map(l => l.trim().replace(/^```(json)?|```$/g, '').trim())
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue
    try { return JSON.parse(lines[i]) } catch { /* maybe multi-line */ }
    try { return JSON.parse(lines.slice(i).join('\n').replace(/[^}]*$/, '')) } catch { /* keep looking */ }
  }
  return null
}

/** Next todo task for an agent: allowed owner, no area overlap with busy tasks, preferring its strengths. */
export function pickTask(tasks, agentId, strengths = []) {
  const busy = tasks.filter(t => t.status === 'in-progress' || t.status === 'review')
  const eligible = tasks.filter(t => t.status === 'todo'
    && (t.agent === 'any' || t.agent === agentId)
    && !busy.some(b => areasOverlap(b.area, t.area)))
  const pref = t => { const i = strengths.indexOf(t.kind); return i < 0 ? 99 : i }
  eligible.sort((x, y) => (x.phase - y.phase) || (pref(x) - pref(y)) || x.id.localeCompare(y.id))
  return eligible[0]
}

// ── Runtime ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))
const tail = (s = '', n = 3000) => (s.length > n ? '…' + s.slice(-n) : s)

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function gitTry(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
}

function sh(cmd, args, cwd, timeout = 15 * 60_000) {
  const r = spawnSync(cmd, IS_WIN ? args.map(winQuote) : args, { cwd, encoding: 'utf8', shell: IS_WIN, timeout })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
}

function killTree(child) {
  if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  else child.kill('SIGTERM')
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
}

/** Stage a runtime prompt in the checkout that will execute it. */
export function stagePrompt(worktree, category, name, content) {
  const file = path.join(worktree, '.agent-sync', 'state', category, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

class Boss {
  constructor() {
    this.cfg = readJSON(path.join(ROOT, '.agent-sync', 'team.json'), null)
    if (!this.cfg) throw new Error('Missing .agent-sync/team.json')
    this.dir = stateDir(ROOT)
    for (const d of ['tasks', 'logs', 'reviews']) fs.mkdirSync(path.join(this.dir, d), { recursive: true })
    this.intBranch = this.cfg.integration.branch
    this.intWt = path.resolve(ROOT, this.cfg.integration.worktree)
    this.base = this.cfg.integration.base
    this.agents = Object.entries(this.cfg.agents).filter(([, a]) => a.enabled)
    this.template = fs.readFileSync(path.join(ROOT, 'prompts', 'agent-worker.md'), 'utf8')
    this.state = Object.fromEntries(this.agents.map(([id]) => [id, { state: 'idle', task: null, model: null, cooldownUntil: null }]))
    this.merges = 0
    this.lastHealth = null // last quick health on integration — the regression baseline
    this.lastFullAt = 0
    this.planning = false
    this.prUrl = null
    this.integration = Promise.resolve() // serializes merge + health
    this.running = new Set()
  }

  log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`
    console.log(line)
    fs.appendFileSync(path.join(this.dir, 'boss.log'), line + '\n')
  }

  say(to, text) { say(this.dir, 'boss', to, text) }

  board() { return loadBoard(this.dir) }

  updateTask(id, patch) {
    const board = this.board()
    const t = board.tasks.find(x => x.id === id)
    if (t) Object.assign(t, patch, { updatedAt: new Date().toISOString() })
    saveBoard(this.dir, board)
    return t
  }

  writeStatus() {
    writeJSON(path.join(this.dir, 'status.json'), {
      ts: new Date().toISOString(), pid: process.pid, phase: this.board().phase,
      health: this.lastHealth?.score ?? null, merges: this.merges, pr: this.prUrl, agents: this.state,
    })
  }

  // ── Worktrees & deps ──

  ensureWorktree(dir, branch, startPoint) {
    if (fs.existsSync(path.join(dir, '.git'))) return
    const exists = gitTry(ROOT, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).ok
    if (exists) git(ROOT, 'worktree', 'add', dir, branch)
    else git(ROOT, 'worktree', 'add', '-b', branch, dir, startPoint)
    this.log(`worktree ready: ${dir} (${branch})`)
  }

  /** npm ci in web-ui when node_modules is missing or the lockfile changed. */
  syncDeps(wt) {
    const lock = path.join(wt, 'web-ui', 'package-lock.json')
    if (!fs.existsSync(lock)) return
    const hash = crypto.createHash('sha1').update(fs.readFileSync(lock)).digest('hex')
    const stamp = path.join(wt, 'web-ui', 'node_modules', '.gf-lock-hash')
    if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === hash) return
    this.log(`installing web-ui deps in ${wt}…`)
    const r = sh('npm', ['ci', '--no-audit', '--no-fund'], path.join(wt, 'web-ui'))
    if (r.ok) fs.writeFileSync(stamp, hash)
    else this.log(`npm ci failed in ${wt}: ${tail(r.out, 500)}`)
  }

  setup() {
    gitTry(ROOT, 'fetch', 'origin', this.base)
    this.ensureWorktree(this.intWt, this.intBranch, `origin/${this.base}`)
    for (const [, a] of this.agents) this.ensureWorktree(path.resolve(ROOT, a.worktree), a.branch, this.intBranch)
    this.syncDeps(this.intWt)
    for (const [, a] of this.agents) this.syncDeps(path.resolve(ROOT, a.worktree))
    const board = this.board()
    if (!board.tasks.length) { this.seedPhase(board, 1); saveBoard(this.dir, board) }
  }

  seedPhase(board, phase) {
    board.phase = phase
    for (const s of SEEDS[phase] ?? []) addTask(board, { ...s, phase })
    this.say('all', `Phase ${phase} started: ${PHASE_GOALS[phase]}`)
    this.log(`phase ${phase} seeded`)
  }

  ingestRequests(board) {
    const file = path.join(this.dir, 'requests.jsonl')
    if (!fs.existsSync(file)) return
    const taken = `${file}.${Date.now()}`
    fs.renameSync(file, taken)
    for (const line of fs.readFileSync(taken, 'utf8').split('\n').filter(Boolean)) {
      try {
        const r = JSON.parse(line)
        const t = addTask(board, { title: r.title, kind: r.kind || classifyTask(r.title), area: r.area, agent: r.agent })
        this.say(r.from || 'all', `Queued "${r.title}" as ${t.id}.`)
      } catch { /* ignore a bad line */ }
    }
    fs.rmSync(taken, { force: true })
  }

  // ── Running an agent CLI ──

  runAgent({ provider, model, mode, prompt, cwd, logFile, env = {}, timeoutMs }) {
    const { cmd, args } = commandFor(provider, { prompt, model, mode })
    return new Promise(resolve => {
      const out = fs.createWriteStream(logFile, { flags: 'a' })
      out.write(`\n=== ${new Date().toISOString()} ${cmd} [${model}] (${mode}) in ${cwd}\n`)
      let buf = ''
      let timedOut = false
      const child = spawn(cmd, IS_WIN ? args.map(winQuote) : args, {
        cwd, shell: IS_WIN, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GF_AGENT_STATE: this.dir, ...env },
      })
      const onData = d => { const s = d.toString(); out.write(s); buf = (buf + s).slice(-40_000) }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      const timer = setTimeout(() => { timedOut = true; killTree(child) }, timeoutMs)
      child.on('error', e => { buf += `\n${e.message}` })
      child.on('close', code => { clearTimeout(timer); out.end(); resolve({ code, output: buf, timedOut }) })
    })
  }

  othersText(board, me) {
    const busy = board.tasks.filter(t => (t.status === 'in-progress' || t.status === 'review') && t.owner !== me)
    if (!busy.length) return '_Nobody else is mid-task._'
    return busy.map(t => `- **${t.owner}** — ${t.id} ${t.title} — area: ${t.area.join(', ') || '(whole repo)'}`).join('\n')
  }

  inboxText(me) {
    const msgs = readMessages(this.dir, { to: me, limit: 15 })
    if (!msgs.length) return '_No messages._'
    return msgs.map(m => `- ${m.ts.slice(0, 16)} **${m.from} → ${m.to}:** ${m.text}`).join('\n')
  }

  bounce(task, agentId, reason) {
    const attempts = (task.attempts ?? 0) + 1
    const blocked = attempts >= this.cfg.maxAttempts
    this.updateTask(task.id, {
      status: blocked ? 'blocked' : 'todo', owner: null, attempts,
      // After a failed attempt, let any agent take it — a fresh pair of eyes helps.
      agent: attempts >= 2 ? 'any' : task.agent,
      lastFailure: tail(reason, 4000),
    })
    this.say(agentId, `${task.id} ${blocked ? `BLOCKED after ${attempts} attempts` : 'bounced'}: ${tail(reason, 600)}`)
    this.log(`${task.id} ${blocked ? 'blocked' : 'bounced'} (${agentId}): ${tail(reason, 300)}`)
  }

  // ── Task lifecycle ──

  async work(agentId, task) {
    const a = this.cfg.agents[agentId]
    const wt = path.resolve(ROOT, a.worktree)
    const st = this.state[agentId]
    try {
      // Fresh start on top of everything already integrated → no stale conflicts.
      if (git(wt, 'status', '--porcelain')) git(wt, 'stash', 'push', '-u', '-m', `boss: leftovers before ${task.id}`)
      git(wt, 'checkout', '-B', a.branch, this.intBranch)
      this.syncDeps(wt)
      const base = git(wt, 'rev-parse', 'HEAD')
      const route = routeModel(a.provider, task, this.cfg.models)
      Object.assign(st, { state: 'working', task: task.id, model: route.model, since: new Date().toISOString() })

      const taskContent = fill(this.template, {
        AGENT: agentId, BRANCH: a.branch, TASK_ID: task.id, KIND: route.kind, TITLE: task.title,
        AREA: task.area.length ? task.area.map(p => `\`${p}\``).join(', ') : '(whole repo)',
        NOTES: task.notes || '—', ATTEMPT: String((task.attempts ?? 0) + 1), MAX_ATTEMPTS: String(this.cfg.maxAttempts),
        FAILURE: task.lastFailure ? `## The previous attempt was rejected\n\n\`\`\`\n${task.lastFailure}\n\`\`\`\n\nFix the cause this time.` : '',
        OTHERS: this.othersText(this.board(), agentId), INBOX: this.inboxText(agentId),
      })
      stagePrompt(wt, 'tasks', `${task.id}-${agentId}.md`, taskContent)
      this.log(`${agentId} ← ${task.id} [${route.kind} → ${route.model}] ${task.title}`)

      const run = await this.runAgent({
        provider: a.provider, model: route.model, mode: 'work', cwd: wt,
        prompt: `Read the file .agent-sync/state/tasks/${task.id}-${agentId}.md and follow its instructions exactly. Work in the current directory.`,
        logFile: path.join(this.dir, 'logs', `${agentId}.log`),
        env: { GF_AGENT: agentId }, timeoutMs: this.cfg.taskTimeoutMinutes * 60_000,
      })

      // Keep work the agent forgot to commit.
      if (git(wt, 'status', '--porcelain')) {
        git(wt, 'add', '-A')
        gitTry(wt, 'commit', '-m', `chore(${agentId}): uncommitted work from ${task.id}`)
      }
      const commits = Number(git(wt, 'rev-list', '--count', `${base}..HEAD`))
      const result = takeResult(this.dir, task.id)

      if (run.code !== 0 && !commits && RATE_LIMIT_RE.test(run.output)) {
        st.cooldownUntil = new Date(Date.now() + this.cfg.cooldownMinutes * 60_000).toISOString()
        this.updateTask(task.id, { status: 'todo', owner: null })
        this.log(`${agentId} rate-limited — cooling down until ${st.cooldownUntil}`)
        return
      }
      if (result?.outcome === 'blocked') {
        this.updateTask(task.id, { status: 'blocked', owner: null, lastFailure: result.summary })
        say(this.dir, agentId, 'all', `${task.id} blocked: ${result.summary}`)
        return
      }
      if (!commits) {
        this.bounce(task, agentId, run.timedOut
          ? `Timed out after ${this.cfg.taskTimeoutMinutes} min with no commits.`
          : `Finished without committing anything.\n${tail(run.output, 1500)}`)
        return
      }
      this.updateTask(task.id, { status: 'review' })
      st.state = 'waiting-merge'
      const head = git(wt, 'rev-parse', 'HEAD')
      this.integration = this.integration
        .then(() => this.integrate(agentId, task, base, head, result))
        .catch(e => {
          this.log(`integrate error: ${e.stack}`)
          gitTry(this.intWt, 'merge', '--abort')
          this.bounce(task, agentId, `Boss integration error: ${e.message}`)
        })
      await this.integration
    } catch (e) {
      this.log(`${agentId} ${task.id} crashed: ${e.stack}`)
      this.bounce(task, agentId, `Boss error: ${e.message}`)
    } finally {
      Object.assign(st, { state: 'idle', task: null, model: null })
    }
  }

  async readonlyRun(file, logName, timeoutMs) {
    return this.runAgent({
      provider: this.cfg.boss.provider, model: this.cfg.boss.model, mode: 'readonly', cwd: this.intWt,
      prompt: `Read the file .agent-sync/state/${path.relative(path.join(this.intWt, '.agent-sync', 'state'), file).replace(/\\/g, '/')} and follow its instructions exactly.`,
      logFile: path.join(this.dir, 'logs', logName), timeoutMs,
    })
  }

  async review(task, agentId, base, head) {
    if (!this.cfg.boss.review) return { approve: true }
    const stat = git(ROOT, 'diff', '--stat', `${base}..${head}`)
    const diff = git(ROOT, 'diff', `${base}..${head}`)
    const content = [
      'You are the lead reviewer ("boss") of an autonomous agent team on the GhostForge repo.',
      `Review ${agentId}'s change for task ${task.id}: **${task.title}** (area: ${task.area.join(', ') || 'whole repo'}).`,
      'Approve unless it is wrong, incomplete, unsafe, breaks the rules in AGENTS.md, or edits files far outside its area.',
      'Do not nitpick style. Read surrounding code in this checkout if you need context. Do not modify anything.',
      '', '## Diff stat', '```', stat, '```', '', '## Diff', '```diff', diff.slice(0, 80_000), '```', '',
      'Reply with your reasoning, then a final line of JSON only: {"approve": true|false, "issues": ["…"]}',
    ].join('\n')
    const file = stagePrompt(this.intWt, 'reviews', `${task.id}.md`, content)
    const run = await this.readonlyRun(file, 'boss-review.log', 20 * 60_000)
    const verdict = lastJSON(run.output)
    if (!verdict || typeof verdict.approve !== 'boolean') {
      this.log(`review of ${task.id} unparseable — relying on health checks`)
      return { approve: true }
    }
    return verdict
  }

  async integrate(agentId, task, base, head, result) {
    const a = this.cfg.agents[agentId]
    const verdict = await this.review(task, agentId, base, head)
    if (!verdict.approve) {
      this.bounce(task, agentId, `Boss review rejected the change:\n- ${(verdict.issues ?? []).join('\n- ')}`)
      return
    }
    if (!this.lastHealth) this.lastHealth = healthScore(this.intWt)
    const merged = gitTry(this.intWt, 'merge', '--no-ff', '--no-edit', '-m', `merge(${agentId}): ${task.id} ${task.title.slice(0, 60)}`, a.branch)
    if (!merged.ok) {
      gitTry(this.intWt, 'merge', '--abort')
      this.bounce(task, agentId, `Merge conflict with ${this.intBranch} (another agent changed the same lines). Redo the task on top of the latest code.\n${tail(merged.out, 800)}`)
      return
    }
    this.syncDeps(this.intWt)
    const health = healthScore(this.intWt)
    const wasOk = new Set(this.lastHealth.checks.filter(c => c.ok).map(c => c.id))
    const broke = health.checks.filter(c => !c.ok && !c.skipped && wasOk.has(c.id))
    if (broke.length || health.score < this.lastHealth.score) {
      git(this.intWt, 'reset', '--hard', 'HEAD~1') // undo our own merge commit on the boss's branch
      this.bounce(task, agentId, `Health regressed ${this.lastHealth.score} → ${health.score}. Broken checks:\n` +
        broke.map(c => `### ${c.label}\n${tail(c.output, 1200)}`).join('\n'))
      return
    }
    this.lastHealth = health
    this.merges++
    const files = git(this.intWt, 'diff', '--name-only', 'HEAD~1..HEAD').split('\n').slice(0, 15).join(', ')
    this.updateTask(task.id, { status: 'done', owner: agentId, summary: result?.summary ?? '' })
    this.say('all', `✅ ${task.id} merged from ${agentId} (health ${health.score}/100): ${task.title}. ${result?.summary ?? ''} Files: ${files}`)
    this.log(`${task.id} merged from ${agentId}; health ${health.score}`)
    if (this.merges % this.cfg.pr.everyMerges === 0) this.publish()
  }

  // ── Planning & PR ──

  async plan(board, report) {
    const done = board.tasks.filter(t => t.status === 'done').slice(-40).map(t => `- ${t.id} ${t.title}`).join('\n') || '(none yet)'
    const blocked = board.tasks.filter(t => t.status === 'blocked').map(t => `- ${t.id} ${t.title}: ${tail(t.lastFailure ?? '', 200)}`).join('\n') || '(none)'
    const toBoss = readMessages(this.dir, { to: 'boss', limit: 20 }).filter(m => m.from !== 'boss').map(m => `- ${m.from}: ${m.text}`).join('\n') || '(none)'
    const content = [
      `You are the lead ("boss") of an autonomous agent team (${this.agents.map(([id]) => id).join(', ')}) improving the GhostForge repo.`,
      `Phase ${board.phase} goal: ${PHASE_GOALS[board.phase] ?? PHASE_GOALS[3]}`,
      `Health score: ${report.score}/100 (all checks pass).`,
      '', 'Recently done:', done, '', 'Blocked:', blocked, '', 'Messages to you from the agents:', toBoss, '',
      'Inspect this checkout (do not modify it) and decide the next 3–8 tasks toward the phase goal. Each task must be small',
      '(one agent, under an hour), independently verifiable, and own a narrow file area; give different tasks disjoint areas',
      'so agents can work in parallel. If the phase goal is genuinely achieved, set "phaseComplete": true (tasks may be empty).',
      '',
      'End with one line of JSON only: {"phaseComplete": false, "tasks": [{"title": "…", "kind": "feature|bugfix|test|refactor|docs|security|chore", "area": ["path/"], "agent": "any|claude|copilot", "notes": "…"}]}',
    ].join('\n')
    const file = stagePrompt(this.intWt, 'reviews', `plan-phase${board.phase}.md`, content)
    const run = await this.readonlyRun(file, 'boss-plan.log', 30 * 60_000)
    return lastJSON(run.output)
  }

  async idle() {
    this.planning = true
    try {
      this.log('board is empty — running full health')
      const report = healthScore(this.intWt, { full: true })
      this.lastFullAt = Date.now()
      this.lastHealth = { ...report, checks: report.checks.filter(c => !['web-audit', 'web-build'].includes(c.id)) }
      const board = this.board()
      const failing = report.checks.filter(c => !c.ok && !c.skipped)
      for (const c of failing) {
        addTask(board, { title: `Fix failing health check: ${c.label}`, kind: 'bugfix', area: c.area, notes: tail(c.output, 2500) })
      }
      saveBoard(this.dir, board)
      if (failing.length) {
        this.say('all', `Health ${report.score}/100 — ${failing.length} failing check(s) turned into tasks.`)
        return
      }
      const p = await this.plan(board, report)
      const fresh = this.board()
      if (p?.phaseComplete && SEEDS[fresh.phase + 1]) {
        this.publish()
        this.seedPhase(fresh, fresh.phase + 1)
      } else if (p?.phaseComplete) {
        fresh.phase = Math.max(fresh.phase, 3)
      }
      for (const t of p?.tasks ?? []) {
        if (t?.title) addTask(fresh, { title: t.title, kind: t.kind || classifyTask(t.title), area: Array.isArray(t.area) ? t.area : [], agent: t.agent || 'any', notes: t.notes })
      }
      saveBoard(this.dir, fresh)
      this.say('all', `Health ${report.score}/100. Planned ${(p?.tasks ?? []).length} new task(s) for phase ${fresh.phase}.`)
    } finally {
      this.planning = false
    }
  }

  publish() {
    if (gitTry(this.intWt, 'fetch', 'origin', this.base).ok) {
      const m = gitTry(this.intWt, 'merge', '--no-edit', `origin/${this.base}`)
      if (!m.ok) {
        gitTry(this.intWt, 'merge', '--abort')
        this.log(`could not merge origin/${this.base} into ${this.intBranch} — human needed: ${tail(m.out, 300)}`)
        this.say('human', `${this.base} has diverged from ${this.intBranch} with conflicts; PR not updated.`)
        return
      }
    }
    const push = gitTry(this.intWt, 'push', '-u', 'origin', this.intBranch)
    if (!push.ok) { this.log(`push failed: ${tail(push.out, 300)}`); return }
    const done = this.board().tasks.filter(t => t.status === 'done')
    const bodyFile = path.join(this.dir, 'pr-body.md')
    fs.writeFileSync(bodyFile, [
      'Automated work from the GhostForge agent team (boss: `scripts/agents/boss.mjs`).',
      `Every task below was reviewed by the boss, merged into \`${this.intBranch}\`, and health-checked (current score: ${this.lastHealth?.score ?? '?'}/100).`,
      '', ...done.map(t => `- ${t.id} (${t.owner}) ${t.title}`),
    ].join('\n'))
    const existing = sh('gh', ['pr', 'list', '--head', this.intBranch, '--state', 'open', '--json', 'url', '-q', '.[0].url'], this.intWt)
    if (existing.ok && existing.out.startsWith('http')) {
      this.prUrl = existing.out
      sh('gh', ['pr', 'edit', this.prUrl, '--body-file', bodyFile], this.intWt)
    } else {
      const created = sh('gh', ['pr', 'create', '--base', this.base, '--head', this.intBranch, '--title', this.cfg.pr.title, '--body-file', bodyFile], this.intWt)
      if (created.ok) this.prUrl = created.out.split('\n').pop()
      else this.log(`gh pr create failed: ${tail(created.out, 300)}`)
    }
    if (this.prUrl) {
      this.log(`PR updated: ${this.prUrl}`)
      this.say('all', `PR to ${this.base} updated with ${done.length} task(s): ${this.prUrl}`)
      if (this.cfg.pr.autoMerge) sh('gh', ['pr', 'merge', this.prUrl, '--merge'], this.intWt)
    }
  }

  // ── Scheduler ──

  async tick() {
    const board = this.board()
    this.ingestRequests(board)
    saveBoard(this.dir, board)
    const now = Date.now()
    for (const [id, a] of this.agents) {
      const st = this.state[id]
      if (st.state !== 'idle') continue
      if (st.cooldownUntil && Date.parse(st.cooldownUntil) > now) continue
      st.cooldownUntil = null
      const b = this.board()
      const task = pickTask(b.tasks, id, a.strengths)
      if (!task) continue
      Object.assign(task, { status: 'in-progress', owner: id, updatedAt: new Date().toISOString() })
      saveBoard(this.dir, b)
      st.state = 'starting'
      const p = this.work(id, task).finally(() => this.running.delete(p))
      this.running.add(p)
    }
    const active = this.board().tasks.some(t => ['todo', 'in-progress', 'review'].includes(t.status))
    const fullDue = now - this.lastFullAt > this.cfg.fullHealthEveryMinutes * 60_000
    if (!active && !this.planning && !this.running.size && fullDue) await this.idle()
    this.writeStatus()
  }

  takeLock() {
    const lock = path.join(this.dir, 'boss.pid')
    const pid = Number(fs.existsSync(lock) && fs.readFileSync(lock, 'utf8'))
    if (pid && pid !== process.pid) {
      let alive = false
      try { process.kill(pid, 0); alive = true } catch { /* stale lock */ }
      if (alive) throw new Error(`boss already running (pid ${pid})`)
    }
    fs.writeFileSync(lock, String(process.pid))
    process.on('exit', () => { try { fs.rmSync(lock) } catch { /* gone */ } })
  }

  async start(cmd) {
    if (cmd === 'setup') { this.setup(); this.log('setup complete'); return }
    this.takeLock()
    const stopFile = path.join(this.dir, 'STOP')
    fs.rmSync(stopFile, { force: true })
    this.setup()
    // Anything a previous boss run left mid-flight goes back to the queue.
    const board = this.board()
    for (const t of board.tasks) if (t.status === 'in-progress' || t.status === 'review') Object.assign(t, { status: 'todo', owner: null })
    saveBoard(this.dir, board)
    this.log(`boss started — agents: ${this.agents.map(([id, a]) => `${id}(${a.provider})`).join(', ')}; integration ${this.intBranch} @ ${this.intWt}`)
    this.say('all', `Boss online. Agents: ${this.agents.map(([id]) => id).join(', ')}. Phase ${board.phase}.`)

    if (cmd === 'once') { await this.tick(); await Promise.all(this.running); return }
    process.on('SIGINT', () => {
      fs.writeFileSync(stopFile, 'sigint')
      this.log('stopping after in-flight tasks… (Ctrl-C again to force)')
      process.once('SIGINT', () => process.exit(130))
    })
    while (!fs.existsSync(stopFile)) {
      try { await this.tick() } catch (e) { this.log(`tick error: ${e.stack}`) }
      await sleep(this.cfg.tickSeconds * 1000)
    }
    await Promise.all(this.running)
    if (this.merges) this.publish()
    this.log('boss stopped')
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  new Boss().start(process.argv[2] || 'start').catch(e => { console.error(`boss: ${e.stack ?? e}`); process.exit(1) })
}
