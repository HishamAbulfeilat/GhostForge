import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.js'), 'utf8');

test('the TUI never splices a path into a shell line with cd "${...}"', () => {
  assert.doesNotMatch(source, /cd "\$\{/);
});

test('git commands in the TUI are not built as shell template strings', () => {
  // e.g. execSync(`git log ... "${value}"`): use spawnSync/execFileSync with an argv array.
  const offenders = source.split('\n').filter(line => /exec(?:Sync)?\(\s*`[^`]*\bgit\b[^`]*\$\{/.test(line));
  assert.deepEqual(offenders, []);
});
