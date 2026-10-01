const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const routePath = path.resolve(__dirname, '../app/api/snippets/route.ts')
const pagePath = path.resolve(__dirname, '../app/snippets/page.tsx')
const repoRoot = path.resolve(__dirname, '../..')
const state = { user: null }

const dependencies = {
  'next/server': {
    NextResponse: {
      json(body, init = {}) {
        return { status: init.status ?? 200, json: async () => body }
      },
    },
  },
  '@/lib/auth': { getCurrentUser: async () => state.user },
  '@/lib/agent-team-api': { repoRootFromLib: () => repoRoot },
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

const get = query => route.GET({ url: `http://localhost/api/snippets${query}` })
const user = { id: 'u1', role: 'user', permissions: [] }

test('rejects unauthenticated requests with 401', async () => {
  state.user = null
  for (const query of ['', '?doc=README.md', '?snippet=api-hook.md', '?doc=../package.json']) {
    const response = await get(query)
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'Authentication required.' })
  }
})

test('lists the fixed docs and the snippet files', async () => {
  state.user = user
  const response = await get('')
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.deepEqual(body.docs, ['CHANGELOG.md', 'README.md'])
  assert.ok(body.snippets.includes('zustand-store.ts'))
})

test('serves CHANGELOG.md and README.md verbatim', async () => {
  state.user = user
  for (const name of ['CHANGELOG.md', 'README.md']) {
    const response = await get(`?doc=${name}`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { name, content: fs.readFileSync(path.join(repoRoot, name), 'utf8') })
  }
})

test('serves a listed snippet', async () => {
  state.user = user
  const response = await get('?snippet=api-hook.md')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).content, fs.readFileSync(path.join(repoRoot, 'snippets/api-hook.md'), 'utf8'))
})

test('confines reads to the allowlist (no path traversal or arbitrary files)', async () => {
  state.user = user
  const attempts = [
    '?doc=../package.json', '?doc=..%2Fpackage.json', '?doc=CLAUDE.md', '?doc=AGENTS.md',
    '?doc=web-ui/package.json', '?doc=/etc/passwd', '?doc=C:%5CWindows%5Cwin.ini', '?doc=readme.md',
    '?snippet=../README.md', '?snippet=..%2FREADME.md', '?snippet=..%5CREADME.md',
    '?snippet=%2e%2e%2fCLAUDE.md', '?snippet=/etc/passwd', '?snippet=nope.md', '?snippet=',
    '?snippet=api-hook.md%00.png', '?snippet=.git',
  ]
  for (const query of attempts) {
    const response = await get(query)
    assert.equal(response.status, 404, query)
    assert.equal('content' in (await response.json()), false, query)
  }
})

test('rejects ambiguous doc+snippet requests', async () => {
  state.user = user
  assert.equal((await get('?doc=README.md&snippet=api-hook.md')).status, 400)
})

test('page uses only logical Tailwind utilities', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  assert.doesNotMatch(page, /(?<![\w-])(?:ml|mr|pl|pr|left|right)-[\w[]|text-(?:left|right)|rounded-[lr]\b|border-[lr]\b/)
})
