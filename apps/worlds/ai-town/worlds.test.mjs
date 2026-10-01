import test from 'node:test'
import assert from 'node:assert/strict'
import { gatewaySettings, hardenComposeText, normalizeGatewayUrl, parseWorldArgs } from '../../../scripts/worlds.mjs'

const compose = `services:
  frontend:
    ports:
      - '5173:5173'
  backend:
    ports:
      - '\${PORT:-3210}:3210'
      - '\${SITE_PROXY_PORT:-3211}:3211'
      - '\${OLLAMA_PORT:-11434}:11434'
    healthcheck:
      test: curl -f http://localhost:3210/version
  dashboard:
    ports:
      - '\${DASHBOARD_PORT:-6791}:6791'
`

test('AI Town Compose only publishes loopback ports and does not reserve Ollama’s port', () => {
  const result = hardenComposeText(compose)
  assert.match(result, /127\.0\.0\.1:5173:5173/)
  assert.match(result, /127\.0\.0\.1:\$\{PORT:-3210\}:3210/)
  assert.match(result, /127\.0\.0\.1:\$\{SITE_PROXY_PORT:-3211\}:3211/)
  assert.match(result, /127\.0\.0\.1:\$\{DASHBOARD_PORT:-6791\}:6791/)
  assert.doesNotMatch(result, /OLLAMA_PORT|11434:11434/)
  assert.match(result, /host\.docker\.internal:host-gateway/)
  assert.equal(hardenComposeText(result), result)
})

test('Compose hardening rejects unexpected upstream templates', () => {
  assert.throws(() => hardenComposeText('services: {}'), /expected upstream Compose port mapping/)
})

test('gateway URLs are normalized for AI Town OpenAI-compatible requests', () => {
  assert.equal(normalizeGatewayUrl('http://127.0.0.1:20128/v1/'), 'http://host.docker.internal:20128')
  assert.equal(normalizeGatewayUrl('https://gateway.example/v1'), 'https://gateway.example')
  assert.throws(() => normalizeGatewayUrl('file:///tmp/model'), /http\(s\)/)
})

test('GhostForge gateway environment maps to the upstream custom LLM settings', () => {
  assert.deepEqual(gatewaySettings({
    OMNIROUTE_URL: 'http://127.0.0.1:20128/v1',
    OMNIROUTE_MODEL: 'auto',
    GF_AI_TOWN_LLM_EMBEDDING_MODEL: 'embedding-1024',
    OMNIROUTE_API_KEY: 'test-only-key',
  }), {
    url: 'http://host.docker.internal:20128',
    model: 'auto',
    embeddingModel: 'embedding-1024',
    apiKey: 'test-only-key',
  })
  assert.throws(() => gatewaySettings({
    GF_AI_TOWN_LLM_API_URL: 'https://gateway.example/v1',
  }), /GF_AI_TOWN_LLM_MODEL/)
})

test('world commands accept only supported lifecycle actions and ai-town', () => {
  assert.deepEqual(parseWorldArgs(['start', 'ai-town']), { action: 'start', world: 'ai-town' })
  assert.deepEqual(parseWorldArgs(['status', 'ai-town']), { action: 'status', world: 'ai-town' })
  assert.throws(() => parseWorldArgs(['kill', 'ai-town']), /start, stop, or status/)
  assert.throws(() => parseWorldArgs(['stop', 'other']), /Only the ai-town world/)
})
