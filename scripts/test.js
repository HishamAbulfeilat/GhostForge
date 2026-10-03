#!/usr/bin/env node
/**
 * GhostForge root smoke test — dependency-free.
 *
 * Validates the things that break most often without needing npm install:
 *   1. tui/index.js parses (syntax check)
 *   2. marketplace catalog + registry are valid JSON with unique item ids
 *   3. every catalog item has the required fields
 *   4. focused runtime tests and node:test unit tests pass
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
    const childOutput = ['stdout', 'stderr']
      .map(stream => {
        const value = err && err[stream];
        if (!value || !value.length) return '';
        const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
        return text.trim()
          ? `\n      child ${stream}:\n${text.trim().split(/\r?\n/).map(line => `        ${line}`).join('\n')}`
          : '';
      })
      .join('');
    console.error(`  ✗ ${label}\n      ${err.message}${childOutput}`);
  }
}

console.log('GhostForge smoke test\n');

check('no stray gitlinks (mode-160000) tracked in git', () => {
  const output = execFileSync('git', ['ls-files', '-s'], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
  const strayGitlinks = output.split('\n').filter(line => line.match(/^160000/));
  if (strayGitlinks.length) {
    const paths = strayGitlinks.map(line => line.split('\t')[1]).join(', ');
    throw new Error(
      `found stray gitlinks (submodule pointers): ${paths}\n` +
      `Remove them with: git rm --cached ${strayGitlinks.map(line => line.split('\t')[1]).join(' ')}`
    );
  }
});

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

check('Awesome LLM Apps CLI smoke tests pass', () => {
  execFileSync(
    process.execPath,
    ['--test', 'scripts/awesome-llm-apps.test.mjs'],
    { cwd: ROOT, stdio: 'pipe' }
  );
});

check('read-only files CLI tests pass', () => {
  execFileSync(
    process.execPath,
    ['--test', 'scripts/test/files.test.mjs'],
    { cwd: ROOT, stdio: 'pipe' }
  );
});

check('managed worlds runtime tests pass', () => {
  execFileSync(
    process.execPath,
    ['--test', 'scripts/worlds.test.mjs'],
    { cwd: ROOT, stdio: 'pipe' }
  );
});

check('tests/*.test.js unit tests pass (node:test)', () => {
  const testsDir = path.join(ROOT, 'tests');
  const testFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.js'));
  if (!testFiles.length) throw new Error('no tests/*.test.js files found');
  execFileSync(
    process.execPath,
    ['--test', ...testFiles.map(f => path.join(testsDir, f))],
    { cwd: ROOT, stdio: 'pipe' }
  );
});

check('FEATURE-MATRIX.md has no duplicate feature rows', () => {
  const matrixContent = fs.readFileSync(path.join(ROOT, 'docs/FEATURE-MATRIX.md'), 'utf8');
  const lines = matrixContent.split('\n');
  const features = [];
  for (const line of lines) {
    // Skip header rows (start with | and contain dashes, or are the column headers)
    if (!line.startsWith('|') || line.includes('---')) continue;
    // Extract feature name from first column (between first and second |)
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const featureName = parts[1].trim();
    if (featureName && featureName !== 'Feature') {
      features.push(featureName);
    }
  }
  const dupes = features.filter((f, i) => features.indexOf(f) !== i);
  if (dupes.length) {
    throw new Error(`duplicate feature row(s): ${[...new Set(dupes)].join(', ')}`);
  }
});

console.log();
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All checks passed');
