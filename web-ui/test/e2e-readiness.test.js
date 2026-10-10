const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const WEB_UI = join(__dirname, '..')
const read = relative => readFileSync(join(WEB_UI, relative), 'utf8')

const flows = [
  {
    name: 'JARVIS voice/chat',
    page: 'app/jarvis/page.tsx',
    // The page is a thin shell; the client pieces live next to it.
    components: 'app/jarvis/_components',
    endpoints: ['app/api/jarvis/route.ts', 'app/api/jarvis/models/route.ts', 'app/api/openjarvis/route.ts'],
    markers: ['fetch(\'/api/jarvis', 'OpenJarvisPanel', 'AgentDashboard'],
  },
  {
    name: 'marketplace install state',
    page: 'app/marketplace/page.tsx',
    endpoints: ['app/api/marketplace/route.ts'],
    markers: ['fetch(\'/api/marketplace', 'method: \'POST\'', 'setInstalled'],
  },
  {
    name: 'multi-agent orchestration',
    page: 'app/orchestrate/page.tsx',
    endpoints: ['app/api/jarvis/orchestrate/route.ts'],
    markers: ['OrchestratePanel'],
  },
]

test('key web flows have a page, API route, and client wiring', () => {
  for (const flow of flows) {
    assert.ok(existsSync(join(WEB_UI, flow.page)), `${flow.name}: page is missing`)
    let page = read(flow.page)
    if (flow.components) {
      for (const file of readdirSync(join(WEB_UI, flow.components))) page += read(join(flow.components, file))
    }
    for (const marker of flow.markers) {
      assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${flow.name}: missing ${marker}`)
    }
    for (const endpoint of flow.endpoints) {
      assert.ok(existsSync(join(WEB_UI, endpoint)), `${flow.name}: ${endpoint} is missing`)
    }
  }
})

test('protected flow routes expose authorization checks and expected methods', () => {
  const checks = [
    ['app/api/jarvis/route.ts', ['POST']],
    ['app/api/marketplace/route.ts', ['GET', 'POST']],
    ['app/api/jarvis/orchestrate/route.ts', ['POST']],
    ['app/api/openjarvis/route.ts', ['GET', 'POST']],
  ]
  for (const [file, methods] of checks) {
    const source = read(file)
    assert.match(source, /isAuthorizedRequest\(req\)/, `${file}: missing authorization check`)
    for (const method of methods) {
      assert.match(source, new RegExp(`export async function ${method}\\(req`), `${file}: missing ${method} handler`)
    }
  }
})

test('orchestration rejects empty tasks before spawning JARVIS work', () => {
  const source = read('app/api/jarvis/orchestrate/route.ts')
  assert.match(source, /typeof task !== 'string' \|\| !task\.trim\(\)/)
  assert.match(source, /error: 'task is required'/)
  assert.match(source, /status: 400/)
})

test('mobile and RTL guards remain part of the web test surface', () => {
  const responsive = read('test/responsive-rtl.test.js')
  assert.match(responsive, /physical-direction Tailwind/)
  assert.match(responsive, /device-width/)
  assert.match(responsive, /default responsive breakpoints/)
})
