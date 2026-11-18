import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { studioTarget, readStudioUrl, saveStudioUrl } from '../dist/main/studio-connection.js';

test('studio URL validates destinations and exposes all main studio sections', () => {
  for (const section of ['/dashboard', '/jobs', '/agents', '/marketplace', '/settings']) {
    assert.equal(studioTarget('https://my-server.example:3001', section), `https://my-server.example:3001${section}`);
  }
  assert.equal(studioTarget('http://192.168.1.8:3001/', '/jobs'), 'http://192.168.1.8:3001/jobs');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.com', 'https://example.com/jobs', 'https://example.com/?secret=1', 'https://example.com/#fragment', '', null, {}]) {
    assert.throws(() => studioTarget(url));
  }
  assert.throws(() => studioTarget('https://example.com', '//evil.example'));
});

test('studio URL persists without credentials and is restored on next launch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-studio-'));
  const file = join(dir, 'studio.json');
  try {
    assert.equal(readStudioUrl(file), null);
    saveStudioUrl(file, 'https://my-server.example:3001');
    assert.equal(readStudioUrl(file), 'https://my-server.example:3001');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')), 'https://my-server.example:3001');
    assert.throws(() => saveStudioUrl(file, 'https://user:password@my-server.example'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('desktop fallback and IPC guard use bundled paths on all operating systems', () => {
  const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.match(source, /loadFile\(STUDIO_LAUNCHER\)/);
  assert.match(source, /pathToFileURL\(STUDIO_LAUNCHER\)\.href/);
  assert.match(source, /frame !== event\.sender\.mainFrame/);
  assert.match(source, /studioTarget\(raw, section\)/);
  assert.match(source, /saveStudioUrl\(/);
  const config = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
  assert.match(config, /android-web\/\*\*\/\*/);
});

test('desktop studio accepts plain HTTP only for loopback and private LAN servers', async () => {
  const { isPrivateStudioHost } = await import('../dist/main/studio-connection.js');
  assert.equal(studioTarget('http://localhost:3001'), 'http://localhost:3001/dashboard');
  assert.equal(studioTarget('http://10.0.0.5:3001', '/agents'), 'http://10.0.0.5:3001/agents');
  assert.throws(() => studioTarget('http://my-server.example:3001'), /HTTPS/);
  assert.throws(() => studioTarget('http://8.8.8.8:3001'), /HTTPS/);
  assert.equal(studioTarget('https://8.8.8.8:3001'), 'https://8.8.8.8:3001/dashboard');
  // Same rules as the Android launcher (android-web/studio-url.js).
  const { createRequire } = await import('node:module');
  const { isPrivateHost } = createRequire(import.meta.url)('../android-web/studio-url.js');
  for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.32.0.1', '192.168.0.1', '169.254.0.1', 'box.local', 'a.box.local', 'example.com', '[::1]', '[fd00::1]', '[2001:db8::1]', '300.1.1.1']) {
    assert.equal(isPrivateStudioHost(host), isPrivateHost(host), host);
  }
});
