#!/usr/bin/env node
/**
 * GhostForge root smoke test — dependency-free.
 *
 * Validates the things that break most often without needing npm install:
 *   1. tui/index.js parses (syntax check)
 *   2. marketplace catalog + registry are valid JSON with unique item ids
 *   3. every catalog item has the required fields
 *   4. every tests/*.test.js unit test passes
 *   5. every scripts/**\/*.test.mjs suite passes
 *
 * (4) and (5) are discovered by glob, not listed by name. Six suites
 * (collab, n8n, users, webhooks, workflows, package-apps) passed but were
 * named in no runner — they only ran if you happened to know to run them, so
 * a regression in any of them was invisible to CI. A new *.test.mjs file under
 * scripts/ is now picked up automatically.
 *
 * The web-ui unit tests run in their own CI step (they need node_modules).
 * Exits non-zero on the first failure so it works in CI.
 */
'use strict';

const childProcess = require('child_process');
const { MAX_BUFFER, explainEnobufs } = require('./spawn-limits.cjs');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

/** execFileSync with an explicit maxBuffer and a clear ENOBUFS message. */
function execFileSync(file, args, options = {}) {
  try {
    return childProcess.execFileSync(file, args, { maxBuffer: MAX_BUFFER, ...options });
  } catch (err) {
    throw explainEnobufs(err, `${file} ${args.join(' ')}`);
  }
}

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

/**
 * Every *.test.mjs under scripts/, recursively, sorted for a stable order.
 *
 * scripts/agents/** is excluded: those suites have their own runner
 * (`npm run test:agents`, and health.mjs's "Agent team unit tests" check)
 * because they exercise the boss/watchdog and are not part of the root smoke
 * test. Excluding them keeps the root run fast and avoids double-reporting.
 */
function scriptsTestFiles() {
  const skip = path.join(ROOT, 'scripts', 'agents');
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full === skip) continue;
        walk(full);
      } else if (entry.name.endsWith('.test.mjs')) {
        out.push(full);
      }
    }
  };
  walk(path.join(ROOT, 'scripts'));
  return out.sort();
}

check('scripts/** CLI suites pass (node:test)', () => {
  const testFiles = scriptsTestFiles();
  if (!testFiles.length) throw new Error('no scripts/**/*.test.mjs files found');
  execFileSync(process.execPath, ['--test', ...testFiles], { cwd: ROOT, stdio: 'pipe' });
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
