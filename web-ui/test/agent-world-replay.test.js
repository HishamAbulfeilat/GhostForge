// Session timeline replay: the collector keeps an oldest-first event history
// per session, the shared replay model turns it into scrubber frames, and the
// replayed moment reaches the scenes only (rosters and alerts stay live).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadShared, sharedDir } = require('./agent-world-shared-loader')

const load = loadShared(['format.ts', 'status.ts', 'world-model.ts', 'replay.ts'])
const { replayFrames, replayLine, applyReplay } = load('replay.ts')
const { BREAK_AFTER_MS } = load('world-model.ts')
test.after(() => load.cleanup())

const t0 = Date.parse('2026-10-05T10:00:00Z')
const at = min => new Date(t0 + min * 60_000).toISOString()

test('replay frames are in time order, skip untimed events and add a break for long quiet stretches', () => {
  const frames = replayFrames([
    { ts: at(10), type: 'tool', name: 'Edit' },
    { ts: at(0), type: 'prompt', name: 'user turn' },
    { type: 'tool', name: 'no time' },
    { ts: at(1), type: 'subagent', name: 'Agent' },
    { ts: at(11), type: 'compaction', name: 'context compacted' },
  ])
  assert.deepEqual(frames.map(f => f.kind), ['event', 'event', 'idle', 'event', 'event'])
  assert.deepEqual(frames.map(f => f.line), ['got a new message', 'started a subagent', '', 'running Edit', 'compacted its context'])
  const idle = frames[2]
  assert.equal(idle.idleMs, 9 * 60_000)
  assert.ok(idle.idleMs >= BREAK_AFTER_MS)
  assert.deepEqual(frames.at(-1).counts, { tools: 1, subagents: 1, prompts: 1, errors: 0, compactions: 1 })
  assert.deepEqual(replayFrames(undefined), [])
})

test('replay bubbles name what happened in at most six words, never content', () => {
  assert.equal(replayLine({ type: 'tool', name: 'mcp__github__create_pull_request' }), 'running create_pull_request')
  assert.equal(replayLine({ type: 'error', name: 'rate limited' }), 'rate limited')
  for (const type of ['tool', 'subagent', 'prompt', 'error', 'request', 'compaction']) {
    const line = replayLine({ type, name: 'one two three four five six seven eight' })
    assert.ok(line.replace(/…$/, '').split(/\s+/).length <= 6, `${type}: ${line}`)
  }
})

test('applyReplay changes only the replayed character, and leaves the list alone when live', () => {
  const agents = [
    { id: 'a', state: 'idle', column: 'ended', attention: null, bubbles: [], onBreak: true },
    { id: 'b', state: 'waiting', column: 'needs', attention: 'waiting', bubbles: ['waiting for you'], onBreak: false },
  ]
  assert.equal(applyReplay(agents, undefined), agents)
  const [frame] = replayFrames([{ ts: at(0), type: 'tool', name: 'Bash' }])
  const working = applyReplay(agents, { id: 'a', frame })
  assert.equal(working[1], agents[1])
  assert.equal(working[0].state, 'working')
  assert.equal(working[0].column, 'working')
  assert.equal(working[0].onBreak, false)
  assert.deepEqual(working[0].bubbles, ['running Bash'])
  const idle = replayFrames([{ ts: at(0), type: 'tool', name: 'Bash' }, { ts: at(30), type: 'tool', name: 'Read' }])[1]
  const resting = applyReplay(agents, { id: 'b', frame: idle })
  assert.equal(resting[1].onBreak, true)
  assert.equal(resting[1].attention, null, 'a replayed moment never raises a needs-you alert')
  assert.deepEqual(resting[1].bubbles, [])
})

test('the collector keeps up to 200 events oldest first for replay, and 25 newest first for the list', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-aw-home-'))
  const dir = path.join(home, '.claude', 'projects', '-work-demo')
  fs.mkdirSync(dir, { recursive: true })
  const id = '1b2f6c1e-0d5e-4a51-9b3e-5d0c7a1f0a01'
  const start = Date.now() - 60 * 60_000
  const lines = [{ type: 'user', timestamp: new Date(start).toISOString(), cwd: '/work/demo', message: { content: 'secret prompt text' } }]
  for (let i = 0; i < 230; i++) {
    lines.push({
      type: 'assistant', timestamp: new Date(start + (i + 1) * 10_000).toISOString(),
      message: { id: `m${i}`, model: 'claude-opus-5-5', usage: { input_tokens: 10 }, content: [{ type: 'tool_use', id: `t${i}`, name: i % 2 ? 'Read' : 'Bash', input: { command: 'rm secret' } }] },
    })
  }
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  const before = process.env.HOME
  process.env.HOME = home
  try {
    const collector = await import(`../lib/cli-sessions.mjs?replay=${Date.now()}`)
    await collector.buildSnapshot({ maxSessions: 10 })
    const detail = collector.getSessionDetail(id)
    assert.ok(detail, 'session is in the snapshot')
    assert.equal(detail.replay.length, 200)
    assert.equal(detail.events.length, 25)
    assert.ok(Date.parse(detail.replay[0].ts) < Date.parse(detail.replay.at(-1).ts), 'replay is oldest first')
    assert.ok(Date.parse(detail.events[0].ts) > Date.parse(detail.events.at(-1).ts), 'events stay newest first')
    assert.deepEqual(detail.events[0], detail.replay.at(-1))
    assert.doesNotMatch(JSON.stringify(detail.replay), /secret/, 'names and times only')
  } finally {
    process.env.HOME = before
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('the drawer scrubs the replay and hands the moment to the scenes only', () => {
  const drawer = fs.readFileSync(path.join(sharedDir, 'SessionDrawer.tsx'), 'utf8')
  assert.match(drawer, /<ReplayScrubber sessionId=\{d\.id\} events=\{d\.replay\}/)
  const scrubber = fs.readFileSync(path.join(sharedDir, 'ReplayScrubber.tsx'), 'utf8')
  assert.match(scrubber, /type="range"/)
  assert.match(scrubber, /aria-valuetext=/)
  assert.match(scrubber, /useEffect\(\(\) => \(\) => onReplayRef\.current\?\.\(undefined\), \[\]\)/, 'closing the drawer returns the scene to live')
  const page = fs.readFileSync(path.join(__dirname, '..', 'app', 'agent-world', 'page.tsx'), 'utf8')
  assert.match(page, /onReplay=\{setReplay\}/)
  assert.match(page, /applyReplay\(cliAgents, replay\)/)
  // Rosters and alerts keep the live state.
  assert.match(page, /useAttention\(cliRecent/)
  assert.match(page, /<StatusColumns title="CLI sessions" agents=\{cliAgents\}/)
})
