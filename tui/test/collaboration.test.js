import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TUI = readFileSync(resolve(ROOT, 'tui/index.js'), 'utf8');

test('collaboration screen is reachable from the menu and both dispatch paths', () => {
  assert.match(TUI, /Collaboration & Sharing/);
  assert.match(TUI, /'collaboration'/);
  assert.match(TUI, /async function screenCollaboration\(\)/);
  assert.match(TUI, /dest === 'collaboration'\) await screenCollaboration\(\)/);
  assert.match(TUI, /case 'collaboration': await screenCollaboration\(\); break/);
});

test('collaboration screen uses bridge create, load, message, and share contracts', () => {
  assert.match(TUI, /collabBridgeRequest\('\/api\/jarvis\/collab'\)/);
  assert.match(TUI, /collabBridgeRequest\(`\/api\/jarvis\/collab\?id=\$\{encodeURIComponent\(requestedId\)\}`\)/);
  assert.match(TUI, /JSON\.stringify\(\{ id: sessionId, role: 'user', content \}\)/);
  assert.match(TUI, /crossPlatformCopy\(shareUrl\)/);
  assert.match(TUI, /session\.shareUrl/);
});

test('bridge access requires an explicit token and protects remote credentials', () => {
  assert.match(TUI, /MARKL_BRIDGE_TOKEN/);
  assert.match(TUI, /\.ghostforge', 'bridge', 'token'/);
  assert.match(TUI, /Authorization: `Bearer \$\{token\}`/);
  assert.match(TUI, /GF_ALLOW_REMOTE_BRIDGE !== '1'/);
  assert.match(TUI, /set GF_ALLOW_REMOTE_BRIDGE=1 to opt in/);
});

test('collaboration input and displayed bridge content are bounded and sanitized', () => {
  assert.match(TUI, /COLLAB_SESSION_ID = \/\^\[a-z0-9\]\{8,64\}\$\/i/);
  assert.match(TUI, /content\.length > 10_000/);
  assert.match(TUI, /Message cannot be empty/);
  assert.match(TUI, /function safeCollabText\(value\)/);
  assert.match(TUI, /for \(const message of session\.messages\.slice\(-10\)\)/);
});
