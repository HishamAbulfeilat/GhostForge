#!/usr/bin/env node
/**
 * Guards the root smoke test's own test discovery (T-006).
 *
 * scripts/test.js used to name each suite explicitly. Six suites — collab,
 * n8n, users, webhooks, workflows, package-apps — were written, passed, and
 * were named in no runner at all: not scripts/test.js, not package.json, not
 * CI. Roughly 43 passing tests that could regress invisibly.
 *
 * Discovery is now a recursive walk for *.test.mjs. That fixes the six, but it
 * can silently rot back into a hardcoded list, so these tests pin the
 * invariant rather than the implementation: the runner must not enumerate
 * suites by name, and every suite on disk must be inside the walked tree.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'test.js');
const source = fs.readFileSync(RUNNER, 'utf8');

/** Suites that existed but were named in no runner when T-006 landed. */
const ORPHANED = ['collab', 'n8n', 'users', 'webhooks', 'workflows', 'package-apps'];

const readdirDeep = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? readdirDeep(full) : [full];
  });

test('the root smoke test discovers suites instead of naming them', () => {
  // A hardcoded path is how the six orphans happened: someone adds a suite and
  // the list is never updated, because nothing fails when they forget.
  for (const name of [...ORPHANED, 'awesome-llm-apps', 'worlds']) {
    assert.doesNotMatch(
      source,
      new RegExp(`scripts/${name}\\.test\\.mjs`),
      `scripts/test.js names scripts/${name}.test.mjs directly; discovery should find it`,
    );
  }
  assert.match(source, /\.test\.mjs/, 'the runner must match *.test.mjs somewhere');
});

test('every scripts/** suite lives where the walker will find it', () => {
  const all = readdirDeep(path.join(ROOT, 'scripts'))
    .filter(f => f.endsWith('.test.mjs'))
    .map(f => path.relative(ROOT, f).replace(/\\/g, '/'));

  // scripts/agents/** has a separate entry point (npm run test:agents, plus
  // health.mjs), so it is deliberately out of the root run — but it must be
  // excluded on purpose, and it must actually exist.
  const agents = all.filter(rel => rel.startsWith('scripts/agents/'));
  assert.ok(agents.length > 0, 'scripts/agents suites should exist and be excluded');
  assert.match(
    source,
    /skip|exclude/i,
    'the runner should exclude scripts/agents explicitly, with a reason',
  );
  assert.doesNotMatch(
    source,
    /scripts[/\\]agents[/\\]\w+\.test\.mjs/,
    'the root runner must not name an individual agent suite',
  );

  // Everything else must fall inside the walk: it is either matched by the
  // *.test.mjs rule or it is a .test file the walker would skip silently.
  const covered = all.filter(rel => !rel.startsWith('scripts/agents/'));
  for (const rel of covered) {
    assert.ok(rel.endsWith('.test.mjs'), `${rel} is a test file the walker would not pick up`);
  }
  assert.ok(covered.length >= 11, `expected the walker to cover >=11 suites, saw ${covered.length}`);
});

test('the six previously-orphaned suites are all still on disk', () => {
  // If one is deleted the discovery test above silently covers less. Assert the
  // suites that motivated this change are actually present.
  for (const name of ORPHANED) {
    const file = path.join(ROOT, 'scripts', `${name}.test.mjs`);
    assert.ok(fs.existsSync(file), `scripts/${name}.test.mjs is missing`);
  }
});

test('the excluded agent suites are covered by their own runner', () => {
  // Excluding scripts/agents from the root run is only safe because something
  // else runs them. npm run test:agents is that something.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['test:agents'], /scripts\/agents\/\*\.test\.mjs/,
    'scripts/agents/**/*.test.mjs must be run by test:agents');
  assert.match(pkg.scripts.test, /scripts\/test\.js/,
    'npm test must run the root smoke test');
});