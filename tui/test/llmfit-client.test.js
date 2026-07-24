import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLLMFitCLI } from '../lib/llmfit-client.js';

test('normalizes the current llmfit recommend JSON format', () => {
  const result = normalizeLLMFitCLI({
    models: [{
      name: 'Qwen/Qwen3.5-9B',
      ollama_name: 'qwen3.5:9b',
      params_b: 9.7,
      memory_required_gb: 8.2,
      score: 93.6,
      fit_level: 'Perfect',
      installed: true,
      runtime: 'llamacpp',
    }],
  }, { ramGB: 24, availableGB: 20, cpuBrand: 'Apple M4 Pro' });

  assert.equal(result.recommendation.best, 'qwen3.5:9b');
  assert.equal(result.recommendation.bestInstalled, 'qwen3.5:9b');
  assert.equal(result.models[0].compositeScore, 94);
});

test('handles malformed llmfit output without crashing', () => {
  const result = normalizeLLMFitCLI({}, { ramGB: 24 });
  assert.deepEqual(result.models, []);
  assert.equal(result.recommendation.best, null);
});

test('uses llmfit system hardware and keeps pull commands valid', () => {
  const result = normalizeLLMFitCLI({
    system: { cpu_name: 'Apple M4 Pro', total_ram_gb: 24, available_ram_gb: 20.5 },
    models: [{
      name: 'Qwen 3.5 9B',
      ollama_name: 'qwen3.5:9b',
      memory_required_gb: 8.2,
      score: 91,
      fit_level: 'Perfect',
      installed: false,
    }],
  });

  assert.equal(result.hardware.availableGB, 20.5);
  assert.equal(result.recommendation.pullFirst, 'qwen3.5:9b');
});

test('uses unified-memory capacity instead of temporary free RAM', () => {
  const result = normalizeLLMFitCLI({
    system: { total_ram_gb: 24, available_ram_gb: 6, unified_memory: true },
    models: [{ name: 'Local model', memory_required_gb: 14, score: 90, fit_level: 'Perfect' }],
  });

  assert.equal(result.hardware.availableGB, 20);
  assert.equal(result.models[0].canRun, true);
});
