import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bridgeTokenPath, resolveBridgeToken } from '../lib/bridge-token.js';

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'gf-bridge-token-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

function writeToken(home, value) {
  mkdirSync(join(home, '.ghostforge', 'bridge'), { recursive: true });
  writeFileSync(bridgeTokenPath(home), value);
}

test('MARKL_BRIDGE_TOKEN wins over the token file', () => withHome(home => {
  writeToken(home, 'file-token\n');
  assert.equal(resolveBridgeToken({ MARKL_BRIDGE_TOKEN: ' env-token ' }, { home }), 'env-token');
}));

test('falls back to ~/.ghostforge/bridge/token when the env var is unset or blank', () => withHome(home => {
  writeToken(home, 'file-token\n');
  assert.equal(resolveBridgeToken({}, { home }), 'file-token');
  assert.equal(resolveBridgeToken({ MARKL_BRIDGE_TOKEN: '   ' }, { home }), 'file-token');
}));

test('missing, empty or multi-line tokens fail with a clear message', () => withHome(home => {
  assert.throws(() => resolveBridgeToken({}, { home }), /Set MARKL_BRIDGE_TOKEN or create .*\.ghostforge.bridge.token/);
  writeToken(home, '  \n');
  assert.throws(() => resolveBridgeToken({}, { home }), /empty/);
  assert.throws(() => resolveBridgeToken({ MARKL_BRIDGE_TOKEN: 'a\rb' }, { home }), /invalid characters/);
}));
