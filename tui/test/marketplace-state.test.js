import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyEffectiveMarketplaceState,
  normalizeRegistry,
  recordGenerated,
  recordInstalled,
  recordMarked,
} from '../lib/marketplace-state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, '..', 'index.js'), 'utf8');

const catalog = { items: [{ id: 'semgrep' }, { id: 'trivy' }, { id: 'seeded', installed: true }] };

test('an item only marked on the web stays installable in the TUI', () => {
  const { items, installedSet, markedSet } = applyEffectiveMarketplaceState(catalog, { installed: [], marked: ['semgrep'] });
  const semgrep = items.find(i => i.id === 'semgrep');
  assert.equal(semgrep.installed, false);
  assert.equal(semgrep.marked, true);
  assert.ok(!installedSet.has('semgrep'));
  assert.ok(markedSet.has('semgrep'));
  // The TUI's Install Item list is catalog.items.filter(i => !i.installed).
  assert.ok(items.filter(i => !i.installed).some(i => i.id === 'semgrep'));
  assert.match(source, /const available = catalog\.items\.filter\(i => !i\.installed\);/);
});

test('a real TUI install moves the id from marked[] to installed[]', () => {
  const reg = recordInstalled({ installed: [], marked: ['semgrep'], removed: ['semgrep'] }, 'semgrep');
  assert.deepEqual(reg.installed, ['semgrep']);
  assert.deepEqual(reg.marked, []);
  assert.deepEqual(reg.removed, []);
});

test('a hand-made mark never writes installed[]', () => {
  const reg = recordMarked({ installed: ['trivy'] }, 'semgrep');
  assert.deepEqual(reg.installed, ['trivy']);
  assert.deepEqual(reg.marked, ['semgrep']);
});

test('generated items go to generated[] and installed[] stays string-only', () => {
  const entry = { id: 'my-cmd', type: 'command', name: 'My cmd', file: 'commands/my-cmd.md' };
  const reg = recordGenerated({ installed: ['trivy'] }, entry);
  assert.deepEqual(reg.installed, ['trivy']);
  assert.deepEqual(reg.generated, [entry]);
  // Later installs keep the generated record instead of dropping it.
  const after = recordInstalled(reg, 'semgrep');
  assert.deepEqual(after.generated, [entry]);
  assert.deepEqual(after.installed, ['trivy', 'semgrep']);
});

test('older files with objects in installed[] are migrated on read', () => {
  const entry = { id: 'old', type: 'skill', name: 'Old', file: 'skills/old.md' };
  const reg = normalizeRegistry({ installed: ['trivy', entry], custom_agents: [{ name: 'a' }] });
  assert.deepEqual(reg.installed, ['trivy']);
  assert.deepEqual(reg.generated, [entry]);
  assert.deepEqual(reg.custom_agents, [{ name: 'a' }]);
  // Reading twice does not duplicate the migrated entry.
  assert.deepEqual(normalizeRegistry(reg).generated, [entry]);
  // The TUI keeps the normalized registry, so its next write persists the move.
  assert.match(source, /registry = normalizedRegistry;/);
});

test('the Generate screen no longer pushes objects into registry.installed', () => {
  assert.doesNotMatch(source, /reg\.installed\.push\(/);
  assert.match(source, /reg = recordGenerated\(reg, \{ id: cleanName/);
});
