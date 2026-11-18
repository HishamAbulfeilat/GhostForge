// "Approve & apply" follows the "Allow control of this computer" setting
// (off = a background browser) like autopilot does, and always runs in the
// background on a machine without a display (a Linux server), where a visible
// browser can't start. Chromium is replaced by a small fake, so no browser is needed.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, dirname } = require('node:path')
const ts = require('typescript')
const { chromium } = require('playwright-core')

const home = mkdtempSync(join(tmpdir(), 'gf-job-headless-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.NODE_ENV = 'test'
const savedEnv = { DISPLAY: process.env.DISPLAY, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY, JOB_HUNTER_HEADLESS: process.env.JOB_HUNTER_HEADLESS, JOB_HUNTER_BROWSER: process.env.JOB_HUNTER_BROWSER }
const setEnv = values => {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (error) {
      if (specifier.startsWith('.')) {
        for (const suffix of ['.ts', '.js', '/index.ts']) {
          try { return nextResolve(specifier + suffix, context) } catch { /* next suffix */ }
        }
      }
      throw error
    }
  },
})
function load(file, dependencies) {
  const filename = join(__dirname, file)
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(dirname(filename))
  const near = Module.createRequire(filename)
  loaded.require = request => Object.hasOwn(dependencies, request) ? dependencies[request] : near(request)
  loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename)
  return loaded.exports
}

const apply = require('../lib/job-hunter/apply.ts')
const store = require('../lib/job-hunter/store.ts')
const live = require('../lib/job-hunter/live.ts')
test.after(() => {
  setEnv(savedEnv)
  hooks.deregister()
  rmSync(home, { recursive: true, force: true })
})

test('headless when there is no display, when forced, or when computer control is off', () => {
  const linux = (env, requested) => apply.chooseHeadless(requested, env, 'linux')
  assert.equal(apply.displayAvailable({}, 'linux'), false)
  assert.equal(apply.displayAvailable({ DISPLAY: ':0' }, 'linux'), true)
  assert.equal(apply.displayAvailable({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), true)
  assert.equal(apply.displayAvailable({}, 'win32'), true)
  assert.equal(apply.displayAvailable({}, 'darwin'), true)

  assert.equal(linux({}, false), true, 'no display: a visible browser cannot start')
  assert.equal(linux({}, undefined), true)
  assert.equal(linux({ DISPLAY: ':0' }, false), false, 'computer control on: visible')
  assert.equal(linux({ DISPLAY: ':0' }, true), true, 'computer control off: background')
  assert.equal(linux({ DISPLAY: ':0', JOB_HUNTER_HEADLESS: '1' }, false), true, 'JOB_HUNTER_HEADLESS=1 forces the background')
  assert.equal(apply.chooseHeadless(false, {}, 'win32'), false)
})

test('user approvals pass the computer-control setting, the same as autopilot', async () => {
  const calls = []
  const jh = load('../lib/job-hunter/index.ts', {
    './store': store, './live': live,
    './apply': { applyToJob: async (job, profile, username, opts) => { calls.push(opts); return { status: 'needs_user', message: 'Captcha required', filled: [], missing: [] } } },
    './notifications': { notifyJob: async () => 'unavailable' },
  })
  const username = 'approver'
  await store.saveProfile(username, {
    cv: { text: 'CV', fileName: 'cv.txt', filePath: '', uploadedAt: '' },
    applicant: { firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+1 555 0100' },
  })
  const { jobs } = await store.upsertJobs(username, [{ key: 'k', title: 'Engineer', company: 'Acme', ats: 'other', url: 'https://example.com/job', applyUrl: '' }])
  await store.updateJob(username, jobs[0].id, { status: 'ready', tailoredResume: 'CV', coverLetter: 'Letter' })

  await jh.approveJob(username, jobs[0].id)
  assert.equal(calls.at(-1).headless, true, 'computer control off (the default): background browser')
  assert.equal(calls.at(-1).vision, null)
  await store.saveProfile(username, { autopilot: { laptopControl: true } })
  await jh.approveJob(username, jobs[0].id)
  assert.equal(calls.at(-1).headless, false, 'computer control on: visible browser where a display exists')
  assert.equal(typeof calls.at(-1).vision, 'function')
})

/** A fake persistent browser context whose application page shows a captcha. */
function fakeBrowser(t) {
  const launches = []
  const contexts = []
  t.mock.method(chromium, 'launchPersistentContext', async (_dir, options) => {
    launches.push(options)
    const context = new EventEmitter()
    const pages = []
    const newPage = async () => {
      const page = Object.assign(new EventEmitter(), {
        address: 'about:blank', closed: false,
        url: () => page.address,
        isClosed: () => page.closed,
        goto: async url => { page.address = url; return { ok: () => true, status: () => 200, serverAddr: async () => ({ ipAddress: '93.184.216.34' }) } },
        bringToFront: async () => { page.front = true },
        waitForLoadState: async () => {},
        waitForTimeout: async () => {},
        evaluate: async () => '',
        locator: sel => ({ count: async () => (/captcha/i.test(sel) ? 1 : 0) }),
        getByLabel: () => ({ filter: () => ({ count: async () => 0 }) }),
        close: async () => { page.closed = true; pages.splice(pages.indexOf(page), 1); page.emit('close') },
      })
      pages.push(page)
      return page
    }
    Object.assign(context, {
      headless: options.headless, closed: false,
      pages: () => [...pages],
      newPage,
      close: async () => { context.closed = true; for (const p of [...pages]) await p.close(); context.emit('close') },
    })
    contexts.push(context)
    return context
  })
  return { launches, contexts }
}

const job = (id, extra = {}) => ({ id, title: 'Engineer', company: 'Acme', ats: 'other', url: '', applyUrl: `https://93.184.216.34/jobs/${id}`, coverLetter: '', ...extra })

test('without a display a visible-browser request runs in the background and keeps the window for account help', async t => {
  setEnv({ DISPLAY: undefined, WAYLAND_DISPLAY: undefined, JOB_HUNTER_HEADLESS: undefined, JOB_HUNTER_BROWSER: '/fake/chrome' })
  const { launches, contexts } = fakeBrowser(t)
  const username = 'server-user'
  const profile = await store.getProfile(username)
  const first = await apply.applyToJob(job('a'), profile, username, { headless: false, allowSubmit: false })
  assert.equal(launches.length, 1)
  assert.equal(launches[0].headless, true, 'no X11/Wayland display: never launch a visible browser')
  assert.equal(first.status, 'needs_user')
  assert.match(first.message, /captcha/)
  assert.match(first.message, /background browser/)
  assert.doesNotMatch(first.message, /Allow control of this computer/, 'no display: turning on computer control would not help')
  assert.equal(contexts[0].closed, false, 'kept open so account assistance and the preview can use it')
  assert.ok(live.applicationPage(username, 'a'), 'the live page is available for account assistance')
  assert.equal(live.applicationPhase(first.message, 'needs_user'), 'captcha')

  const second = await apply.applyToJob(job('b'), profile, username, { headless: true, allowSubmit: false })
  assert.equal(second.status, 'needs_user')
  assert.equal(launches.length, 1, 'later runs share the kept background window')

  // Once a display exists, a visible run replaces the background window (it can't be shown).
  setEnv({ DISPLAY: ':99' })
  const third = await apply.applyToJob(job('c'), profile, username, { headless: false, allowSubmit: false })
  assert.equal(contexts[0].closed, true)
  assert.equal(launches.length, 2)
  assert.equal(launches[1].headless, false)
  assert.doesNotMatch(third.message, /background browser/)
  await contexts[1].close()
})

test('a kept background window closes by itself after a while', async t => {
  setEnv({ DISPLAY: ':99', JOB_HUNTER_HEADLESS: undefined, JOB_HUNTER_BROWSER: '/fake/chrome' })
  const { launches, contexts } = fakeBrowser(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const username = 'timer-user'
  const result = await apply.applyToJob(job('t'), await store.getProfile(username), username, { headless: true, allowSubmit: false })
  assert.equal(launches[0].headless, true)
  assert.match(result.message, /turn on "Allow control of this computer"/, 'with a display, a visible window is one switch away')
  assert.equal(contexts[0].closed, false)
  t.mock.timers.tick(apply.BACKGROUND_WINDOW_MS - 1000)
  assert.equal(contexts[0].closed, false)
  t.mock.timers.tick(2000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(contexts[0].closed, true)
  t.mock.timers.reset()
})

test('a visible launch without an X server reports the missing display, not a missing browser', async t => {
  setEnv({ JOB_HUNTER_BROWSER: '/fake/chrome' })
  let launches = 0
  t.mock.method(chromium, 'launchPersistentContext', async () => {
    launches++
    throw new Error("browserType.launchPersistentContext: Target page, context or browser has been closed\n╔══\n║ Looks like you launched a headed browser without having a XServer running.")
  })
  await assert.rejects(apply.launchProfile('no-x', false), /no screen for a visible browser.*Allow control of this computer/)
  assert.equal(launches, 1)
})

test('connecting LinkedIn without a display says why instead of pretending a window opened', async t => {
  setEnv({ DISPLAY: undefined, WAYLAND_DISPLAY: undefined, JOB_HUNTER_BROWSER: '/fake/chrome' })
  const launches = []
  t.mock.method(chromium, 'launchPersistentContext', async (_dir, options) => { launches.push(options.headless); throw new Error('no browser in this test') })
  const intake = require('../lib/job-hunter/intake.ts')
  await assert.rejects(intake.connectLinkedIn('li-user'), /needs a visible browser.*no screen/)
  assert.ok(launches.every(headless => headless === true), 'no visible launch was attempted')
})
