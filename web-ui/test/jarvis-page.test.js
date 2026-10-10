// Renders the JARVIS page (app/jarvis/page.tsx and its _components) in jsdom
// with mocked APIs, opens each panel, and checks that the pieces render and
// that axe finds nothing beyond the page-level landmark rules (the app layout
// supplies those, and the harness renders the page without it).
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

// lib/quick-actions has a .js twin for the TUI; the page imports the .ts one.
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (/lib[\\/]quick-actions$/.test(request)) request += '.ts'
  return resolve.call(this, request, ...rest)
}

let clipboardText = ''

// Browser APIs the page touches that jsdom lacks. The harness destructures
// JSDOM when it loads, so patch it first.
const jsdom = require('jsdom')
const BaseJSDOM = jsdom.JSDOM
jsdom.JSDOM = class extends BaseJSDOM {
  constructor(...args) {
    super(...args)
    const w = this.window
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
    w.HTMLElement.prototype.scrollIntoView = function () {}
    Object.defineProperty(w.navigator, 'clipboard', { value: { readText: async () => clipboardText, writeText: async () => {} }, configurable: true })
    globalThis.localStorage = w.localStorage
    globalThis.location = w.location
    globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
    // Skip the once-a-day morning briefing so the render is deterministic.
    w.localStorage.setItem('gf_morning_date', new Date().toISOString().slice(0, 10))
  }
}

const { renderPage, formatViolations } = require('./a11y-harness.js')

const ROUTES = {
  '/api/auth/me': { user: { name: 'Ada', username: 'ada', role: 'admin' } },
  '/api/jarvis/models': {
    models: [
      { provider: 'ollama', id: 'llama3', label: 'Llama 3', free: true, available: true },
      { provider: 'openai', id: 'gpt', label: 'GPT', free: false, available: true },
    ],
    active: { provider: 'ollama', model: 'llama3' },
    integrations: { github: true },
    host: { platform: 'linux', macControl: false, screenCapture: true, browserControl: true, shell: true, remoteClientControl: true, freeLocalAI: true },
    tts: { engine: 'browser', fishAudio: false, elevenLabs: true, jarvisVoice: false, jarvisModelId: '' },
  },
  '/api/jarvis/memory': { userName: 'Ada', preferences: { city: 'X', music: 'y' }, facts: [], conversationCount: 3 },
  '/api/jarvis/inbox': { messages: [], unread: 0 },
  '/api/dashboard': { system: { cpu: 10, ram: { pct: 20, usedGB: 2, totalGB: 8 }, disk: { pct: 30, usedGB: 3, totalGB: 10 }, battery: { pct: null } } },
  '/api/jarvis/audit': { entries: [{ ts: '2026-01-01T00:00:00Z', level: 'info', event: 'tool_run', tool: 'get_time', risk: 10 }] },
  '/api/openjarvis': { installed: false, binary: null },
  '/api/mark-liv-tools': { online: false, tools: [] },
}

// Rules about the page shell (main landmark, h1) that the root layout owns.
const LAYOUT_RULES = new Set(['landmark-one-main', 'page-has-heading-one', 'region'])

test('JARVIS page renders its HUD, chat and every panel', async () => {
  const page = await renderPage('jarvis/page.tsx', ROUTES)
  const text = () => page.document.getElementById('root').textContent
  const open = async label => {
    await page.click(el => el.textContent.includes(label))
    for (let i = 0; i < 10; i++) await page.settle()
  }
  try {
    for (const marker of ['G.F.A.I. — idle', 'SYSTEMS', 'QUICK COMMANDS', 'LIVE METRICS', 'Welcome back, Ada.', 'ADA']) {
      assert.ok(text().includes(marker), `missing "${marker}" on first render`)
    }
    assert.ok(page.document.querySelector('svg text')?.textContent.includes('G.F.A.I'), 'orb did not render')

    await open('SETTINGS')
    for (const marker of ['AI MODEL', 'Llama 3', 'PERSONA', 'VOICE ENGINE', 'INTEGRATIONS', 'N8N WORKFLOWS', 'VOICE BIOMETRICS']) {
      assert.ok(text().includes(marker), `settings panel is missing "${marker}"`)
    }

    await open('AUDIT')
    assert.ok(text().includes('AUDIT LOG — LAST 30 EVENTS'), 'audit panel did not open')
    assert.ok(text().includes('tool_run'), 'audit entries did not load')

    await open('MARK-L')
    assert.ok(text().includes('MARK-LIV ENGINE'), 'Mark-L panel did not open')

    await open('OPEN DASHBOARD')
    assert.ok(text().includes('AUTONOMOUS AGENT'), 'agent dashboard did not open')

    const violations = (await page.violations()).filter(v => !LAYOUT_RULES.has(v.id))
    assert.equal(violations.length, 0, formatViolations(violations))
  } finally {
    await page.unmount()
  }
})

test('toasts, inbox messages and clipboard actions still reach the page', async () => {
  const sent = []
  const routes = {
    ...ROUTES,
    '/api/jarvis/inbox': (url, init) => (init?.method === 'POST' ? {} : { messages: [{ id: 'm1', from: 'sam', text: 'build is green', ts: '' }], unread: 1 }),
    '/api/jarvis': (url, init) => { sent.push(JSON.parse(init.body).message); return {} },
  }
  clipboardText = ''
  const page = await renderPage('jarvis/page.tsx', routes)
  const text = () => page.document.getElementById('root').textContent
  try {
    // Inbox poll: one toast and one chat message for the new message.
    assert.ok(text().includes('📨 Message from sam: build is green'), 'inbox toast missing')
    assert.ok(text().includes('📨 New message from sam: build is green'), 'inbox chat message missing')

    // Toasts render from their own store and can be dismissed.
    await page.click(el => el.textContent.trim() === '🤖 COPILOT')
    assert.ok(text().includes('Copilot CLI mode ON'), 'toast did not appear')
    const dismissButtons = () => [...page.document.querySelectorAll('button[aria-label="Dismiss notification"]')]
    const before = dismissButtons().length
    await page.click(el => el === dismissButtons().at(-1))
    assert.equal(dismissButtons().length, before - 1, 'toast was not dismissed')
    await page.click(el => el.textContent.includes('EXIT'))

    // Clipboard watcher: new text (15+ chars) shows the panel; EXPLAIN sends it to JARVIS.
    clipboardText = 'const answer = computeTheThing()'
    await new Promise(resolve => setTimeout(resolve, 3200))
    for (let i = 0; i < 5; i++) await page.settle()
    assert.ok(text().includes('CLIPBOARD INTELLIGENCE'), 'clipboard panel did not open')
    await page.click(el => el.textContent.includes('EXPLAIN'))
    assert.deepEqual(sent, ['Explain this: const answer = computeTheThing()'])
    assert.ok(!text().includes('CLIPBOARD INTELLIGENCE'), 'clipboard panel did not close')
  } finally {
    await page.unmount()
  }
})

test('a message sent right after toggling offline mode carries the new setting', async () => {
  // Regression: sendToJarvis left offlineMode out of its useCallback deps, so
  // the first message after the toggle still sent the old value.
  const bodies = []
  const routes = { ...ROUTES, '/api/jarvis': (url, init) => { bodies.push(JSON.parse(init.body)); return {} } }
  const page = await renderPage('jarvis/page.tsx', routes)
  const { window, document } = page
  const React = require('react')
  try {
    await page.click(el => el.textContent.includes('SETTINGS'))
    await page.click(el => el.getAttribute('aria-label') === 'Toggle offline mode')
    const input = document.querySelector('form input[type="text"]')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'what time is it')
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await React.act(async () => {
      input.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    })
    for (let i = 0; i < 5; i++) await page.settle()
    assert.equal(bodies.length, 1)
    assert.equal(bodies[0].message, 'what time is it')
    assert.equal(bodies[0].offlineMode, true)
  } finally {
    await page.unmount()
  }
})

test('app/jarvis/page.tsx is a thin server shell over the client app', () => {
  const shell = readFileSync(join(__dirname, '..', 'app', 'jarvis', 'page.tsx'), 'utf8')
  assert.doesNotMatch(shell, /^['"]use client['"]/m, 'the route file should stay a server component')
  assert.match(shell, /import JarvisApp from '\.\/_components\/JarvisApp'/)
  assert.ok(shell.split('\n').length < 20, 'the route file should only compose client components')
})

test('voice enrollment, screen-capture overlay and on-demand panels load with next/dynamic', () => {
  const read = file => readFileSync(join(__dirname, '..', 'app', 'jarvis', '_components', file), 'utf8')
  const app = read('JarvisApp.tsx')
  for (const mod of ['./SettingsPanel', './AuditPanel', './MarkLOverlay', './AgentOverlay', '@/components/ClickyOverlay']) {
    assert.match(app, new RegExp(`dynamic\\(\\(\\) => import\\('${mod.replace(/[./]/g, '\\$&')}'\\)`), `${mod} should be loaded with next/dynamic`)
    assert.doesNotMatch(app, new RegExp(`^import \\w+ from '${mod.replace(/[./]/g, '\\$&')}'`, 'm'), `${mod} should not be a static import`)
  }
  assert.match(read('SettingsPanel.tsx'), /dynamic\(\(\) => import\('\.\/VoiceEnrollPanel'\)/)
  assert.match(read('ClipboardWatcher.tsx'), /dynamic\(\(\) => import\('\.\/ClipboardPanel'\)/)
})
