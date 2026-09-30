#!/usr/bin/env node
/**
 * GhostForge root smoke test — dependency-free.
 *
 * Validates the things that break most often without needing npm install:
 *   1. tui/index.js parses (syntax check)
 *   2. marketplace catalog + registry are valid JSON with unique item ids
 *   3. every catalog item has the required fields
 *
 * The web-ui unit tests run in their own CI step (they need node_modules).
 * Exits non-zero on the first failure so it works in CI.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${label}\n      ${err.message}`);
  }
}

console.log('GhostForge smoke test\n');

check('tui/index.js parses', () => {
  // execFileSync (no shell) avoids any command-string construction.
  execFileSync(process.execPath, ['--check', 'tui/index.js'], { cwd: ROOT, stdio: 'pipe' });
});

let catalog;
check('marketplace/catalog.json is valid JSON', () => {
  catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace/catalog.json'), 'utf8'));
  if (!Array.isArray(catalog.items)) throw new Error('items is not an array');
});

check('marketplace/registry.json is valid JSON', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace/registry.json'), 'utf8'));
  if (!Array.isArray(reg.installed)) throw new Error('installed is not an array');
});

check('catalog item ids are unique', () => {
  const ids = catalog.items.map(i => i.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`duplicate ids: ${[...new Set(dupes)].join(', ')}`);
});

check('every catalog item has id, name, type, category, description', () => {
  const bad = catalog.items.filter(i => !i.id || !i.name || !i.type || !i.category || !i.description);
  if (bad.length) throw new Error(`${bad.length} item(s) missing required fields`);
});

console.log();
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All checks passed');
