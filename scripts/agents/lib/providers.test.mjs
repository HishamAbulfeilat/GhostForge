import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandFor, PROVIDERS } from './providers.mjs'

test('all provider adapters return a runnable command', () => {
  for (const provider of Object.keys(PROVIDERS)) {
    const result = commandFor(provider, { prompt: 'work', model: 'auto', mode: 'work' })
    assert.equal(typeof result.cmd, 'string', provider)
    assert.ok(Array.isArray(result.args), provider)
    assert.ok(result.args.includes('work'), provider)
  }
})

test('OpenAI-compatible adapter keeps auto routing and maps configured endpoint/key', () => {
  const previousBase = process.env.OPENAI_BASE_URL
  const previousKey = process.env.GATEWAY_TOKEN
  process.env.OPENAI_BASE_URL = 'https://gateway.example/v1'
  process.env.GATEWAY_TOKEN = 'test-secret'

  try {
    const result = commandFor('openai-compatible', {
      prompt: 'edit files',
      model: 'auto',
      mode: 'work',
      config: { apiKeyEnv: 'GATEWAY_TOKEN' },
    })
    assert.equal(result.cmd, 'codex')
    assert.deepEqual(result.args, ['exec', '--full-auto', 'edit files'])
    assert.deepEqual(result.env, {
      OPENAI_BASE_URL: 'https://gateway.example/v1',
      OPENAI_API_KEY: 'test-secret',
    })
    assert.ok(!result.args.includes('test-secret'))
  } finally {
    if (previousBase === undefined) delete process.env.OPENAI_BASE_URL
    else process.env.OPENAI_BASE_URL = previousBase
    if (previousKey === undefined) delete process.env.GATEWAY_TOKEN
    else process.env.GATEWAY_TOKEN = previousKey
  }
})

test('OpenAI-compatible adapter accepts endpoint and explicit model without logging key', () => {
  const previousKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'do-not-log'

  try {
    const result = commandFor('openai', {
      prompt: 'review files',
      model: 'gateway-model',
      mode: 'readonly',
      config: { endpoint: 'http://localhost:9000/v1' },
    })
    assert.deepEqual(result.args, ['exec', '-m', 'gateway-model', '-s', 'read-only', 'review files'])
    assert.equal(result.env.OPENAI_BASE_URL, 'http://localhost:9000/v1')
    assert.equal(result.env.OPENAI_API_KEY, 'do-not-log')
    assert.ok(!JSON.stringify(result.args).includes('do-not-log'))
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previousKey
  }
})

test('OpenRouter uses its free DeepSeek fallback model and keeps its key out of argv', () => {
  const previousKey = process.env.OPENROUTER_API_KEY
  const previousBase = process.env.OPENROUTER_BASE_URL
  process.env.OPENROUTER_API_KEY = 'openrouter-secret'
  delete process.env.OPENROUTER_BASE_URL

  try {
    const result = commandFor('openrouter', { prompt: 'review', model: 'auto', mode: 'readonly' })
    assert.equal(result.cmd, 'codex')
    assert.deepEqual(result.args, ['exec', '-m', 'deepseek/deepseek-r1:free', '-s', 'read-only', 'review'])
    assert.equal(result.env.OPENAI_BASE_URL, 'https://openrouter.ai/api/v1')
    assert.equal(result.env.OPENAI_API_KEY, 'openrouter-secret')
    assert.ok(!JSON.stringify(result.args).includes('openrouter-secret'))
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previousKey
    if (previousBase === undefined) delete process.env.OPENROUTER_BASE_URL
    else process.env.OPENROUTER_BASE_URL = previousBase
  }
})

test('OmniRoute defaults to loopback, uses auto routing, and does not inherit unrelated keys', () => {
  const previousKey = process.env.OMNIROUTE_API_KEY
  const previousBase = process.env.OMNIROUTE_URL
  const previousOpenAIKey = process.env.OPENAI_API_KEY
  delete process.env.OMNIROUTE_API_KEY
  delete process.env.OMNIROUTE_URL
  process.env.OPENAI_API_KEY = 'unrelated-openai-secret'

  try {
    const result = commandFor('omniroute', { prompt: 'work', model: 'auto', mode: 'work' })
    assert.deepEqual(result.args, ['exec', '-m', 'auto', '--full-auto', 'work'])
    assert.equal(result.env.OPENAI_BASE_URL, 'http://127.0.0.1:20128/v1')
    assert.equal(result.env.OPENAI_API_KEY, '')
    assert.ok(!JSON.stringify(result).includes('unrelated-openai-secret'))
  } finally {
    if (previousKey === undefined) delete process.env.OMNIROUTE_API_KEY
    else process.env.OMNIROUTE_API_KEY = previousKey
    if (previousBase === undefined) delete process.env.OMNIROUTE_URL
    else process.env.OMNIROUTE_URL = previousBase
    if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previousOpenAIKey
  }
})

test('gateway adapters allow an explicit model and configured endpoint', () => {
  const previousKey = process.env.OMNIROUTE_API_KEY
  process.env.OMNIROUTE_API_KEY = 'gateway-secret'

  try {
    const result = commandFor('omniroute', {
      prompt: 'work',
      model: 'custom-model',
      mode: 'work',
      config: { endpoint: 'http://127.0.0.1:9090', apiKeyEnv: 'OMNIROUTE_API_KEY' },
    })
    assert.deepEqual(result.args, ['exec', '-m', 'custom-model', '--full-auto', 'work'])
    assert.equal(result.env.OPENAI_BASE_URL, 'http://127.0.0.1:9090/v1')
    assert.equal(result.env.OPENAI_API_KEY, 'gateway-secret')
    assert.ok(!JSON.stringify(result.args).includes('gateway-secret'))
  } finally {
    if (previousKey === undefined) delete process.env.OMNIROUTE_API_KEY
    else process.env.OMNIROUTE_API_KEY = previousKey
  }
})
