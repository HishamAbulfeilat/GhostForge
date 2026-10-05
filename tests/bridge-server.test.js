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
const { createServer, connect } = require('net');
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
    port,
    exited: () => exited,
    stderr: () => stderr.join(''),
    async stop() {
      if (exited === null) child.kill();
      await sleep(100);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

/**
 * T-232: drive one request over a raw socket instead of fetch, so the test can
 * see the *connection's* fate and not only the status line.
 *
 * fetch/undici hides the distinction this regression lives in. `req.destroy()`
 * with a body still in flight makes the kernel answer RST; the bytes the server
 * already wrote may still be sitting in the socket buffer, so the client can
 * read a valid "413 Payload Too Large" off a socket that was already torn down —
 * and the request then fails on the *next* use, or as ECONNRESET. Asserting on
 * `res.status` alone therefore passes on a server that is destroying the
 * connection, which is exactly the bug.
 *
 * The body is also trickled rather than sent in one burst, so the server is
 * still receiving when it crosses the cap. `reset` records that the socket was
 * torn down (ECONNRESET / EPIPE / close-with-error) whether or not a status
 * line was read.
 */
function rawOverCapRequest(port, { bodyBytes, auth = true, chunk = 16384, gapMs = 1, settleMs = 1200, hardMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let statusLine = null;
    let reset = false;
    let sent = 0;
    let hardTimer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (hardTimer) clearTimeout(hardTimer);
      try { socket.destroy(); } catch { /* best effort */ }
      resolve({ statusLine, reset, bytesWritten: sent });
    };

    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        'POST /execute HTTP/1.1\r\n' +
          'Host: 127.0.0.1\r\n' +
          (auth ? `Authorization: Bearer ${TOKEN}\r\n` : '') +
          'Content-Type: application/json\r\n' +
          `Content-Length: ${bodyBytes}\r\n\r\n`
      );

      socket.on('data', chunk => {
        if (statusLine) return;
        const head = chunk.toString('utf8', 0, chunk.indexOf('\r\n') === -1 ? undefined : chunk.indexOf('\r\n'));
        if (head) statusLine = head;
      });
      socket.on('error', err => {
        if (err.code === 'ECONNRESET' || err.code === 'EPIPE') reset = true;
        finish();
      });
      socket.on('close', hadError => {
        if (hadError) reset = true;
        finish();
      });
      hardTimer = setTimeout(finish, hardMs);

      // Cross the cap without ever finishing the body, so the server is
      // guaranteed to be mid-read when it decides what to do.
      //
      // With gapMs 0 the loop must use setImmediate rather than setTimeout:
      // timers are clamped to the OS tick (~15.6ms on Windows), so a 64 MiB
      // body in 64 KiB chunks would take ~16s instead of milliseconds and get
      // cut off by hardMs — which reads as "the drain is bounded" whether or
      // not it is. Measure the server, not our own timer resolution.
      const block = 'x'.repeat(Math.min(chunk, bodyBytes));
      const pump = () => {
        if (settled) return;
        if (sent < bodyBytes) {
          const size = Math.min(block.length, bodyBytes - sent);
          const writable = socket.write(block);
          sent += size;
          if (writable) {
            if (gapMs) setTimeout(pump, gapMs);
            else setImmediate(pump);
          } else socket.once('drain', pump);
          return;
        }
        // Body fully sent: give the response time to arrive and the socket to
        // be torn down, then judge the outcome.
        setTimeout(finish, settleMs);
      };
      if (gapMs) setTimeout(pump, 5);
      else setImmediate(pump);
    });
    socket.on('error', () => { /* captured in the handler above */ });
  });
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

  // The server used to `req.destroy()` the moment the cap was crossed. The
  // client is still streaming the body it was refused, so the socket closed
  // with that data unread and the kernel answered RST, which threw the 413
  // away: the caller saw ECONNRESET ("connection died") instead of a status
  // code. Whether the response survives depends on whether the 413 reaches the
  // socket before it is torn down, which in turn depends on how the body was
  // split into chunks — so this test repeats the request. One pass is not
  // evidence: the failure was intermittent and only showed up under the load
  // of a full health run.
  let lastStatus = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await bridge.post('/execute', body);
    assert.ok(
      res,
      `attempt ${attempt}: connection died — the oversized body reset the socket ` +
        'instead of returning 413'
    );
    lastStatus = res.status;
    assert.equal(res.status, 413, `expected 413 for ${Buffer.byteLength(body)} bytes`);
    assert.match(res.body.error, /too large/i);
  }
  assert.equal(lastStatus, 413);

  assert.equal(bridge.exited(), null, 'bridge exited after an oversized body');
  const health = await bridge.get('/health');
  assert.equal(health?.status, 200, 'bridge stopped serving after a 413');
});

test('an oversized body does not stop the bridge answering later requests', async t => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  // Refusing a body must not poison the process for everything after it: the
  // health check has to keep answering and a normal request has to keep working.
  await bridge.post('/execute', multibyteBody(MAX_BODY_BYTES * 2, 'ࠀ'));

  const health = await bridge.get('/health');
  assert.equal(health?.status, 200, 'bridge stopped serving after refusing a large body');

  // The server must not have wedged into a half-read state: a small, valid
  // request still has to reach the handler (403 = not allowlisted).
  const res = await bridge.post('/execute', JSON.stringify({ command: 'rm -rf /' }));
  assert.equal(res.status, 403, 'bridge stopped handling normal requests after a 413');
  assert.equal(bridge.exited(), null);
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

/**
 * T-232: the MAX_DRAIN_BYTES change that landed in T-230 (5d32cd6) had no test
 * of its own. readJsonBody used to `req.destroy()` the moment the byte cap was
 * crossed; it now keeps reading and discarding past the cap so the 413 can
 * flush, bounded at MAX_DRAIN_BYTES so a peer that never stops sending cannot
 * hold the process reading forever.
 *
 * The existing 413 test only reads the status line, and a socket that was
 * destroyed with the body still in flight can still deliver that status line
 * out of its receive buffer — so it passes on a server that destroys the
 * connection. The tests below watch the connection's own fate instead.
 */
const MAX_DRAIN_BYTES = MAX_BODY_BYTES * 2;

/**
 * Two requests down one socket: an over-cap body, then a small valid one.
 *
 * This is the deterministic form of the same regression. Whether the client
 * sees ECONNRESET instead of the 413 is a race (~2.5% per request here, which
 * is why a loop of five attempts misses it more often than it hits it), but the
 * consequence is not: a socket that was destroyed cannot carry a second
 * request, and one that was drained can. Asserting on reusability turns a
 * 12%-power flake into a pass/fail that does not depend on timing.
 */
function reuseConnectionAfter413(port, { bodyBytes }) {
  return new Promise(resolve => {
    let done = false;
    let phase = 1;
    let firstStatus = null;
    let secondStatus = null;
    let writeError = null;
    let buffered = '';
    let sent = 0;
    let hardTimer = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (hardTimer) clearTimeout(hardTimer);
      try { socket.destroy(); } catch { /* best effort */ }
      resolve({ firstStatus, secondStatus, writeError });
    };

    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        'POST /execute HTTP/1.1\r\n' +
          'Host: 127.0.0.1\r\n' +
          `Authorization: Bearer ${TOKEN}\r\n` +
          'Content-Type: application/json\r\n' +
          `Content-Length: ${bodyBytes}\r\n\r\n`
      );
      const pump = () => {
        if (done || sent >= bodyBytes) return;
        const writable = socket.write('x'.repeat(32768));
        sent += 32768;
        if (writable) setTimeout(pump, 0);
        else socket.once('drain', pump);
      };
      pump();
    });

    socket.on('data', chunk => {
      buffered += chunk.toString('utf8');
      if (phase === 1 && /HTTP\/1\.1 413/.test(buffered)) {
        firstStatus = '413';
        phase = 2;
        // The first body is done being written; give the drain a moment, then
        // ask for /health on the very same socket.
        setTimeout(() => {
          try {
            socket.write('GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n');
          } catch {
            writeError = 'write-after-413 threw';
            finish();
          }
        }, 250);
      } else if (phase === 2 && /HTTP\/1\.1 200 OK/.test(buffered)) {
        secondStatus = '200';
        finish();
      }
    });
    socket.on('error', () => finish());
    socket.on('close', () => finish());
    hardTimer = setTimeout(finish, 4000);
  });
}

test('the connection survives a refused body and stays reusable', async t => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  // The point of draining instead of destroying: the caller gets its 413 and
  // the connection is left intact. Over the cap, under the drain cap, so the
  // bounded drain finishes rather than being cut short.
  const { firstStatus, secondStatus } = await reuseConnectionAfter413(bridge.port, {
    bodyBytes: Math.floor(MAX_BODY_BYTES * 1.5),
  });

  assert.equal(firstStatus, '413', 'the over-cap body should be refused with 413');
  assert.equal(
    secondStatus,
    '200',
    'the connection was destroyed by the refusal — the whole point of the drain is ' +
      'that the socket survives and can carry another request'
  );

  assert.equal(bridge.exited(), null, 'bridge exited after a refused body');
  const health = await bridge.get('/health');
  assert.equal(health?.status, 200, 'bridge stopped serving after a refused body');
});

test('the drain is bounded: an endless body is cut off, and the bridge survives', async t => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  // The other half of the guarantee. An unbounded drain would only trade the
  // unbounded buffer for an unbounded read, so a peer that never stops sending
  // has to be cut off — and cutting it off must not take the process with it.
  //
  // The body is far larger than the drain limit on purpose. A body only just
  // past the limit cannot tell a bounded drain from an unbounded one, because
  // both finish reading it; the cut-off only shows up as a torn-down socket
  // once the peer is still streaming well past the point the server gives up.
  const { statusLine, bytesWritten } = await rawOverCapRequest(bridge.port, {
    bodyBytes: 64 * 1024 * 1024,
    chunk: 65536,
    gapMs: 0,
    settleMs: 400,
    hardMs: 25000,
  });

  // The 413 is written the moment the body cap is crossed — far earlier than the
  // drain limit — so it must reach the client even though the socket is then
  // torn down underneath it.
  assert.ok(
    statusLine && /413/.test(statusLine),
    `expected 413 before the drain limit, got ${statusLine ?? 'no response'}`
  );

  // The evidence that the drain is bounded is how much the server was willing to
  // read, not how the socket reported its own death: whether a torn-down socket
  // surfaces as ECONNRESET or as a clean close depends on write timing, so
  // asserting on that flag is timing-dependent. How far the client got is not.
  // A bounded drain gives up after ~1 MiB of discarded body; an unbounded one
  // reads all 64 MiB, so the two are an order of magnitude apart.
  assert.ok(
    bytesWritten < 16 * 1024 * 1024,
    `the server read ${Math.round(bytesWritten / 1048576)} MiB of a 64 MiB body — ` +
      'the drain is not bounded, so a peer that never stops sending keeps this process reading'
  );

  assert.equal(bridge.exited(), null, 'bridge exited while cutting off an endless body');
  const health = await bridge.get('/health');
  assert.equal(health?.status, 200, 'bridge stopped serving after cutting off an endless body');
  const res = await bridge.post('/execute', JSON.stringify({ command: 'rm -rf /' }));
  assert.equal(res.status, 403, 'bridge stopped handling normal requests after a cut-off body');
});

test('an unauthorized oversized body is refused before it is ever buffered', async t => {
  const bridge = await startBridge();
  t.after(() => bridge.stop());

  // The drain is reachable only from an authenticated request: /execute checks
  // the token before calling readJsonBody, so a peer without it cannot make the
  // bridge read a byte of its body. This is what keeps the drain from being a
  // pre-auth read-and-discard amplifier.
  const { statusLine, reset } = await rawOverCapRequest(bridge.port, {
    bodyBytes: Math.floor(MAX_BODY_BYTES * 1.5),
    auth: false,
  });

  assert.ok(
    statusLine && /401/.test(statusLine),
    `expected 401 for an unauthenticated request, got ${statusLine ?? 'no response'}`
  );
  assert.equal(reset, false, 'the bridge destroyed an unauthenticated connection instead of 401-ing it');
  assert.equal(bridge.exited(), null);
});