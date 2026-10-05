// Auth coverage lock (T-205).
//
// The middleware only guards page routes; /api/* is deliberately excluded, so
// every API route handler must authenticate in-route. This test enumerates
// every app/api/**/route.ts and fails when an exported HTTP handler does not
// call an auth guard as a top-level statement of its body (directly or via a
// local helper that does so). It also fails when a top-level app/ page section
// is not listed in the middleware's PROTECTED_PREFIXES + config.matcher.
//
// Adding a new route? Guard it (isAuthorizedRequest / getCurrentUser /
// requirePermission …). Intentionally public? Add it to PUBLIC_HANDLERS with
// the reason — that list is the reviewable record of unauthenticated surface.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const webRoot = path.resolve(__dirname, '..')
const apiRoot = path.join(webRoot, 'app', 'api')
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const AUTH_MODULES = new Set(['@/lib/auth', '@/lib/access'])
const GUARDS = new Set([
  'isAuthorizedRequest',
  'getCurrentUser',
  'requireCurrentUser',
  'requirePermission',
  'getSessionUser',
  'isAuthenticatedSession',
  'isValidAuthToken',
  'verifySessionToken',
  'sessionTokenStatus',
])

// "<route dir relative to app/api> <METHOD>" → why it is public.
const PUBLIC_HANDLERS = {
  'auth POST': 'login endpoint — issues the session cookie; rate-limited per IP',
  'remote/pair GET': 'device pairing page — shows a confirm button only; does not use the code (link previewers would burn it)',
  'remote/pair/redeem POST': 'device pairing redemption — the one-time 128-bit pairing code is the credential; same-origin form, IP failure-limited',
}

// Top-level app/ page sections that are intentionally reachable signed-out.
const PUBLIC_PAGE_SECTIONS = new Set(['api', 'login'])

// App Router segment names that are not page sections and so can never appear in
// middleware config.matcher. `_`/`(` are route groups, `[`/`@` are dynamic
// segments/interception — all already excluded for Next.js routing reasons.
// `.`-prefixed names are Next.js-private/ignored AND commonly gitignored tool
// state (`.omc/`, `.next/`, `.turbo/`, `.cache/`) that lands next to the app on
// a developer machine. Excluding them is not a weakening: the App Router never
// routes a dot-directory, so no such section can ever be reached by URL, and a
// genuinely removed PROTECTED_PREFIX (a real `_`-free segment) still fails.
const UNROUTABLE_SECTION = /^[_.(\[@]/

function isPageSection(name) {
  return !UNROUTABLE_SECTION.test(name) && !PUBLIC_PAGE_SECTIONS.has(name)
}

function listRoutes(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listRoutes(full)
    return /^route\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : []
  })
}

function hasExport(node) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) || []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
}

function analyse(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const importedGuards = new Set()
  const localFns = new Map()
  const handlers = new Map()
  const problems = []

  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) && AUTH_MODULES.has(stmt.moduleSpecifier.text)) {
      const bindings = stmt.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const imported = (el.propertyName || el.name).text
          if (GUARDS.has(imported)) importedGuards.add(el.name.text)
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text
      if (hasExport(stmt) && HTTP_METHODS.has(name)) handlers.set(name, stmt)
      else localFns.set(name, stmt)
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const name = decl.name.text
        const init = decl.initializer
        const fn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : null
        if (hasExport(stmt) && HTTP_METHODS.has(name)) {
          if (fn) handlers.set(name, fn)
          else problems.push(`${name} is exported in a form this audit cannot verify — export an async function`)
        } else if (fn) {
          localFns.set(name, fn)
        }
      }
    } else if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        if (HTTP_METHODS.has(el.name.text)) {
          problems.push(`${el.name.text} is re-exported — define the handler in this file so its auth guard can be verified`)
        }
      }
    }
  }

  // A function is guarded when one of its top-level body statements calls a
  // guard (or a guarded local helper) outside any nested block or callback —
  // i.e. the check runs unconditionally before the handler does real work.
  const memo = new Map()
  function isGuarded(fn, name) {
    if (memo.has(name)) return memo.get(name)
    memo.set(name, false) // break recursion cycles
    const body = fn.body
    const statements = body && ts.isBlock(body) ? body.statements : body ? [body] : []
    let found = false
    const visit = node => {
      if (found || ts.isBlock(node) || isFunctionLike(node)) return
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const callee = node.expression.text
        if (importedGuards.has(callee)) found = true
        else if (localFns.has(callee) && callee !== name && isGuarded(localFns.get(callee), callee)) found = true
      }
      if (!found) ts.forEachChild(node, visit)
    }
    for (const stmt of statements) {
      // Top-level try { … } is a common wrapper; look one level into it.
      if (ts.isTryStatement(stmt)) stmt.tryBlock.statements.forEach(visit)
      else visit(stmt)
      if (found) break
    }
    memo.set(name, found)
    return found
  }

  const results = []
  for (const [method, fn] of handlers) results.push({ method, guarded: isGuarded(fn, `export:${method}`) })
  return { results, problems }
}

const routes = listRoutes(apiRoot).sort()

test('app/api route enumeration is non-trivial', () => {
  assert.ok(routes.length >= 50, `expected the full API surface, found ${routes.length} routes`)
})

test('every app/api route handler authenticates in-route unless explicitly public', () => {
  const unguarded = []
  const seenPublic = new Set()
  for (const file of routes) {
    const routeId = path.relative(apiRoot, path.dirname(file)).split(path.sep).join('/')
    const { results, problems } = analyse(file)
    for (const problem of problems) unguarded.push(`app/api/${routeId}: ${problem}`)
    assert.ok(results.length > 0 || problems.length > 0, `app/api/${routeId} exports no HTTP handler`)
    for (const { method, guarded } of results) {
      const key = `${routeId} ${method}`
      if (Object.hasOwn(PUBLIC_HANDLERS, key)) {
        seenPublic.add(key)
        continue
      }
      if (!guarded) unguarded.push(`app/api/${routeId} ${method}`)
    }
  }
  assert.deepEqual(unguarded, [], `API handlers without a top-level auth guard:\n  ${unguarded.join('\n  ')}`)
  const stale = Object.keys(PUBLIC_HANDLERS).filter(key => !seenPublic.has(key))
  assert.deepEqual(stale, [], 'PUBLIC_HANDLERS lists handlers that no longer exist')
})

test('the audit catches a handler whose only guard is nested in a branch', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gf-auth-')), 'route.ts')
  fs.writeFileSync(tmp, [
    "import { isAuthorizedRequest } from '@/lib/auth'",
    'async function requireUser(req) { if (!isAuthorizedRequest(req)) return false; return true }',
    'export async function GET(req) { if (!await requireUser(req)) return null; return 1 }',
    "export async function POST(req) { if (req.url.includes('config')) { if (!isAuthorizedRequest(req)) return null } return 1 }",
    'export async function PUT(req) { return 1 }',
    'export const DELETE = 42',
  ].join('\n'))
  try {
    const { results, problems } = analyse(tmp)
    assert.deepEqual(Object.fromEntries(results.map(r => [r.method, r.guarded])), { GET: true, POST: false, PUT: false })
    assert.equal(problems.length, 1)
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  }
})

test('/api is not login-protected by middleware, so in-route guards remain mandatory', () => {
  const mw = fs.readFileSync(path.join(webRoot, 'middleware.ts'), 'utf8')
  // The matcher runs on /api only for the hosted-mode allowlist (403 when
  // hosted); the login redirect explicitly skips it.
  assert.match(mw, /const API_PREFIX = '\/api'/)
  assert.match(mw, /PROTECTED_PREFIXES\.some\(p => p !== API_PREFIX && /)
  const apiBranch = mw.slice(mw.indexOf('export async function middleware'), mw.indexOf('// Exact-or-subpath match'))
  assert.doesNotMatch(apiBranch, /redirect|isValidAuthToken/, 'nothing but the hosted check may run before the login check')
})

test('every app page section is covered by middleware PROTECTED_PREFIXES and matcher', () => {
  const mw = fs.readFileSync(path.join(webRoot, 'middleware.ts'), 'utf8')
  const prefixes = [...mw.match(/const PROTECTED_PREFIXES = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  const matcher = [...mw.match(/matcher: \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  assert.deepEqual(matcher, prefixes.map(p => `${p}/:path*`), 'config.matcher must mirror PROTECTED_PREFIXES')

  const sections = fs.readdirSync(path.join(webRoot, 'app'), { withFileTypes: true })
    .filter(e => e.isDirectory() && isPageSection(e.name))
    .map(e => `/${e.name}`)
  const missing = sections.filter(s => !prefixes.includes(s))
  assert.deepEqual(missing, [], `app sections missing from middleware PROTECTED_PREFIXES: ${missing.join(', ')}`)
})

test('the page-section scan skips dot-directories but still demands real ones', () => {
  // Dot-directories are gitignored tool state (`.omc/`, `.next/`) or
  // Next.js-private, and the App Router never routes them, so they must not be
  // reported as unprotected sections. This is the regression that made
  // health.mjs read `/.omc` as a missing PROTECTED_PREFIX on any machine that
  // happened to have local OMC state under web-ui/app.
  for (const ignored of ['.omc', '.next', '.turbo', '.cache', '_private', '(group)', '[slug]', '@modal']) {
    assert.equal(isPageSection(ignored), false, `${ignored} must not be scanned as a page section`)
  }

  // The exclusion is a whitelist-free filter on unroutable names only: a real
  // page section (and the intentionally public ones) is still scanned, so a
  // genuinely removed PROTECTED_PREFIX cannot slip through this exemption.
  for (const scanned of ['dashboard', 'settings', 'agents', 'tickets']) {
    assert.equal(isPageSection(scanned), true, `${scanned} must still be scanned as a page section`)
  }
  assert.equal(isPageSection('api'), false, 'api is intentionally not scanned (public section)')
  assert.equal(isPageSection('login'), false, 'login is intentionally not scanned (public section)')

  // End-to-end: a dot-directory created next to the app must not fail the scan.
  const probe = path.join(webRoot, 'app', '.omc')
  fs.mkdirSync(probe, { recursive: true })
  try {
    const sections = fs.readdirSync(path.join(webRoot, 'app'), { withFileTypes: true })
      .filter(e => e.isDirectory() && isPageSection(e.name))
      .map(e => `/${e.name}`)
    assert.ok(!sections.includes('/.omc'), 'a dot-directory must not appear as a required page section')
  } finally {
    fs.rmSync(probe, { recursive: true, force: true })
  }
})

test('webhook POST rejects unsigned, unauthenticated non-GitHub deliveries', async () => {
  const Module = require('node:module')
  const routePath = path.join(apiRoot, 'webhook', 'route.ts')
  let jarvisCalls = 0
  const stubs = {
    // Real hosted-mode policy: off unless GHOSTFORGE_MODE=hosted
    '@/lib/hosted': require('../lib/hosted.ts'),
    '@/lib/auth': { isAuthorizedRequest: () => false, getAuthSecret: () => 'secret' },
    '../jarvis/route': { POST: async () => { jarvisCalls++; return { text: async () => '' } } },
    'next/server': {
      NextRequest: class {},
      NextResponse: { json: (body, init = {}) => ({ status: init.status ?? 200, body }) },
    },
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const savedSecret = process.env.WEBHOOK_SECRET
  try {
    const compiled = ts.transpileModule(fs.readFileSync(routePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    const mod = new Module(routePath, module)
    mod.filename = routePath
    mod.paths = Module._nodeModulePaths(path.dirname(routePath))
    mod._compile(compiled, routePath)
    const request = headers => ({
      url: 'http://localhost/api/webhook',
      headers: new Headers(headers),
      text: async () => JSON.stringify({ hello: 'world' }),
    })

    delete process.env.WEBHOOK_SECRET
    assert.equal((await mod.exports.POST(request({ 'x-source': 'anon' }))).status, 401)
    process.env.WEBHOOK_SECRET = 'whsec'
    assert.equal((await mod.exports.POST(request({ 'x-source': 'anon', 'x-hub-signature-256': 'sha256=bad' }))).status, 401)
    assert.equal((await mod.exports.POST(request({ 'x-github-event': 'push' }))).status, 401)
    assert.equal(jarvisCalls, 0)
  } finally {
    Module._load = originalLoad
    if (savedSecret === undefined) delete process.env.WEBHOOK_SECRET
    else process.env.WEBHOOK_SECRET = savedSecret
  }
})
