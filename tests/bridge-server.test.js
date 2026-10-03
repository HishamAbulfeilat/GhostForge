#!/usr/bin/env node
/**
 * GhostForge bridge server unit tests (node:test, dependency-free).
 *
 * T-224: a JSON body of `null` used to be handed straight to the /copilot
 * and /execute handlers, which read `payload.prompt` / `payload.command`.
 * That threw a TypeError inside the request 'end' handler — uncaught, so it
 * killed the whole bridge process. Any caller that could reach the bridge
 * with the token could take it down, and every later request got
 * connection-refused until the launcher restarted it.
 *
 * These tests drive a real bridge-server.js over HTTP and assert both halves
 * of the fix: the malformed body is rejected with 400, and the server is
 * still serving afterwards.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { createServer } = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'scripts', 'bridge-server.js');
const TOKEN = 't224-test-token';

/** Ask the OS for a free port, then release it for the bridge to bind. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Start a real bridge server. Returns a handle with `post`/`get` helpers plus
 * `stop`, and guarantees the child is reaped so a leaked process cannot fail
 * an unrelated run later.
 */
async function startBridge() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bridge-t224-'));
  const tokenFile = path.join(dir, 'token');
  fs.writeFileSync(tokenFile, `${TOKEN}\n`);
  const port = await freePort();

  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      BRIDGE_TOKEN_FILE: tokenFile,
      BRIDGE_ROOT: ROOT,
      BRIDGE_PORT: String(port),
      BRIDGE_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr = [];
  child.stderr.on('data', chunk => stderr.push(chunk.toString()));
  child.stdout.resume();
  let exited = null;
  child.on('exit', code => { exited = code; });

  const base = `http://127.0.0.1:${port}`;
  /** Never throws on a dead server: a refused connection IS the failure. */
  async function fetchJson(url, options) {
    try {
      const res = await fetch(`${base}${url}`, options);
      return { status: res.status, body: await res.json() };
    } catch {
      return null;
    }
  }
  const post = (url, rawBody) =>
    fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: rawBody,
    });

  // Wait for listen() rather than sleeping a fixed amount.
  for (let i = 0; i < 100 && exited === null; i++) {
    if ((await fetchJson('/health'))?.status === 200) break;
    await sleep(50);
  }

  return {
    post,
    get: url => fetchJson(url),
    exited: () => exited,
    stderr: () => stderr.join(''),
    async stop() {
      if (exited === null) child.kill();
      await sleep(100);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

/** Bodies that parse as valid JSON but are not the object the handlers read. */
const NON_OBJECT_BODIES = [
  ['null', 'null'],
  ['an array', '[]'],
  ['a bare string', '"just a string"'],
  ['a number', '42'],
];

for (const route of ['/copilot', '/execute']) {
  for (const [label, body] of NON_OBJECT_BODIES) {
    test(`POST ${route} with ${label} body is rejected and the server survives`, async t => {
      const bridge = await startBridge();
      t.after(() => bridge.stop());
      assert.equal(bridge.exited(), null, 'bridge failed to start');

      const res = await bridge.post(route, body);
      assert.ok(res, `${route} ${label}: connection died — the request killed the bridge`);
      assert.equal(res.status, 400, `${route} ${label}: expected 400`);
      assert.match(res.body.error, /object/i);

      // The regression is the process dying, so assert on liveness, not just
      // the status code: a server that 400s and then exits still loses it.
      assert.equal(bridge.exited(), null, `bridge exited (code ${bridge.exited()}) after ${route} ${label}`);
      const health = await bridge.get('/health');
      assert.equal(health?.status, 200, 'bridge stopped serving after a malformed body');
      assert.doesNotMatch(bridge.stderr(), /TypeError/, 'no uncaught TypeError should reach the log');
    });
  }
}

test('the bridge still handles a well-formed object body', async t => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  // A valid object whose command is not allowlisted: 403 from the handler,
  // which proves the body still reaches the handlers intact after the guard.
  const res = await bridge.post('/execute', JSON.stringify({ command: 'rm -rf /' }));
  assert.equal(res.status, 403);

  // An empty prompt still trips the handler's own validation, not the new guard.
  const copilot = await bridge.post('/copilot', JSON.stringify({ prompt: '   ' }));
  assert.equal(copilot.status, 400);
  assert.equal(copilot.body.error, 'Invalid prompt');
});

test('the bridge still rejects an unparseable body with 400', async t => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  const res = await bridge.post('/copilot', '{not json');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Invalid JSON');
  assert.equal(bridge.exited(), null);
});