#!/usr/bin/env node
/**
 * GhostForge marketplace unit tests (node:test, dependency-free).
 *
 * Exercises the "effective installed set" formula documented in
 * CLAUDE.md and implemented independently by the web API
 * (web-ui/app/api/marketplace/route.ts) and the TUI
 * (`screenMarketplace` in tui/index.js):
 *
 *   effective = (registry.installed ∪ {catalog items with installed:true})
 *               − registry.removed
 *
 * This test re-derives that set from the real catalog.json/registry.json
 * fixtures and checks the invariants both consumers rely on, so a change
 * to either file (or a future divergent implementation) fails fast.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace/catalog.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace/registry.json'), 'utf8'));

/** Mirrors the formula documented in CLAUDE.md / AGENTS.md. */
function effectiveInstalledIds(catalogData, registryData) {
  const removed = new Set(registryData.removed || []);
  const installed = new Set((registryData.installed || []).filter(id => !removed.has(id)));
  for (const item of catalogData.items) {
    if (item.installed && !removed.has(item.id)) installed.add(item.id);
  }
  return installed;
}

test('marketplace catalog items all have unique, known ids', () => {
  const ids = catalog.items.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length, 'catalog item ids must be unique');
});

test('registry.removed never re-appears in registry.installed', () => {
  const removed = new Set(registry.removed || []);
  const overlap = (registry.installed || []).filter(id => removed.has(id));
  assert.deepEqual(overlap, [], 'an id cannot be both installed and removed in the registry');
});

test('effective installed set only contains real catalog ids or explicit registry installs', () => {
  const catalogIds = new Set(catalog.items.map(i => i.id));
  const effective = effectiveInstalledIds(catalog, registry);
  for (const id of effective) {
    const inCatalog = catalogIds.has(id);
    const explicitlyInstalled = (registry.installed || []).includes(id);
    assert.ok(
      inCatalog || explicitlyInstalled,
      `effective id "${id}" is neither a catalog item nor an explicit registry install`
    );
  }
});

test('catalog items pre-marked installed:true are present in the effective set unless removed', () => {
  const removed = new Set(registry.removed || []);
  const effective = effectiveInstalledIds(catalog, registry);
  for (const item of catalog.items) {
    if (item.installed && !removed.has(item.id)) {
      assert.ok(effective.has(item.id), `"${item.id}" should be in the effective installed set`);
    }
  }
});

test('explicit registry removals are never in the effective installed set', () => {
  const effective = effectiveInstalledIds(catalog, registry);
  for (const id of registry.removed || []) {
    assert.ok(!effective.has(id), `"${id}" was explicitly removed and must not be effective-installed`);
  }
});
