import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8');

test('marketplace installs go through the consented queue, never straight to a shell', () => {
  assert.doesNotMatch(source, /execSync\(platformInstallCommand/);
  const install = source.slice(source.indexOf("if (action === 'install') {"), source.indexOf("if (action === 'install-queue') {"));
  assert.match(install, /queue\.planInstall\(item\)/);
  assert.match(install, /queue\.enqueue\(queueCtx, item\.id\)/);
  assert.doesNotMatch(install, /spawnSync|execSync/, 'the install action itself runs nothing');
});

test('a queued install runs only after per-item consent and records the result', () => {
  const review = source.slice(source.indexOf('async function reviewQueuedInstall('), source.indexOf('async function screenMarketplace('));
  const consentAt = review.indexOf('queue.consentToInstall(');
  const runAt = review.indexOf('spawnSync(command');
  assert.ok(consentAt > 0 && runAt > consentAt, 'consent is recorded before the command runs');
  assert.match(review, /Approve and run this exact command/);
  assert.match(review, /authorizedUseOnly/);
  assert.match(review, /queue\.recordInstallResult\(ctx, entry\.id/);
});
