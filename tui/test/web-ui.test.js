import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WEB_UI_URL, webUiOrigin, webUiUrl, webUiSessionToken, webUiAuthHeaders, webUiRequest, webUiReachable,
} from '../lib/web-ui.js';
import { requestJarvis } from '../lib/gfai-client.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TUI = readFileSync(resolve(ROOT, 'tui/index.js'), 'utf8');
const GFAI = readFileSync(resolve(ROOT, 'tui/lib/gfai-client.js'), 'utf8');

function response(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: async () => text,
  };
}

test('web UI defaults to the dev server origin on port 3001', () => {
  assert.equal(DEFAULT_WEB_UI_URL, 'http://localhost:3001');
  assert.equal(webUiOrigin({}), 'http://localhost:3001');
  assert.equal(webUiUrl('/jarvis', {}), 'http://localhost:3001/jarvis');
});

test('GF_WEB_UI_URL overrides scheme, host and port and is validated', () => {
  const env = { GF_WEB_UI_URL: 'https://localhost:3001/' };
  assert.equal(webUiOrigin(env), 'https://localhost:3001');
  assert.equal(webUiUrl('/api/llmfit', env), 'https://localhost:3001/api/llmfit');
  for (const bad of ['localhost:3001', 'ftp://x', 'http://u:p@localhost:3001', 'http://localhost:3001/app', 'http://localhost:3001/?a=1']) {
    assert.throws(() => webUiOrigin({ GF_WEB_UI_URL: bad }), /GF_WEB_UI_URL/);
  }
  assert.throws(() => webUiUrl('//evil.example/x', {}));
});

test('session token comes from one of the documented env names and is sent as gf_token', () => {
  assert.equal(webUiSessionToken({}), '');
  assert.deepEqual(webUiAuthHeaders({}), {});
  assert.equal(webUiSessionToken({ GHOSTFORGE_TOKEN: 'c', GF_SESSION_TOKEN: 'b', GF_WEB_UI_TOKEN: 'a' }), 'a');
  assert.equal(webUiSessionToken({ GHOSTFORGE_TOKEN: 'c', GF_SESSION_TOKEN: 'b' }), 'b');
  assert.deepEqual(webUiAuthHeaders({ GHOSTFORGE_TOKEN: 'tok' }), { Cookie: 'gf_token=tok' });
  assert.throws(() => webUiSessionToken({ GF_WEB_UI_TOKEN: 'a;b' }), /invalid/);
  // The server signing secret is never used as a session cookie.
  assert.deepEqual(webUiAuthHeaders({ AUTH_SECRET: 'secret' }), {});
});

test('webUiRequest calls the configured origin, sends JSON and does not follow redirects', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return response(200, { speech: 'hi' }); };
  const env = { GF_WEB_UI_URL: 'https://localhost:3001', GF_WEB_UI_TOKEN: 'tok' };
  const result = await webUiRequest('/api/jarvis', { method: 'POST', body: { message: 'x' }, env, fetchImpl });
  assert.deepEqual(result, { ok: true, status: 200, body: { speech: 'hi' } });
  assert.equal(calls[0].url, 'https://localhost:3001/api/jarvis');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.body, '{"message":"x"}');
  assert.equal(calls[0].init.headers.Cookie, 'gf_token=tok');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
});

test('webUiRequest reports a redirect (e.g. the :3000 -> https :3001 hop) instead of following it', async () => {
  const fetchImpl = async () => response(308, '', { location: 'https://localhost:3001/api/llmfit' });
  await assert.rejects(
    webUiRequest('/api/llmfit', { env: { GF_WEB_UI_URL: 'http://localhost:3000' }, fetchImpl }),
    error => error.offline === true && /redirected to https:\/\/localhost:3001/.test(error.message),
  );
});

test('webUiRequest marks unreachable servers as offline with a scheme hint', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(webUiRequest('/api/jarvis/morning', { env: {}, fetchImpl }),
    error => error.offline === true && /http:\/\/localhost:3001/.test(error.message) && /GF_WEB_UI_URL=https/.test(error.message));
  assert.equal(await webUiReachable({ env: {}, fetchImpl }), false);
  assert.equal(await webUiReachable({ env: {}, fetchImpl: async () => response(401, {}) }), true);
});

test('GF.AI chat posts to the configured web UI over its own scheme', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return response(200, { speech: 'ok' }); };
  const env = { GF_WEB_UI_URL: 'https://127.0.0.1:3001' };
  assert.deepEqual(await requestJarvis({ message: 'hi' }, 1000, { env, fetchImpl }), { speech: 'ok' });
  assert.equal(calls[0].url, 'https://127.0.0.1:3001/api/jarvis');
  assert.equal(await requestJarvis({ message: 'hi' }, 1000, { env, fetchImpl: async () => response(401, {}) }), null);
  assert.deepEqual(await requestJarvis({ message: 'hi' }, 1000, { env, fetchImpl: async () => response(200, 'plain') }), { speech: 'plain' });
  assert.doesNotMatch(GFAI, /port: 3001|http\.request/);
});

test('every TUI web UI call goes through the shared helper (no hard-coded origins)', () => {
  assert.doesNotMatch(TUI, /['"`]https?:\/\/(localhost|127\.0\.0\.1):3001\//);
  assert.doesNotMatch(TUI, /127\.0\.0\.1:3000/);
  assert.doesNotMatch(TUI, /gf_token=\$\{process\.env\.AUTH_SECRET/);
  assert.match(TUI, /webUiRequest\('\/api\/llmfit'/);
  assert.match(TUI, /webUiRequest\('\/api\/jarvis\/models'/);
  assert.match(TUI, /webUiRequest\(pathname, \{ timeoutMs: 15000 \}\)/);
});

test('collaboration share links use the web UI origin, not the old :3000 default', async () => {
  const { collabShareUrl } = await import('../lib/web-ui.js');
  assert.equal(collabShareUrl('abcd1234', undefined, {}), 'http://localhost:3001/jarvis?session=abcd1234');
  assert.equal(collabShareUrl('abcd1234', '/jarvis?session=abcd1234', { GF_WEB_UI_URL: 'https://192.168.1.5:3001' }),
    'https://192.168.1.5:3001/jarvis?session=abcd1234');
  // A share path from the bridge that is not the expected shape is replaced.
  assert.equal(collabShareUrl('abcd1234', 'https://evil.example/x', {}), 'http://localhost:3001/jarvis?session=abcd1234');
  assert.throws(() => collabShareUrl('abcd1234', undefined, { GF_WEB_UI_URL: 'nope' }), /share link/);
});
