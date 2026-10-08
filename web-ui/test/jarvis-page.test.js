// Renders the JARVIS page (app/jarvis/page.tsx and its _components) in jsdom
// with mocked APIs, opens each panel, and checks that the pieces render and
// that axe finds nothing beyond the page-level landmark rules (the app layout
// supplies those, and the harness renders the page without it).
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

// lib/quick-actions has a .js twin for the TUI; the page imports the .ts one.
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (/lib[\\/]quick-actions$/.test(request)) request += '.ts'
  return resolve.call(this, request, ...rest)
}

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
    Object.defineProperty(w.navigator, 'clipboard', { value: { readText: async () => '', writeText: async () => {} }, configurable: true })
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
