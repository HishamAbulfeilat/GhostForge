const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routePath = path.resolve(__dirname, '../app/api/dashboard/route.ts')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-dashboard-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.GITHUB_TOKEN = 'test-token'

// Fake exec: every command takes 50 ms; record how many run at once.
const execStats = { inFlight: 0, maxInFlight: 0, commands: [] }
function fakeExec(command, _options, callback) {
  execStats.commands.push(command)
  execStats.inFlight++
  execStats.maxInFlight = Math.max(execStats.maxInFlight, execStats.inFlight)
  setTimeout(() => {
    execStats.inFlight--
    callback(null, { stdout: '', stderr: '' })
  }, 50)
}

const dependencies = {
  'next/server': {
    NextResponse: { json(body, init = {}) { return { status: init.status ?? 200, json: async () => body } } },
  },
  '@/lib/hosted': { hostedGuard: () => null },
  '@/lib/auth': { isAuthorizedRequest: () => true },
  '@/lib/system-info': {
    getCPU: () => 1,
    getRAM: () => ({ usedGB: 1, totalGB: 2, pct: 50 }),
    getDisk: () => ({ usedGB: 1, totalGB: 2, pct: 50 }),
    getBattery: () => ({ pct: null, charging: false, present: false }),
  },
  child_process: { exec: fakeExec },
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (Object.hasOwn(dependencies, request)) return dependencies[request]
  return originalLoad.call(this, request, parent, isMain)
}

let route
try {
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
}

const realFetch = global.fetch
test.before(() => { global.fetch = async () => { throw new Error('offline') } })
test.after(() => {
  global.fetch = realFetch
  fs.rmSync(home, { recursive: true, force: true })
})

test('dashboard runs the git and gh commands concurrently', async () => {
  const res = await route.GET({})
  assert.equal(res.status, 200)
  assert.ok(execStats.commands.some(c => c.startsWith('gh pr list')), 'gh commands run when GITHUB_TOKEN is set')
  assert.equal(execStats.maxInFlight, execStats.commands.length, 'every command was in flight at once')
})

test('dashboard reads only the newest audit entries and skips malformed lines', async () => {
  const dir = path.join(home, '.ghostforge')
  fs.mkdirSync(dir, { recursive: true })
  const old = Array.from({ length: 5000 }, (_, i) => JSON.stringify({ ts: 't', level: 'info', event: `old-${i}` }))
  const recent = Array.from({ length: 10 }, (_, i) => JSON.stringify({ ts: 't', level: 'warn', event: `new-${i}` }))
  // A malformed line among the newest must not hide the others
  fs.writeFileSync(path.join(dir, 'audit.log'), [...old, ...recent.slice(0, 5), '{not json', ...recent.slice(5)].join('\n') + '\n')

  const body = await (await route.GET({})).json()
  assert.deepEqual(body.audit.map(e => e.event), ['new-9', 'new-8', 'new-7', 'new-6', 'new-5', 'new-4', 'new-3', 'new-2'])
})
