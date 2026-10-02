import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { AI_TOWN_COMMIT, AI_TOWN_REPOSITORY, gatewaySettings, hardenComposeText, normalizeGatewayUrl, parseWorldArgs } from './worlds.mjs'

const require = createRequire(import.meta.url)
const cli = require('../cli/index.js')

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

test('AI Town is pinned to the intended upstream project and commit', () => {
  assert.equal(AI_TOWN_REPOSITORY, 'https://github.com/a16z-infra/ai-town.git')
  assert.match(AI_TOWN_COMMIT, /^[0-9a-f]{40}$/)
})

test('Compose hardening binds published ports to loopback and reserves Ollama only on the host', () => {
  const result = hardenComposeText(compose)
  assert.match(result, /127\.0\.0\.1:\$\{GF_AI_TOWN_FRONTEND_PORT:-5173\}:5173/)
  assert.match(result, /127\.0\.0\.1:\$\{PORT:-3210\}:3210/)
  assert.match(result, /127\.0\.0\.1:\$\{SITE_PROXY_PORT:-3211\}:3211/)
  assert.match(result, /127\.0\.0\.1:\$\{DASHBOARD_PORT:-6791\}:6791/)
  assert.doesNotMatch(result, /OLLAMA_PORT|11434:11434/)
  assert.match(result, /host\.docker\.internal:host-gateway/)
  assert.equal(hardenComposeText(result), result)
  assert.match(
    hardenComposeText(compose.replace("      - '5173:5173'", "      - '127.0.0.1:5173:5173'")),
    /127\.0\.0\.1:\$\{GF_AI_TOWN_FRONTEND_PORT:-5173\}:5173/,
  )
})

test('Compose hardening rejects unexpected published ports or changed upstream templates', () => {
  assert.throws(() => hardenComposeText('services: {}'), /expected upstream port mapping/)
  assert.throws(() => hardenComposeText(`${hardenComposeText(compose)}\n      - '8080:8080'\n`), /not restricted to loopback/)
})

test('Gateway URL normalization supports local host-gateway routing and strips the OpenAI v1 suffix', () => {
  assert.equal(normalizeGatewayUrl('http://127.0.0.1:20128/v1/'), 'http://host.docker.internal:20128')
  assert.equal(normalizeGatewayUrl('https://gateway.example/v1'), 'https://gateway.example')
  assert.throws(() => normalizeGatewayUrl('file:///tmp/model'), /http\(s\)/)
  assert.throws(() => normalizeGatewayUrl('https://user:pass@gateway.example'), /without embedded credentials/)
  assert.throws(() => normalizeGatewayUrl('https://gateway.example/?secret=value'), /without embedded credentials/)
})

test('GhostForge gateway settings map to upstream OpenAI-compatible Convex environment names', () => {
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
  assert.throws(() => gatewaySettings({
    GF_AI_TOWN_LLM_API_URL: 'https://gateway.example/v1',
    GF_AI_TOWN_LLM_MODEL: 'chat-model',
    GF_AI_TOWN_LLM_EMBEDDING_MODEL: 'embedding\nmodel',
  }), /non-empty single-line/)
})

test('world command parsing accepts only supported world lifecycle commands', () => {
  assert.deepEqual(parseWorldArgs(['setup', 'ai-town']), { action: 'setup', world: 'ai-town', json: false })
  assert.deepEqual(parseWorldArgs(['start', 'ai-town']), { action: 'start', world: 'ai-town', json: false })
  assert.deepEqual(parseWorldArgs(['status', 'ai-town', '--json']), { action: 'status', world: 'ai-town', json: true })
  assert.throws(() => parseWorldArgs(['kill', 'ai-town']), /setup, start, stop, or status/)
  assert.throws(() => parseWorldArgs(['stop', 'other']), /Only the ai-town, agent-office, and all worlds/)
  assert.throws(() => parseWorldArgs(['start', 'ai-town', 'other']), /Only the ai-town, agent-office, and all worlds/)
  assert.throws(() => parseWorldArgs(['start', 'ai-town', '--json']), /only supported for status/)
})

test('GhostForge CLI dispatches the worlds command to the managed runtime', () => {
  assert.equal(cli.resolveCommand('worlds').script, path.join(cli.ROOT, 'scripts', 'worlds.mjs'))
  assert.match(cli.buildHelp(), /worlds\s+Set up, start, stop, and check AI Town \/ Agent Office/)
})
