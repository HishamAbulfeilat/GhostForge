const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildLocalRuntimeOrder,
  chooseBestInstalledModel,
} = require('../lib/local-runtime')

test('selects the balanced tool-capable model on a 24GB Mac', () => {
  const recommendation = chooseBestInstalledModel(
    ['qwen3.5:27b', 'qwen3.5:9b', 'qwen3.5:4b'],
    24,
    'tools',
  )

  assert.equal(recommendation.name, 'qwen3.5:9b')
  assert.equal(recommendation.profile.label, 'balanced')
})

test('respects an installed Ollama selection before automatic fallback', () => {
  const order = buildLocalRuntimeOrder({
    selectedProvider: 'ollama',
    selectedModel: 'qwen2.5-coder:7b',
    ollamaModels: ['qwen3.5:9b', 'qwen2.5-coder:7b'],
    ramGB: 24,
    llamaCppModel: 'local.gguf',
  })

  assert.deepEqual(order, [
    { provider: 'ollama', model: 'qwen2.5-coder:7b' },
    { provider: 'ollama', model: 'qwen3.5:9b' },
    { provider: 'llamacpp', model: 'local.gguf' },
  ])
})

test('falls back to llama.cpp when Ollama has no installed model', () => {
  const order = buildLocalRuntimeOrder({
    ollamaModels: [],
    ramGB: 24,
    llamaCppModel: 'qwen-local.gguf',
  })

  assert.deepEqual(order, [{ provider: 'llamacpp', model: 'qwen-local.gguf' }])
})
