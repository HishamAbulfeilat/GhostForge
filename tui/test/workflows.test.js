import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TUI = readFileSync(resolve(ROOT, 'tui/index.js'), 'utf8');

test('workflow controls are reachable from the home menu dispatch', () => {
  assert.match(TUI, /'🔁  Workflows'.*'workflows'/);
  assert.match(TUI, /async function screenWorkflows\(\)/);
  assert.match(TUI, /case 'workflows':\s+await screenWorkflows\(\); break/);
});

test('workflow runs use the authenticated bridge run contract and require confirmation', () => {
  assert.match(TUI, /collabBridgeRequest\('\/api\/workflows'\)/);
  assert.match(TUI, /method: 'POST',\s+body: JSON\.stringify\(\{ action: 'run', id: workflow\.id, max_steps: maxSteps \}\)/);
  assert.match(TUI, /Run this workflow through the bridge\?/);
  assert.match(TUI, /existing allowlisted command steps; manual steps are skipped/);
  assert.match(TUI, /Workflow run failed:/);
});

test('workflow max-step input accepts only whole decimal digits in the bridge range', () => {
  const parserSource = TUI.match(/function parseWorkflowMaxSteps\(value\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(parserSource, 'TUI should define the max-step validator');
  assert.doesNotMatch(parserSource, /parseInt/);

  const parseWorkflowMaxSteps = runInNewContext(`(${parserSource})`);
  assert.equal(parseWorkflowMaxSteps('1'), 1);
  assert.equal(parseWorkflowMaxSteps('100'), 100);
  assert.equal(parseWorkflowMaxSteps(' 2 '), 2);
  for (const value of ['2abc', '2.5', '1e2', '', '0', '101', '-1']) {
    assert.throws(() => parseWorkflowMaxSteps(value), /whole number from 1 to 100/);
  }
});
