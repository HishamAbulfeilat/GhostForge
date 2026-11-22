'use strict'
// JARVIS "ID VERIFY": the page sends { action: 'identity-challenge', name, dob, keyword }
// and the route must check those fields (it used to read `answer` / `question`,
// so every attempt "failed"). Enrollment stores the keyword (hashed), and
// missing fields are a 400, not a 200 challenge question.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { tmpdir } = require('node:os')
const ts = require('typescript')

const fakeHome = fs.mkdtempSync(path.join(tmpdir(), 'gf-bio-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
delete process.env.OWNER_FULL_NAME
delete process.env.OWNER_DOB

const WEB_UI = path.resolve(__dirname, '..')
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw err
    }
  },
})

const identity = require('../lib/identity-check.ts')

class NextResponse {
  constructor(body, init = {}) { this.status = init.status ?? 200; this._body = body }
  static json(body, init = {}) { return new NextResponse(body, init) }
}
const stubs = {
  'next/server': { NextResponse },
  // Enrollment is admin-only; this suite enrolls as the owner.
  '@/lib/auth': {
    isAuthorizedRequest: () => true,
    getCurrentUser: async () => ({ username: 'owner', role: 'admin', active: true }),
    isAdmin: user => user?.role === 'admin',
  },
  '@/lib/audit': { auditLog: async () => {} },
}
const originalLoad = Module._load
function stubbedLoad(request, parent, isMain) {
  if (Object.hasOwn(stubs, request)) return stubs[request]
  if (request.startsWith('@/')) return originalLoad.call(this, path.join(WEB_UI, request.slice(2)) + '.ts', parent, isMain)
  return originalLoad.call(this, request, parent, isMain)
}
function loadRoute(rel) {
  const file = path.join(WEB_UI, rel)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  Module._load = stubbedLoad
  try { mod._compile(compiled, file) } finally { Module._load = originalLoad }
  return mod.exports
}
const route = loadRoute('app/api/jarvis/biometrics/route.ts')

async function post(body) {
  Module._load = stubbedLoad
  try {
    return await route.POST({
      headers: new Map([['content-type', 'application/json']]),
      async json() { return body },
    })
  } finally {
    Module._load = originalLoad
  }
}

test.after(() => {
  hooks.deregister()
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

const AUDIO = Buffer.alloc(4000, 7).toString('base64')

test('dobCandidates understands the formats the page suggests', () => {
  assert.deepEqual(identity.dobCandidates('14 July 1990'), ['1990-07-14'])
  assert.deepEqual(identity.dobCandidates('July 14th, 1990'), ['1990-07-14'])
  assert.deepEqual(identity.dobCandidates('1990-07-14'), ['1990-07-14'])
  assert.deepEqual(identity.dobCandidates('14/07/1990'), ['1990-07-14'])
  assert.deepEqual(identity.dobCandidates('03/04/1990').sort(), ['1990-03-04', '1990-04-03'])
  assert.deepEqual(identity.dobCandidates('31 February 1990'), [])
  assert.deepEqual(identity.dobCandidates('sometime'), [])
})

test('identity check with nothing enrolled or configured is a 503, not a silent fail', async () => {
  const res = await post({ action: 'identity-challenge', name: 'Ada Lovelace', dob: '10 December 1815', keyword: 'engine' })
  assert.equal(res.status, 503)
  assert.equal(res._body.verified, false)
})

test('missing fields are a 400 instead of a 200 challenge question', async () => {
  const res = await post({ action: 'identity-challenge', name: 'Ada Lovelace' })
  assert.equal(res.status, 400)
  assert.match(res._body.error, /dob, keyword/)
  assert.equal(res._body.challengeQuestion, undefined)
})

test('enroll stores a hashed identity, then the page contract verifies', async () => {
  const enrolled = await post({ action: 'enroll-voice', audio: AUDIO, name: 'Ada Lovelace', dob: '10 December 1815', keyword: 'Analytical Engine' })
  assert.equal(enrolled.status, 200)
  assert.equal(enrolled._body.success, true)

  const stored = fs.readFileSync(path.join(fakeHome, '.ghostforge', 'biometrics', 'identity.json'), 'utf8')
  assert.ok(!/ada|lovelace|1815|engine/i.test(stored), 'nothing stored in clear text')

  const ok = await post({ action: 'identity-challenge', name: 'ada  lovelace', dob: '1815-12-10', keyword: 'analytical engine' })
  assert.equal(ok.status, 200)
  assert.equal(ok._body.verified, true)
  assert.deepEqual(ok._body.checked, ['name', 'dob', 'keyword'])
})

test('a wrong keyword, name or date of birth does not verify', async () => {
  for (const body of [
    { name: 'Ada Lovelace', dob: '10 December 1815', keyword: 'difference engine' },
    { name: 'Ada', dob: '10 December 1815', keyword: 'analytical engine' },
    { name: 'Ada Lovelace', dob: '11 December 1815', keyword: 'analytical engine' },
  ]) {
    const res = await post({ action: 'identity-challenge', ...body })
    assert.equal(res.status, 200)
    assert.equal(res._body.verified, false, JSON.stringify(body))
  }
})

test('OWNER_FULL_NAME / OWNER_DOB take precedence and enrollment must match them', async () => {
  process.env.OWNER_FULL_NAME = 'Grace Hopper'
  process.env.OWNER_DOB = '1906-12-09'
  try {
    const clash = await post({ action: 'enroll-voice', audio: AUDIO, name: 'Someone Else', dob: '9 December 1906', keyword: 'cobol' })
    assert.equal(clash.status, 400)

    const enrolled = await post({ action: 'enroll-voice', audio: AUDIO, name: 'Grace Hopper', dob: 'December 9 1906', keyword: 'cobol' })
    assert.equal(enrolled.status, 200)
    const ok = await post({ action: 'identity-challenge', name: 'grace hopper', dob: '09/12/1906', keyword: 'COBOL' })
    assert.equal(ok._body.verified, true)
    const bad = await post({ action: 'identity-challenge', name: 'grace hopper', dob: '1906-12-09', keyword: 'fortran' })
    assert.equal(bad._body.verified, false)
  } finally {
    delete process.env.OWNER_FULL_NAME
    delete process.env.OWNER_DOB
  }
})
