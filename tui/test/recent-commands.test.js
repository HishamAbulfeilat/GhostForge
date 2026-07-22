import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readRecentCommands, rememberCommand } from '../lib/recent-commands.js';

test('rememberCommand stores five unique commands in newest-first order', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ghostforge-recent-'));
  const filePath = join(directory, 'recent.json');

  ['/one', '/two', '/three', '/four', '/five', '/six', '/three']
    .forEach(command => rememberCommand(command, filePath));

  assert.deepEqual(readRecentCommands(filePath), ['/three', '/six', '/five', '/four', '/two']);
});

test('readRecentCommands safely ignores malformed files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ghostforge-recent-'));
  const filePath = join(directory, 'recent.json');
  writeFileSync(filePath, 'not json');

  assert.deepEqual(readRecentCommands(filePath), []);
  assert.equal(readFileSync(filePath, 'utf8'), 'not json');
});
