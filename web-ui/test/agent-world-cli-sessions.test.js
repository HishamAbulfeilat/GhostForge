// Locks the CLI-sessions feature: the API route's guards, the snapshot mapper,
// and the privacy promise (no prompts, messages, tool arguments or summaries in
// what the route serves).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const webRoot = path.resolve(__dirname, '..')
const cliDir = path.join(webRoot, 'app', 'agent-world', 'cli')
// Byte-identical with the external Agent World app's src/agent-world/shared.
const sharedDir = path.join(webRoot, 'app', 'agent-world', 'shared')
const route = fs.readFileSync(path.join(webRoot, 'app/api/agents/cli-sessions/route.ts'), 'utf8')
const collector = fs.readFileSync(path.join(webRoot, 'lib/cli-sessions.mjs'), 'utf8')
const worldModel = fs.readFileSync(path.join(sharedDir, 'world-model.ts'), 'utf8')
const chatRoute = fs.readFileSync(path.join(webRoot, 'app/api/agents/cli-sessions/chat/route.ts'), 'utf8')
const chatLib = fs.readFileSync(path.join(sharedDir, 'server/chat.mjs'), 'utf8')

test('the CLI sessions route guards itself like every other agents route', () => {
  assert.match(route, /getCurrentUser\(request\)/, 'must authenticate in-route: middleware skips /api/*')
  assert.match(route, /hasPermission\(user, 'admin_tools'\)/)
  assert.match(route, /status: 403/)
  assert.match(route, /export const dynamic = 'force-dynamic'/)
  assert.match(route, /export const runtime = 'nodejs'/, 'the collector uses node:sqlite, which needs the node runtime')
})

test('the route honours GF_CLI_SESSIONS=0 and serves per-session detail', () => {
  assert.match(route, /GF_CLI_SESSIONS === '0'/)
  assert.match(route, /searchParams\.get\('session'\)/)
  assert.match(route, /getSessionDetail\(id\)/)
})

test('concurrent snapshot requests share one build', () => {
  assert.match(route, /pending \?\?= buildSnapshot/)
})

test('the collector only returns metadata, never prompts or tool content', () => {
  // Cost/usage come from Claude Code's own cost-state record and Copilot's
  // aggregate columns; message text, tool arguments and Copilot summaries are
  // never copied into the snapshot.
  assert.match(collector, /o\.type === 'cost-state'/)
  assert.doesNotMatch(collector, /message\.content\s*:\s*\[/) // no raw content arrays
  assert.doesNotMatch(collector, /\btoolUseResult\b/, 'tool results stay unread')
  assert.doesNotMatch(collector, /assistant_response|user_message|technical_details|work_done/, 'Copilot text columns stay unread')
  // Copilot's summary column (prompt text) is opt-in only.
  assert.match(collector, /INCLUDE_SUMMARIES === '1'/)
  assert.match(collector, /INCLUDE_SUMMARIES \? clip\(r\.summary/)
})

test('the collector parses transcripts incrementally and only recent ones', () => {
  assert.match(collector, /entry\.offset/, 'each file remembers its byte offset')
  assert.match(collector, /mtimeMs > RECENT_MS/, 'older sessions are skipped entirely')
})

test('CLI characters are marked so worlds can tell them from the runtime team', () => {
  assert.match(worldModel, /cli: true/)
  assert.match(worldModel, /source: s\.provider === 'claude-code' \? 'Claude Code CLI' : 'Copilot CLI'/)
  assert.match(worldModel, /taskTitle/, 'rosters and furnaces need a label even when there is no bubble')
})

test('CLI characters keep a stable order so slots, sprites and desks do not reshuffle', () => {
  // The snapshot is sorted by recent activity; the town/office adapters place
  // characters by index, so worldAgents re-sorts by creation time, then id.
  assert.match(worldModel, /\.sort\(\(a, b\) => \(\(Date\.parse\(a\.createdAt/)
  const chat = fs.readFileSync(path.join(sharedDir, 'ChatBox.tsx'), 'utf8')
  assert.match(chat, /\?\? latest/, 'the chat box defaults to the most recently active session')
})

test('Agent World exposes CLI sessions as a tab and in every world', () => {
  const switcher = fs.readFileSync(path.join(webRoot, 'app/agent-world/AgentWorldSwitcher.tsx'), 'utf8')
  const page = fs.readFileSync(path.join(webRoot, 'app/agent-world/page.tsx'), 'utf8')
  assert.match(switcher, /id: 'cli', label: 'CLI Sessions'/)
  assert.match(page, /<CliDashboard world=\{cli\.world\}/)
  assert.match(page, /<CliLanes /)
  assert.match(page, /agents: \[\.\.\.state\.data\.agents, \.\.\.cliCharacters\]/, 'CLI characters join the runtime agents')
  for (const world of ['TownWorld', 'OfficeWorld']) {
    assert.match(page, new RegExp(`<${world} data=\\{mergedData\\}`), `${world} must receive the merged characters`)
  }
  assert.match(page, /<SessionDrawer/, 'session details open from both the dashboard and the lanes')
})

test('the new UI uses GhostForge tokens and logical utilities only', () => {
  const tsx = dir => fs.readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith('.tsx')).map(f => path.join(dir, String(f)))
  const files = [...tsx(cliDir), ...tsx(sharedDir)]
  assert.ok(files.length >= 10)
  for (const full of files) {
    const file = path.relative(webRoot, full)
    const source = fs.readFileSync(full, 'utf8')
    assert.doesNotMatch(
      source,
      /\b(bg|text|border)-(panel2?|line|muted|ink|live|warn|bad|claude|copilot)\b|var\(--/,
      `${file} must use gf-* design tokens`,
    )
    assert.doesNotMatch(source, /\b(ml|mr|pl|pr)-[0-9]|\btext-(left|right)\b/, `${file} must use logical utilities`)
  }
})

test('the vendored AI Town walker change is documented and minimal', () => {
  const notice = fs.readFileSync(path.join(webRoot, 'vendor/ai-town/NOTICE.md'), 'utf8')
  assert.match(notice, /orientation/, 'the orientation/isMoving deviation must be recorded')
  const player = fs.readFileSync(path.join(webRoot, 'vendor/ai-town/src/components/Player.tsx'), 'utf8')
  assert.match(player, /orientation=\{player\.orientation \?\? 0\}/)
  assert.match(player, /isMoving=\{player\.isMoving \?\? false\}/)
})

test('the chat route guards itself, takes same-origin JSON only and resumes sessions without a shell', () => {
  assert.match(chatRoute, /getCurrentUser\(request\)/)
  assert.match(chatRoute, /hasPermission\(user, 'admin_tools'\)/)
  assert.match(chatRoute, /GF_CLI_CHAT === '0'/)
  assert.match(chatRoute, /application\\\/json/)
  assert.match(chatRoute, /origin !== request\.nextUrl\.origin/)
  assert.match(chatRoute, /validateChat\(body, world\.sessions\)/, 'only sessions in the current snapshot')
  assert.match(chatLib, /shell: false/)
  assert.match(chatLib, /'-p', '--resume', resumeId, '--output-format', 'json'/)
  assert.match(chatLib, /const resumeId = session\.sessionId \?\? session\.id/, 'duplicate transcript rows resume the real session id')
  assert.match(chatLib, /child\.stdin\.end\(message\)/, 'the message goes over stdin, never argv')
  assert.doesNotMatch(chatLib, /\.jsonl/, 'chat never touches transcripts')
})

test('the connector format stays under the /api/agents 65,536-byte limit', async () => {
  const { connectorSnapshot, CONNECTOR_MAX_BYTES } = await import(path.join(sharedDir, 'server/connector.mjs'))
  assert.equal(CONNECTOR_MAX_BYTES, 65536)
  const now = new Date().toISOString()
  const sessions = Array.from({ length: 500 }, (_, i) => ({
    id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, provider: 'claude-code', entrypoint: 'cli',
    status: i % 3 ? 'idle' : 'active', health: 'ok', cwd: `/w/${'p'.repeat(180)}${i}`, updatedAt: now, createdAt: now,
  }))
  const payload = connectorSnapshot({ heartbeat: now, sessions, events: [] })
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < CONNECTOR_MAX_BYTES)
  assert.ok(payload.sessions.length > 0 && payload.sessions.length <= 100)
  assert.equal(payload.sessions[0].status, 'needs', 'sessions waiting on you come first')
  assert.match(route, /format'\) === 'connector'/)
})
