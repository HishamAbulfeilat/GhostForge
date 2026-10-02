const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { bridgeReadiness, modelReadiness } = require('../app/setup/readiness.js')

const page = readFileSync(join(__dirname, '..', 'app/setup/page.tsx'), 'utf8')

test('bridge: connected is configured and needs no action', () => {
  const r = bridgeReadiness({ status: 'connected', url: 'http://127.0.0.1:8765', tokenConfigured: true })
  assert.equal(r.state, 'configured')
})

test('bridge: unconfigured is missing with a next action', () => {
  const r = bridgeReadiness({ status: 'unconfigured' })
  assert.equal(r.state, 'missing')
  assert.match(r.action, /Start the bridge/)
})

test('bridge: disconnected and failed fetches are unreachable', () => {
  assert.equal(bridgeReadiness({ status: 'disconnected' }).state, 'unreachable')
  assert.equal(bridgeReadiness(null).state, 'unreachable')
  assert.equal(bridgeReadiness({}).state, 'unreachable')
})

test('bridge: output never carries the url, token flag or host details', () => {
  const r = bridgeReadiness({ status: 'connected', url: 'http://10.0.0.5:8765', tokenConfigured: true, device: { hostname: 'secret-host' } })
  assert.doesNotMatch(JSON.stringify(r), /10\.0\.0\.5|secret-host/)
})

test('models: a provider with a key is configured', () => {
  const r = modelReadiness({ providers: [{ id: 'groq', name: 'Groq', available: true, error: null }, { id: 'openai', name: 'OpenAI', available: false }], ollama: { running: false } })
  assert.equal(r.state, 'configured')
  assert.deepEqual(r.providers, ['Groq'])
})

test('models: a running local Ollama alone is configured', () => {
  const r = modelReadiness({ providers: [{ id: 'groq', name: 'Groq', available: false }], ollama: { running: true } })
  assert.equal(r.state, 'configured')
})

test('models: no key and no local runtime is missing', () => {
  const r = modelReadiness({ providers: [{ id: 'groq', name: 'Groq', available: false }], ollama: { running: false } })
  assert.equal(r.state, 'missing')
  assert.match(r.action, /Settings/)
})

test('models: keys present but every provider erroring is unreachable', () => {
  const r = modelReadiness({ providers: [{ id: 'groq', name: 'Groq', available: true, error: 'HTTP 503' }], ollama: { running: false } })
  assert.equal(r.state, 'unreachable')
})

test('models: failed or malformed response is unreachable', () => {
  assert.equal(modelReadiness(null).state, 'unreachable')
  assert.equal(modelReadiness({}).state, 'unreachable')
})

test('models: output never exposes key env names or key values', () => {
  const r = modelReadiness({ providers: [{ id: 'groq', name: 'Groq', available: true, keyEnv: 'GROQ_API_KEY', keySource: 'env', apiKey: 'sk-live-123' }] })
  assert.doesNotMatch(JSON.stringify(r), /GROQ_API_KEY|sk-live-123/)
})

test('setup page renders readiness only for admins, from the existing endpoints', () => {
  assert.match(page, /state\.isAdmin && <ReadinessSection \/>/)
  assert.match(page, /fetchJson\('\/api\/bridge-status'\)/)
  assert.match(page, /fetchJson\('\/api\/models'\)/)
})
