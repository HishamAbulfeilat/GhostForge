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
