'use strict'
// /api/marketplace: install marks are shared state, so POST is admin-only
// (admin_tools); a web "Mark installed" goes to registry.marked[] and never
// claims a verified install; GET ignores non-string registry.installed entries
// exactly like the TUI (tui/lib/marketplace-state.js), and reports marked ids
// separately so the TUI keeps offering a real install for them.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routePath = path.resolve(__dirname, '../app/api/marketplace/route.ts')
const statePath = path.resolve(__dirname, '../lib/marketplace-state.ts')
const tuiStatePath = path.resolve(__dirname, '../../tui/lib/marketplace-state.js')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-marketplace-'))
const mdir = path.join(tmp, 'marketplace')
fs.mkdirSync(mdir)
const REGISTRY = path.join(mdir, 'registry.json')

const CATALOG = {
  items: [
    { id: 'semgrep', name: 'Semgrep', type: 'tool', category: 'Security', description: 'x', install_command: 'brew install semgrep' },
    { id: 'trivy', name: 'Trivy', type: 'tool', category: 'Security', description: 'x', install_command: 'brew install trivy' },
    { id: 'seeded', name: 'Seeded', type: 'agent', category: 'Code', description: 'x', installed: true },
  ],
}
fs.writeFileSync(path.join(mdir, 'catalog.json'), JSON.stringify(CATALOG))
fs.writeFileSync(path.join(mdir, 'sources.json'), JSON.stringify({ sources: [] }))

const state = { user: null, authorized: true, permissionAsked: [] }
const ADMIN = { id: 'a', username: 'admin', role: 'admin', permissions: [] }
const MEMBER = { id: 'u', username: 'member', role: 'user', permissions: ['chat'] }

class NextResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200 }
  async json() { return this.body }
  static json(body, init) { return new NextResponse(body, init) }
}
const hasPermission = (user, key) => Boolean(user) && (user.role === 'admin' || (user.permissions || []).includes(key))

const dependencies = {
  'next/server': { NextResponse },
  '@/lib/auth': {
    isAuthorizedRequest: () => state.authorized,
    getCurrentUser: async () => state.user,
    hasPermission,
  },
  '@/lib/access': {
    async requirePermission(_req, key) {
      state.permissionAsked.push(key)
      if (!state.authorized || !state.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (!hasPermission(state.user, key)) return NextResponse.json({ error: `no ${key}` }, { status: 403 })
      return state.user
    },
  },
}

const cwd = process.cwd()
const originalLoad = Module._load
let route
try {
  process.chdir(tmp)
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(dependencies, request)) return dependencies[request]
    if (request === '@/lib/marketplace-state') return originalLoad.call(this, statePath, parent, isMain)
    return originalLoad.call(this, request, parent, isMain)
  }
  const compiled = ts.transpileModule(fs.readFileSync(routePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const routeModule = new Module(routePath, module)
  routeModule.filename = routePath
  routeModule.paths = Module._nodeModulePaths(path.dirname(routePath))
  routeModule._compile(compiled, routePath)
  route = routeModule.exports
} finally {
  Module._load = originalLoad
  process.chdir(cwd)
}

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const writeRegistry = data => fs.writeFileSync(REGISTRY, JSON.stringify(data, null, 2))
const readRegistry = () => JSON.parse(fs.readFileSync(REGISTRY, 'utf8'))
const post = body => route.POST({ json: async () => body, nextUrl: { pathname: '/api/marketplace' } })
const get = () => route.GET({})

test('POST requires the admin_tools permission and leaves the registry alone for others', async () => {
  writeRegistry({ installed: [], removed: [] })
  const before = fs.readFileSync(REGISTRY, 'utf8')
  state.user = MEMBER
  state.permissionAsked = []
  const res = await post({ action: 'install', id: 'semgrep' })
  assert.equal(res.status, 403)
  assert.deepEqual(state.permissionAsked, ['admin_tools'])
  assert.equal(fs.readFileSync(REGISTRY, 'utf8'), before)

  state.user = null
  assert.equal((await post({ action: 'install', id: 'semgrep' })).status, 401)
})

test('a web mark goes to registry.marked, not registry.installed', async () => {
  writeRegistry({ installed: [], removed: [], custom_agents: [{ name: 'keep me' }] })
  state.user = ADMIN
  for (const action of ['mark', 'install']) {
    const res = await post({ action, id: 'semgrep' })
    assert.equal(res.status, 200, action)
    const body = await res.json()
    assert.ok(!body.installed.includes('semgrep'), `${action}: a mark must not claim a verified install`)
    assert.deepEqual(body.marked, ['semgrep'])
    const reg = readRegistry()
    assert.deepEqual(reg.installed, [])
    assert.deepEqual(reg.marked, ['semgrep'])
    assert.deepEqual(reg.custom_agents, [{ name: 'keep me' }])
  }

  // The TUI therefore still offers a real install for it.
  const { applyEffectiveMarketplaceState } = await import(tuiStatePath)
  const tui = applyEffectiveMarketplaceState(CATALOG, readRegistry())
  const semgrep = tui.items.find(i => i.id === 'semgrep')
  assert.equal(semgrep.installed, false)
  assert.equal(semgrep.marked, true)
  assert.ok(tui.items.filter(i => !i.installed).some(i => i.id === 'semgrep'), 'TUI Install Item list keeps the marked item')
})

test('unmark clears marks and verified installs; catalog-seeded items get removed[]', async () => {
  writeRegistry({ installed: ['trivy'], marked: ['semgrep'], removed: [] })
  state.user = ADMIN
  let body = await (await post({ action: 'unmark', id: 'semgrep' })).json()
  assert.deepEqual(body.marked, [])
  body = await (await post({ action: 'remove', id: 'trivy' })).json()
  assert.ok(!body.installed.includes('trivy'))
  body = await (await post({ action: 'unmark', id: 'seeded' })).json()
  assert.ok(!body.installed.includes('seeded'))
  assert.deepEqual(readRegistry().removed, ['seeded'])
})

test('GET reports marked ids separately and only string ids as installed', async () => {
  writeRegistry({
    installed: ['trivy', { id: 'my-cmd', type: 'command', name: 'My cmd', file: 'commands/my-cmd.md' }],
    marked: ['semgrep'],
    removed: [],
  })
  state.user = MEMBER
  const body = await (await get()).json()
  assert.ok(body.installed.every(id => typeof id === 'string'), 'generated objects must not be counted as installed')
  assert.deepEqual([...body.installed].sort(), ['seeded', 'trivy'])
  assert.deepEqual(body.marked, ['semgrep'])
  assert.equal(body.canEdit, false)
  state.user = ADMIN
  assert.equal((await (await get()).json()).canEdit, true)
})

test('a web POST moves old generated objects out of installed[] instead of dropping them', async () => {
  const generated = { id: 'my-cmd', type: 'command', name: 'My cmd', file: 'commands/my-cmd.md' }
  writeRegistry({ installed: ['trivy', generated], removed: [] })
  state.user = ADMIN
  await post({ action: 'mark', id: 'semgrep' })
  const reg = readRegistry()
  assert.deepEqual(reg.installed, ['trivy'])
  assert.deepEqual(reg.generated, [generated])
})

test('POST reports a registry write failure instead of pretending it worked', async t => {
  if (process.platform === 'win32') {
    t.skip('uses a POSIX symlink to make the write fail')
    return
  }
  // A dangling symlink into a missing directory: reading gives ENOENT (treated
  // as "no registry yet") and the write then fails, even when run as root.
  fs.rmSync(REGISTRY, { force: true })
  fs.symlinkSync(path.join(tmp, 'missing-dir', 'registry.json'), REGISTRY)
  try {
    state.user = ADMIN
    const res = await post({ action: 'mark', id: 'semgrep' })
    assert.equal(res.status, 500)
    assert.match((await res.json()).error, /registry/i)
  } finally {
    fs.rmSync(REGISTRY, { force: true })
  }
})

test('POST does not overwrite a registry it cannot parse', async () => {
  fs.writeFileSync(REGISTRY, '{ not json')
  state.user = ADMIN
  const res = await post({ action: 'mark', id: 'semgrep' })
  assert.equal(res.status, 500)
  assert.equal(fs.readFileSync(REGISTRY, 'utf8'), '{ not json')
})

test('invalid actions and ids are rejected', async () => {
  writeRegistry({ installed: [], removed: [] })
  state.user = ADMIN
  for (const body of [{ action: 'run', id: 'x' }, { action: 'mark' }, { action: 'mark', id: 7 }, null]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body))
  }
})
