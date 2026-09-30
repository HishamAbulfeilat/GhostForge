import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import { resolveProjectPath } from '../tools/health.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('resolveProjectPath accepts paths inside the allowed workspace root', () => {
  assert.equal(resolveProjectPath('.', repoRoot), repoRoot);
  assert.equal(resolveProjectPath('mcp', repoRoot), path.join(repoRoot, 'mcp'));
});

test('resolveProjectPath rejects traversal outside the allowed workspace root', () => {
  assert.throws(() => resolveProjectPath('../', repoRoot), /escapes the allowed workspace root/);
  assert.throws(() => resolveProjectPath('../../../../etc', repoRoot), /escapes the allowed workspace root/);
  assert.throws(() => resolveProjectPath('/tmp', repoRoot), /escapes the allowed workspace root/);
});
