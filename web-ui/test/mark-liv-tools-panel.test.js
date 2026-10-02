const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const webUi = path.join(__dirname, '..')
const read = (...p) => fs.readFileSync(path.join(webUi, ...p), 'utf8')

const panel = read('components', 'MarkLivToolsPanel.tsx')
const route = read('app', 'api', 'mark-liv-tools', 'route.ts')
const page = read('app', 'jarvis', 'page.tsx')

// Transpile the pure validator (and the risk table it imports) so it can be exercised directly.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-markliv-tools-'))
for (const file of ['lib/mark-liv-risk.ts', 'lib/mark-liv-tools-request.ts', 'lib/mark-liv-tool-params.ts']) {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const dest = path.join(out, file.replace(/\.ts$/, '.js'))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, outputText)
}
const { parseMarkLivToolsRequest: parse } = require(path.join(out, 'lib/mark-liv-tools-request.js'))
const { coerceParam, paramWidget, normalizeParamType } = require(path.join(out, 'lib/mark-liv-tool-params.js'))
test.after(() => fs.rmSync(out, { recursive: true, force: true }))

test('weather, flight and reminder map to the fixed bridge endpoints with their permissions', () => {
  const weather = parse({ kind: 'weather', city: '  Riyadh ' })
  assert.deepEqual(weather.request, { kind: 'weather', endpoint: '/api/mark-l/weather', permission: 'weather', payload: { city: 'Riyadh' } })

  const flight = parse({ kind: 'flight', from_city: 'RUH', to_city: 'DXB', date: '2026-11-01', passengers: 2, cabin: 'business' })
  assert.equal(flight.request.endpoint, '/api/mark-l/flight-finder')
  assert.equal(flight.request.permission, 'web_search')
  assert.deepEqual(flight.request.payload, { from_city: 'RUH', to_city: 'DXB', date: '2026-11-01', return_date: '', passengers: 2, cabin: 'business' })

  const reminder = parse({ kind: 'reminder', date: '2026-11-01', time: '09:30', message: 'stand-up' })
  assert.deepEqual(reminder.request, {
    kind: 'reminder', endpoint: '/api/mark-l/reminder', permission: 'reminders',
    payload: { date: '2026-11-01', time: '09:30', message: 'stand-up' },
  })
})

test('invalid input is rejected before anything reaches the bridge', () => {
  for (const body of [
    null, [], 'x', {}, { kind: 'shell' },
    { kind: 'weather' }, { kind: 'weather', city: 'x'.repeat(101) }, { kind: 'weather', city: 42 },
    { kind: 'flight', from_city: 'RUH' },
    { kind: 'flight', from_city: 'RUH', to_city: 'DXB', date: 'tomorrow' },
    { kind: 'flight', from_city: 'RUH', to_city: 'DXB', passengers: 0 },
    { kind: 'flight', from_city: 'RUH', to_city: 'DXB', passengers: 1.5 },
    { kind: 'flight', from_city: 'RUH', to_city: 'DXB', cabin: 'cargo' },
    { kind: 'reminder', date: '2026-11-01', time: '25:00', message: 'x' },
    { kind: 'reminder', date: '2026-11-01', time: '09:00' },
    { kind: 'run', name: '../etc' },
    { kind: 'run', name: 'open_app', parameters: [] },
    { kind: 'run', name: 'open_app', parameters: { blob: 'x'.repeat(9000) } },
  ]) {
    const result = parse(body)
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(body)?.slice(0, 80)}`)
    assert.equal(typeof result.error, 'string')
  }
})

test('tool runs need mac_control and risky tools need an explicit confirm', () => {
  const safe = parse({ kind: 'run', name: 'open_app', parameters: { app_name: 'notepad' } })
  assert.equal(safe.request.endpoint, '/api/mark-liv/run')
  assert.equal(safe.request.permission, 'mac_control')
  assert.deepEqual(safe.request.payload, { name: 'open_app', parameters: { app_name: 'notepad' } })
  assert.equal(safe.request.confirmReason, undefined)

  const risky = parse({ kind: 'run', name: 'file_controller', parameters: { action: 'delete', path: 'x' } })
  assert.match(risky.request.confirmReason, /delete/)
  const confirmed = parse({ kind: 'run', name: 'file_controller', parameters: { action: 'delete', path: 'x' }, confirm: true })
  assert.equal(confirmed.request.confirmReason, undefined)
  // Only a literal true confirms.
  assert.ok(parse({ kind: 'run', name: 'send_message', parameters: {}, confirm: 'yes' }).request.confirmReason)
})

test('Gemini upper-case tool schemas pick typed widgets and send typed values', () => {
  // Shape of a real Mark-LV declaration (vendor/mark-liv/actions/computer_control.py).
  const props = {
    action: { type: 'STRING', description: 'type | click | ...' },
    clear_first: { type: 'BOOLEAN', description: 'Clear field before typing (default: true)' },
    x: { type: 'INTEGER' },
    scale: { type: 'NUMBER' },
    items: { type: 'ARRAY', items: { type: 'STRING' } },
    mode: { type: 'STRING', enum: ['fast', 'slow'] },
  }
  assert.equal(normalizeParamType('BOOLEAN'), 'boolean')
  assert.equal(normalizeParamType(undefined), '')
  assert.equal(paramWidget(props.action), 'text')
  assert.equal(paramWidget(props.clear_first), 'boolean')
  assert.equal(paramWidget(props.x), 'number')
  assert.equal(paramWidget(props.scale), 'number')
  assert.equal(paramWidget(props.mode), 'enum')

  // 'false' must arrive as a real false, not a truthy string.
  assert.equal(coerceParam('false', props.clear_first.type), false)
  assert.equal(coerceParam('true', props.clear_first.type), true)
  assert.equal(coerceParam('42', props.x.type), 42)
  assert.equal(coerceParam('1.5', props.x.type), '1.5', 'a non-integer is not silently truncated')
  assert.equal(coerceParam('1.5', props.scale.type), 1.5)
  assert.deepEqual(coerceParam('a, b ,c', props.items.type), ['a', 'b', 'c'])
  assert.deepEqual(coerceParam('["a","b"]', props.items.type), ['a', 'b'])
  assert.deepEqual(coerceParam('{"k":1}', 'OBJECT'), { k: 1 })
  assert.equal(coerceParam('hello', props.action.type), 'hello')

  // Lower-case JSON Schema spellings behave the same.
  assert.equal(paramWidget({ type: 'boolean' }), 'boolean')
  assert.equal(coerceParam('false', 'boolean'), false)
  assert.equal(coerceParam('7', 'integer'), 7)
})

test('panel routes parameter types through the case-normalising helpers', () => {
  assert.match(panel, /from '@\/lib\/mark-liv-tool-params'/)
  assert.match(panel, /coerceParam\(value\.trim\(\), props\[key\]\.type\)/)
  assert.match(panel, /const widget = paramWidget\(param\)/)
  // No raw case-sensitive comparisons against schema types remain in the panel.
  assert.doesNotMatch(panel, /type === '(?:integer|number|boolean|INTEGER|NUMBER|BOOLEAN)'/)
})

test('route is authenticated, permission-gated and only talks to a validated bridge URL', () => {
  assert.equal((route.match(/if \(!isAuthorizedRequest\(req\)\)/g) || []).length, 2, 'GET and POST both check auth')
  assert.match(route, /requirePermission\(req, request\.permission\)/)
  assert.ok(route.indexOf('requirePermission(req') < route.indexOf('bridgeFetch(request.endpoint'))
  assert.ok(route.indexOf('request.confirmReason') < route.indexOf('bridgeFetch(request.endpoint'))
  assert.match(route, /status: 409/)
  assert.match(route, /const bridgeUrl = getMarkLBridgeUrl\(\)/)
  assert.match(route, /Authorization: `Bearer \$\{getLiveBridgeToken\(\)\}`/)
  assert.match(route, /'\/api\/mark-liv\/tools'/)
  assert.doesNotMatch(route, /process\.env\.MARKL_BRIDGE_URL/)
  assert.match(route, /online: false, tools: \[\]/)
})

test('panel uses only the authenticated proxy and never sees the bridge token', () => {
  assert.match(panel, /fetch\('\/api\/mark-liv-tools'/)
  assert.doesNotMatch(panel, /8765|bridge\/token|getLiveBridgeToken|Authorization/)
  assert.doesNotMatch(panel, /\/api\/mark-l\//)
})

test('panel is accessible: labelled fields, keyboard tabs, live results and offline state', () => {
  // Every input/select has a matching <label htmlFor>.
  const ids = [...panel.matchAll(/<(?:input|select) id=\{([^}]+)\}/g)].map(m => m[1])
  assert.ok(ids.length >= 10, `expected labelled fields, found ${ids.length}`)
  for (const id of ids) assert.ok(panel.includes(`htmlFor={${id}}`), `missing label for ${id}`)

  assert.match(panel, /role="tablist"/)
  assert.match(panel, /role="tab"/)
  assert.match(panel, /aria-selected=\{tab === t\.id\}/)
  assert.match(panel, /role="tabpanel"/)
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.ok(panel.includes(`'${key}'`), `handles ${key}`)
  assert.match(panel, /aria-live="polite"/)
  assert.match(panel, /BRIDGE OFFLINE/)
  assert.match(panel, /RETRY/)
  assert.match(panel, /CONFIRM/)
})

test('panel uses RTL-safe logical utilities only', () => {
  assert.doesNotMatch(panel, /\b(?:ml|mr|pl|pr)-(?:\d|px|auto|\[)|\btext-(?:left|right)\b|\b(?:left|right)-\d/)
})

test('/jarvis mounts the panel client-side', () => {
  assert.match(page, /const MarkLivToolsPanel = dynamic\(\(\) => import\('@\/components\/MarkLivToolsPanel'\), \{ ssr: false \}\)/)
  assert.match(page, /<MarkLivToolsPanel ringColor=\{mc\.ring\} \/>/)
})
