import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readModelCache, selectBestModel } from '../tools/models.js';

test('readModelCache falls back to bundled models in a fresh checkout', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ghostforge-mcp-'));

  try {
    const cache = readModelCache(repoRoot);

    assert.equal(cache.syncedAt, null);
    assert.ok(Array.isArray(cache.models));
    assert.ok(cache.models.length > 0);
    assert.ok(cache.models.some(model => model.id === 'claude-opus-4.8'));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('bundled models provide a recommendation when no cache exists', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ghostforge-mcp-'));

  try {
    const { models } = readModelCache(repoRoot);
    const recommendation = selectBestModel(models, 'security');

    assert.equal(recommendation.effort, 'high');
    assert.equal(recommendation.model.id, 'claude-opus-4.8');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
