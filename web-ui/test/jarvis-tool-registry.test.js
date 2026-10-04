// T-005: every tool in lib/tool-permissions.ts is registered, permission-gated
// and callable.
//
// The JARVIS tool surface has three independent declarations that must agree:
//   1. TOOL_PERMISSION (lib/tool-permissions.ts) — what the gate checks
//   2. the `case` arms of executeTool (app/api/jarvis/route.ts) — what runs
//   3. TOOLS_BY_DOMAIN (app/api/jarvis/route.ts) — what the model is told exists
// They drift silently: an entry with no `case` arm means the gate checks a
// permission for a tool that answers 'Unknown tool', and a `case` arm missing
// from the catalog means the model can never pick it.
//
// The second half of the file loads the real route module and drives POST()
// end to end, so the gate is proven behaviourally rather than by reading the
// source: a tool with no permission entry must fail open (it must NOT run).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { fileURLToPath } = require('node:url')
const ts = require('typescript')

// The JARVIS route imports through the '@/*' alias (tsconfig maps it to './*')
// and lib/*.ts use extensionless relative imports. Resolve both to real files.
// This must be registered before any require() that pulls one of those in.
const WEB_UI = path.resolve(__dirname, '..')
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const target = path.join(WEB_UI, specifier.slice(2))
      // Try the compiled extensions Node itself would, plus the .ts sources and
      // directory indexes the alias can point at.
      const candidates = [
        target, `${target}.ts`, `${target}.js`,
        path.join(target, 'index.ts'), path.join(target, 'index.js'),
      ]
      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return nextResolve(candidate, context)
        }
      }
    }
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw err
    }
  },
})

const { TOOL_PERMISSION, permissionForTool, CHAT_BASELINE_PERMISSION } = require('../lib/tool-permissions.ts')
const { ALL_PERMISSIONS } = require('../lib/permissions.ts')
const routePath = path.join(WEB_UI, 'app', 'api', 'jarvis', 'route.ts')
const routeSource = fs.readFileSync(routePath, 'utf8')

/** Slice the executeTool switch out of the route source. */
function executorSource() {
  const start = routeSource.indexOf('async function executeTool')
  const end = routeSource.indexOf('// ── Tool result → spoken speech')
  assert.ok(start > -1 && end > start, 'executeTool not found in the JARVIS route')
  return routeSource.slice(start, end)
}

/** Slice the domain→tool catalog the system prompt advertises. */
function catalogSource() {
  const start = routeSource.indexOf('const TOOLS_BY_DOMAIN')
  const end = routeSource.indexOf('// System prompt cache')
  assert.ok(start > -1 && end > start, 'TOOLS_BY_DOMAIN not found in the JARVIS route')
  return routeSource.slice(start, end)
}

const EXECUTABLE_TOOLS = new Set(
  [...executorSource().matchAll(/^\s{4}case '([a-z0-9_]+)':/gm)].map(m => m[1]),
)
// The catalog is prose, so match every snake_case identifier it mentions rather
// than guessing the exact punctuation around each tool name.
const ADVERTISED_TOOLS = new Set(
  [...catalogSource().matchAll(/[a-z][a-z0-9_]{2,}/g)].map(m => m[0]),
)

const REGISTERED_TOOLS = Object.keys(TOOL_PERMISSION)

test.after(() => {
  hooks.deregister()
})

// ── The three declarations must agree ─────────────────────────────────────────

test('every registered tool is dispatchable by executeTool', () => {
  const unreachable = REGISTERED_TOOLS.filter(t => !EXECUTABLE_TOOLS.has(t))
  assert.deepEqual(
    unreachable, [],
    `registered in tool-permissions.ts but executeTool has no case for them: ${unreachable.join(', ')}`,
  )
})

test('every registered tool is advertised to the model in TOOLS_BY_DOMAIN', () => {
  const hidden = REGISTERED_TOOLS.filter(t => !ADVERTISED_TOOLS.has(t))
  assert.deepEqual(
    hidden, [],
    `registered but never offered to the model, so it can never be called: ${hidden.join(', ')}`,
  )
})

test('every tool executeTool can dispatch is registered and advertised', () => {
  // A permission entry with no executor arm gates a tool that answers
  // 'Unknown tool'; an executor arm with no entry is fail-open.
  const unregistered = [...EXECUTABLE_TOOLS].filter(t => !REGISTERED_TOOLS.includes(t))
  assert.deepEqual(
    unregistered, [],
    `executeTool dispatches these but tool-permissions.ts never gates them: ${unregistered.join(', ')}`,
  )

  const unadvertised = [...EXECUTABLE_TOOLS].filter(t => !ADVERTISED_TOOLS.has(t))
  assert.deepEqual(
    unadvertised, [],
    `executeTool dispatches these but the model is never told they exist: ${unadvertised.join(', ')}`,
  )
})

test('the tool-permission map has no duplicate keys', () => {
  // A duplicate object key is legal JS and silently keeps the last value, so
  // re-derive the count from source rather than from Object.keys().
  const declared = [...require('node:fs')
    .readFileSync(path.join(WEB_UI, 'lib', 'tool-permissions.ts'), 'utf8')
    .matchAll(/^\s{2}([a-z0-9_]+):\s*'[a-z0-9_]+',/gm)].map(m => m[1])
  const duplicates = declared.filter((t, i) => declared.indexOf(t) !== i)
  assert.deepEqual([...new Set(duplicates)], [], `duplicate tool keys: ${[...new Set(duplicates)].join(', ')}`)
  assert.equal(declared.length, REGISTERED_TOOLS.length, 'declared tool count must match the exported map size')
})

// ── Permission keys are real and the baseline is usable ──────────────────────

test('every TOOL_PERMISSION value is a real permission key', () => {
  const known = new Set(ALL_PERMISSIONS)
  for (const [tool, perm] of Object.entries(TOOL_PERMISSION)) {
    assert.ok(known.has(perm), `tool "${tool}" maps to unknown permission "${perm}"`)
  }
})

test('a permission key with no tool is still reachable from a page or API guard', () => {
  // Not every permission gates a tool: 'conversation_history' guards /history and
  // 'remote' guards /api/remote/setup. Assert each tool-less key really is used
  // elsewhere, so a key can never become genuinely dead.
  const usedByTools = new Set(Object.values(TOOL_PERMISSION))
  const toolless = ALL_PERMISSIONS.filter(p => !usedByTools.has(p))
  const source = fs.readFileSync(path.join(WEB_UI, 'lib', 'title-profiles.ts'), 'utf8')
  const routes = fs.readFileSync(path.join(WEB_UI, 'lib', 'access.ts'), 'utf8')
  const apiDir = path.join(WEB_UI, 'app', 'api')
  const routeSources = []
  for (const dir of fs.readdirSync(apiDir, { withFileTypes: true })) {
    if (dir.isDirectory()) {
      const file = path.join(apiDir, dir.name, 'route.ts')
      if (fs.existsSync(file)) routeSources.push(fs.readFileSync(file, 'utf8'))
    }
  }
  for (const key of toolless) {
    const guarded = source.includes(`permission: '${key}'`) || routes.includes(key) ||
      routeSources.some(s => s.includes(`'${key}'`))
    assert.ok(guarded, `permission "${key}" gates no tool and no page/API guard — it is dead`)
  }
})

test('permissionForTool returns the mapped key, and undefined for an unknown tool', () => {
  for (const [tool, perm] of Object.entries(TOOL_PERMISSION)) {
    assert.equal(permissionForTool(tool), perm)
  }
  assert.equal(permissionForTool('definitely_not_a_tool'), undefined)
  // Prototype keys must not resolve to a permission.
  assert.equal(permissionForTool('toString'), undefined)
  assert.equal(permissionForTool('constructor'), undefined)
})

test('the chat baseline permission is a real key and gates at least one tool', () => {
  assert.ok(ALL_PERMISSIONS.includes(CHAT_BASELINE_PERMISSION), 'baseline must be a real permission')
  const baselineTools = Object.entries(TOOL_PERMISSION).filter(([, p]) => p === CHAT_BASELINE_PERMISSION)
  assert.ok(baselineTools.length > 0, 'no tool uses the baseline permission')
})

test('tools that can write files or run commands never fall back to a low-risk permission', () => {
  // Regression guard for the two ways the map can quietly fail open: a tool that
  // writes or executes being mapped to something harmless like 'chat'.
  const dangerous = [
    'terminal_command', 'run_terminal', 'execute_code', 'open_interpreter', 'jsrepl_run',
    'mac_control', 'lock_screen', 'set_volume', 'system_control', 'mac_cleanup',
    'agent_team', 'delegate_agent', 'setup_wizard', 'install_on_device',
  ]
  for (const tool of dangerous) {
    const perm = permissionForTool(tool)
    assert.ok(perm, `${tool} must require a permission`)
    assert.notEqual(perm, 'chat', `${tool} must not be gated behind the baseline 'chat' permission`)
  }
})

test('computer-control tools share one permission so a single grant covers them all', () => {
  // Mark-LIV and the native tools drive the same mouse/keyboard, so granting
  // mac_control must not leave a second, differently-gated spelling usable.
  const control = [
    'mac_control', 'open_app', 'open_url', 'type_text', 'key_combo', 'mouse_click',
    'mouse_move', 'drag_mouse', 'scroll', 'point_cursor', 'find_and_click',
    'highlight_area', 'focus_window', 'get_windows', 'get_frontmost_app',
    'play_music', 'mark_liv',
  ]
  const perms = new Set(control.map(permissionForTool))
  assert.deepEqual([...perms], ['mac_control'], `computer-control tools must share one permission, got ${[...perms].join(', ')}`)
})

test('every channel that sends a real message is gated by send_message', () => {
  const senders = [
    'send_message', 'send_imessage', 'send_teams_message', 'send_slack_message',
    'send_whatsapp_message', 'discord_message',
  ]
  for (const tool of senders) {
    assert.equal(permissionForTool(tool), 'send_message', `${tool} must require send_message`)
  }
  // send_user_message reaches other GhostForge accounts, not the user's contacts.
  assert.equal(permissionForTool('send_user_message'), 'user_message')
})

test('n8n workflows are gated by the n8n key, not a non-existent "workflows" key', () => {
  // The catalog calls this permission 'n8n'; 'workflows' is not in ALL_PERMISSIONS,
  // so mapping to it made the tool unreachable for every non-admin.
  for (const tool of ['workflow', 'n8n_workflow']) {
    assert.equal(permissionForTool(tool), 'n8n', `${tool} must require the n8n permission`)
  }
  assert.ok(!ALL_PERMISSIONS.includes('workflows'), 'this test is stale if a "workflows" key now exists')
})

// ── End-to-end: the real route, the real gate ────────────────────────────────
//
// The route is loaded with its AI provider and network stubbed, so POST() runs
// the production gate and the production executor with no side effects.

const state = {
  user: null,
  toolResponse: '',   // JSON the stubbed model returns for the next request
  executed: [],       // tools the stubbed executor observed
  fetchCalls: [],
}

const ADMIN = { role: 'admin', permissions: [], name: 'Owner', username: 'owner' }

/** A request whose only tool call is `tool`. */
function jarvisRequest(body, { user = ADMIN, ip = 'local' } = {}) {
  state.user = user
  return {
    ip,
    headers: new Map([
      ['x-forwarded-for', ip],
      ['user-agent', 'node-test'],
    ]),
    cookies: { get: () => ({ value: 'test-token' }) },
    async json() { return body },
  }
}

// Stubbed module set for the route. Kept at module scope and consulted by a
// persistent load hook below: tools are reached through *dynamic*
// `await import('@/lib/mark-liv-bridge')` inside executeTool, long after the
// route module has finished compiling, so a Module._load patch that is
// restored immediately after _compile() would miss every one of them and the
// test would silently reach the real bridge over the network.
const stubs = {
    'next/server': {
      NextResponse: {
        json(body, init = {}) {
          return { status: init.status ?? 200, _body: body, async json() { return body } }
        },
      },
    },
    '@/lib/ai': {
      // Return whatever tool the test asked for; the model is not under test.
      async generateWithFallback() {
        return { text: state.toolResponse, usedProvider: 'stub', usedModel: 'stub' }
      },
    },
    '@/lib/auth': {
      isAuthorizedRequest: () => true,
      getCurrentUser: async () => state.user,
      hasPermission: (user, key) => Boolean(
        user && (user.role === 'admin' || (user.permissions || []).includes(key)),
      ),
      sessionTokenStatus: () => 'valid',
      AUTH_COOKIE_NAME: 'gf_token',
    },
    '@/lib/audit': {
      // Neutralise the audit side effect; assessRisk stays the real one.
      auditLog: async () => {},
      assessRisk: (tool, params) => ({ risk: 5, level: 'safe', reason: 'stub', requires_confirmation: false }),
    },
    '@/lib/intrusion': {
      PRIVILEGED_PERMISSIONS: new Set(['admin_tools', 'terminal', 'mac_control', 'remote', 'file_write']),
      hasStableAuthSecret: () => false,
      reportUnauthorizedAccess: async () => ({ locked: false, method: null }),
    },
    '@/lib/users': { isOwner: () => state.user?.role === 'admin' },
    '@/lib/local-runtime': { chooseBestInstalledModel: () => null },
    '@/lib/mark-liv-bridge': {
      runMarkLiv: async (name, params) => {
        state.executed.push({ tool: `mark_liv:${name}`, params })
        return `mark_liv ran ${name}`
      },
      markLivCatalog: async () => '- open_app(app): Launch an app',
      markLivTools: async () => [],
    },
  }

// Intercept require() so the route's own top-level requires AND its
// runtime `await import(...)` (transpiled to require) hit the stubs.
// A load hook would have to re-emit source for the .ts files the route pulls
// in, which is fragile here; overriding Module._load keeps the alias hook
// that already resolves '@/...' to .ts and lets require() own the stubbing.
const originalLoad = Module._load
const stubCache = {}
function stubbedLoad(request, parent, isMain) {
  if (Object.hasOwn(stubs, request)) {
    let stub = stubCache[request]
    if (!stub) { stub = stubs[request]; stubCache[request] = stub }
    return stub
  }
  return originalLoad.call(this, request, parent, isMain)
}

function loadRoute() {
  Module._load = stubbedLoad
  const compiled = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = new Module(routePath, module)
  mod.filename = routePath
  mod.paths = Module._nodeModulePaths(path.dirname(routePath))
  mod._compile(compiled, routePath)
  Module._load = originalLoad
  return mod.exports
}

/** POST() with the stubbed modules in place for its whole async lifetime. */
async function callRoute(request) {
  Module._load = stubbedLoad
  try {
    return await route.POST(request)
  } finally {
    Module._load = originalLoad
  }
}

/** Run POST() with the model returning a call to `tool`, and return the payload. */
async function runJarvisTool(tool, toolParams = {}, user = ADMIN, ip = 'local') {
  route = route || loadRoute()
  state.toolResponse = JSON.stringify({ speech: `Calling ${tool}`, tool, toolParams })
  state.executed = []
  const res = await callRoute(jarvisRequest({ message: `please run ${tool}` }, { user, ip }))
  return res._body
}

let route

test('POST rejects unauthenticated requests before any tool can run', async () => {
  route = route || loadRoute()
  state.toolResponse = JSON.stringify({ speech: 'hi', tool: 'get_time', toolParams: {} })
  const res = await callRoute({
    ip: 'no-auth',
    headers: new Map([['x-forwarded-for', 'no-auth'], ['user-agent', 'node-test']]),
    cookies: { get: () => undefined },
    async json() { return { message: 'hello' } },
  })
  assert.equal(res.status, 401)
  assert.deepEqual(state.executed, [])
})

test('POST refuses a tool for a user lacking its permission, without executing it', async () => {
  const limited = { role: 'user', permissions: ['chat'], name: 'Limited', username: 'limited' }
  // One representative tool per privilege class, so a gate that only covers
  // some tools still fails here.
  const denied = [
    ['terminal_command', { command: 'echo hi' }, 'terminal'],
    ['mac_control', { script: 'tell app "Finder" to activate' }, 'mac_control'],
    ['set_volume', { level: '10' }, 'admin_tools'],
    ['get_weather', {}, 'weather'],
  ]
  for (const [tool, toolParams] of denied) {
    const body = await runJarvisTool(tool, toolParams, limited, `deny-${tool}`)
    assert.equal(body.tool, null, `${tool}: a denied tool must not be reported as run`)
    assert.equal(body.toolResult, null, `${tool}: must not produce a result`)
    // The refusal speaks the tool's friendly name, not the permission key.
    assert.match(body.speech, new RegExp(`permission for "${tool.replace(/_/g, ' ')}"`),
      `${tool}: denial must explain which tool was refused`)
  }
  assert.deepEqual(state.executed, [], 'no denied tool may reach the executor')
})

test('POST runs a tool the user is entitled to', async () => {
  const user = { role: 'user', permissions: ['chat', 'weather'], name: 'Limited', username: 'limited' }
  const body = await runJarvisTool('get_time', {}, user, 'allow-get-time')
  // get_time maps to 'chat', which this user holds.
  assert.equal(body.tool, 'get_time')
  assert.notEqual(body.toolResult, null)
})

// terminal_command spawns without a shell, so `echo` only exists where a
// coreutils echo is on PATH (not stock Windows). The running node binary is
// always there.
function printCommand(text) {
  return `"${process.execPath}" -e "process.stdout.write('${text}')"`
}

test('an admin is not permission-gated', async () => {
  const body = await runJarvisTool('terminal_command', { command: printCommand('hi') }, ADMIN, 'admin-tool')
  assert.equal(body.tool, 'terminal_command')
  assert.equal(state.executed.length, 0, 'terminal_command runs locally, not through the Mark-LIV stub')
  assert.equal(body.toolResult, 'hi')
})

test('a Mark-LIV tool call is dispatched through the bridge under its own name', async () => {
  const body = await runJarvisTool(
    'send_message',
    { receiver: 'Feras', message: 'hi there' },
    ADMIN,
    'mark-liv-send',
  )
  assert.equal(body.tool, 'send_message')
  assert.deepEqual(state.executed, [{
    tool: 'mark_liv:send_message',
    params: { receiver: 'Feras', message_text: 'hi there', platform: 'WhatsApp' },
  }])
})

test('send_message accepts the web-UI contact/message spelling too', async () => {
  await runJarvisTool('send_message', { contact: 'Sara', message: 'yo' }, ADMIN, 'mark-liv-send-2')
  assert.deepEqual(state.executed, [{
    tool: 'mark_liv:send_message',
    params: { receiver: 'Sara', message_text: 'yo', platform: 'WhatsApp' },
  }])
})

test('send_message asks for the missing field instead of sending a blank message', async () => {
  const body = await runJarvisTool('send_message', { message: 'yo' }, ADMIN, 'mark-liv-send-3')
  assert.match(body.toolResult, /contact name/i)
  assert.deepEqual(state.executed, [], 'a message with no recipient must not reach the bridge')
})

test('alias tools reach the same executor as the tool they alias', async () => {
  // run_terminal → terminal_command. Same argv, same blocklist, same result.
  const viaAlias = await runJarvisTool('run_terminal', { command: printCommand('aliased') }, ADMIN, 'alias-run')
  const viaCanonical = await runJarvisTool('terminal_command', { command: printCommand('aliased') }, ADMIN, 'alias-canon')
  assert.equal(viaAlias.toolResult, 'aliased')
  assert.equal(viaAlias.toolResult, viaCanonical.toolResult)
})

test('run_terminal inherits the terminal blocklist', async () => {
  const body = await runJarvisTool('run_terminal', { command: 'rm -rf /' }, ADMIN, 'alias-blocked')
  assert.equal(body.toolResult, 'Command blocked for safety')
})

test('a denied alias tool is refused exactly like the tool it aliases', async () => {
  const limited = { role: 'user', permissions: ['chat'], name: 'Limited', username: 'limited' }
  const body = await runJarvisTool('run_terminal', { command: 'echo hi' }, limited, 'deny-alias')
  assert.equal(body.tool, null)
  assert.equal(body.toolResult, null)
})