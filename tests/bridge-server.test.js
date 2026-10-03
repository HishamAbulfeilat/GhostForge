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

/**
 * T-225: the body cap was compared against `body.length`, which counts UTF-16
 * code units rather than bytes. A BMP character from U+0800 up (Arabic,
 * Devanagari, CJK) is 3 bytes but 1 unit, so a body of them passed the check at
 * 3x the intended byte size — while `body += chunk` had already grown the
 * string past the cap before the comparison ran.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/** A valid JSON object padded to `byteTarget` bytes with 3-byte characters. */
function multibyteBody(byteTarget, char) {
  const head = '{"prompt":"';
  const tail = '"}';
  const room = byteTarget - Buffer.byteLength(head + tail, 'utf8');
  const perChar = Buffer.byteLength(char, 'utf8');
  const count = Math.floor(room / perChar);
  return head + char.repeat(count) + tail;
}

test('a multi-byte body over the cap is refused with 413, not accepted', async t => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  // Just under 2 MiB of real bytes but only ~700k UTF-16 units: the old
  // character check let this through, the byte check refuses it.
  const body = multibyteBody(MAX_BODY_BYTES * 2, 'ࠀ');
  assert.ok(
    Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES,
    'body must exceed the byte cap for this test to mean anything'
  );
  assert.ok(
    body.length < MAX_BODY_BYTES,
    'body must stay under the cap in characters — that is the whole bug'
  );

  const res = await bridge.post('/execute', body);
  assert.ok(res, 'connection died — a large body should not kill the bridge');
  assert.equal(res.status, 413, `expected 413 for ${Buffer.byteLength(body)} bytes`);
  assert.match(res.body.error, /too large/i);

  assert.equal(bridge.exited(), null, 'bridge exited after an oversized body');
  const health = await bridge.get('/health');
  assert.equal(health?.status, 200, 'bridge stopped serving after a 413');
});

test('a multi-byte body under the cap is still parsed, not rejected', async t => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  // A genuine request in Arabic — near the cap in bytes, well under it in
  // characters. This must reach the handler: the allowlist 403 is proof the
  // body was decoded correctly, since a mangled multi-byte chunk would have
  // failed JSON.parse with 400 instead.
  const body = multibyteBody(MAX_BODY_BYTES - 4096, 'م');
  assert.ok(Buffer.byteLength(body, 'utf8') < MAX_BODY_BYTES);

  const res = await bridge.post('/execute', body);
  assert.equal(res.status, 403, 'a valid large multi-byte body must reach the handler');

  // A multi-byte prompt is parsed byte-correctly, including across the chunk
  // boundaries of a body this large. An over-long prompt hits the handler's own
  // deterministic limit rather than spawning `gh`, so the error message proves
  // which branch ran: 'Invalid prompt' means the prompt decoded to a non-empty
  // string, while 'Invalid JSON' would mean a chunk-boundary split corrupted it.
  const longPrompt = 'منا المرحبا '.repeat(1000);
  const copilot = await bridge.post('/copilot', JSON.stringify({ prompt: longPrompt }));
  assert.equal(copilot.status, 400);
  assert.equal(
    copilot.body.error,
    'Invalid prompt',
    'expected the handler\'s prompt-length branch, not a JSON decode failure'
  );
});