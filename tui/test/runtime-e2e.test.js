import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { applyEffectiveMarketplaceState } from '../lib/marketplace-state.js';
import { executeBridgeCommand, fetchBridgeHealth } from '../lib/bridge-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

function getTuiDependencyRoot() {
  return [join(ROOT, 'tui', 'node_modules'), join(ROOT, 'node_modules')].find(dir => existsSync(dir));
}

test('marketplace effective-state helper matches the TUI formula', () => {
  const catalog = JSON.parse(readFileSync(join(ROOT, 'marketplace', 'catalog.json'), 'utf8'));
  const registry = JSON.parse(readFileSync(join(ROOT, 'marketplace', 'registry.json'), 'utf8'));
  const { installedSet, catalog: effectiveCatalog } = applyEffectiveMarketplaceState(catalog, registry);
  const removedSet = new Set((registry.removed || []).filter(Boolean));
  const expected = new Set((registry.installed || []).filter(id => !removedSet.has(id)));

  for (const item of catalog.items) {
    if (item.installed && !removedSet.has(item.id)) expected.add(item.id);
  }

  assert.deepEqual([...installedSet].sort(), [...expected].sort());
  assert.ok(effectiveCatalog.items.every(item => item.installed === installedSet.has(item.id)));
});

test('real TUI boots in a child process with controlled stdin and timeout', async (t) => {
  const dependencyRoot = getTuiDependencyRoot();
  if (!dependencyRoot) {
    t.skip('TUI runtime dependencies are not installed in this checkout');
  }

  const child = spawn(process.execPath, [join(ROOT, 'tui', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1', TERM: 'dumb' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });

  const exitPromise = once(child, 'exit');
  const timeout = setTimeout(() => {
    if (!child.killed) child.kill('SIGTERM');
  }, 15000);

  try {
    child.stdin.write('\u0003');
    child.stdin.end();
    await exitPromise;
    assert.match(output, /GhostForge|GHOST|Search tools or ask G\.F\.A\.I\.|Marketplace/i, 'The TUI should boot and print its banner or menu');
  } finally {
    clearTimeout(timeout);
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM');
    }
  }
});

test('bridge client reaches a temporary localhost endpoint', async () => {
  const token = 'test-bridge-token';
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'online', name: 'GhostForge Bridge' }));
      return;
    }

    if (req.url === '/execute') {
      let body = '';
      req.on('data', chunk => { body += String(chunk); });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        assert.equal(req.headers.authorization, token);
        assert.equal(payload.command, 'echo hello');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ output: 'hello', command: payload.command }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const health = await fetchBridgeHealth({ baseUrl: `http://127.0.0.1:${port}`, token });
    assert.equal(health.status, 'online');

    const execution = await executeBridgeCommand({
      baseUrl: `http://127.0.0.1:${port}`,
      token,
      command: 'echo hello',
    });
    assert.equal(execution.output, 'hello');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
