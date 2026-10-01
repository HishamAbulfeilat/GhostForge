import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TUI = readFileSync(resolve(ROOT, 'tui/index.js'), 'utf8');

test('webhook controls are reachable from the home menu and dispatch', () => {
  assert.match(TUI, /'🪝  Webhooks'.*'webhooks'/);
  assert.match(TUI, /async function screenWebhooks\(\)/);
  assert.match(TUI, /case 'webhooks':\s+await screenWebhooks\(\); break/);
});

test('webhook actions use the authenticated bridge contract and explicit confirmation', () => {
  assert.match(TUI, /collabBridgeRequest\('\/api\/webhook'\)/);
  assert.match(TUI, /collabBridgeRequest\('\/api\/webhook\?log=1'\)/);
  assert.match(TUI, /method: 'POST',\s+body: JSON\.stringify\(\{ config: nextConfig \}\)/);
  assert.match(TUI, /method: 'DELETE'/);
  assert.match(TUI, /Webhook event log cleared\./);
});

test('webhook config validation rejects malformed JSON, invalid fields, and duplicate IDs', () => {
  const parserSource = TUI.match(/function parseWebhookConfig\(value\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(parserSource, 'TUI should define the webhook config validator');

  const parseWebhookConfig = runInNewContext(`(${parserSource})`);
  const parsed = JSON.parse(JSON.stringify(parseWebhookConfig('[{"id":"build","source":"GitHub","eventType":"push","action":"Review changes"}]')));
  assert.deepEqual(parsed, [{
    id: 'build',
    source: 'GitHub',
    eventType: 'push',
    action: 'Review changes',
  }]);

  for (const value of [
    'not-json',
    '[{"id":"build","source":"GitHub","eventType":"push"}]',
    '[{"id":"dup","source":"GitHub","eventType":"push","action":"One"},{"id":"dup","source":"GitHub","eventType":"push","action":"Two"}]',
  ]) {
    assert.throws(() => parseWebhookConfig(value), /non-empty|JSON array|unique|valid JSON/i);
  }
});
