import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLocalModel } from '../lib/gfai-client.js';

test('selectLocalModel honors an installed Ollama selection', () => {
  const installed = ['llama3.2:3b', 'qwen3.5:9b'];
  assert.equal(selectLocalModel(installed, 'ollama', 'qwen3.5:9b'), 'qwen3.5:9b');
});

test('selectLocalModel falls back to a preferred installed model', () => {
  const installed = ['llama3.2:3b', 'qwen3.5:4b'];
  assert.equal(selectLocalModel(installed, 'google', 'gemini-2.0-flash'), 'qwen3.5:4b');
  assert.equal(selectLocalModel([], '', ''), null);
});
