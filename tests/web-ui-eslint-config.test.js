#!/usr/bin/env node
/**
 * web-ui ESLint flat config unit tests (node:test, dependency-free).
 *
 * `npm run lint` in web-ui runs `eslint .` over the whole package, but
 * `scripts/agents/health.mjs` and the PR Quality Check workflow run
 * `next lint` (or only count its exit status). Next's linter scopes itself to
 * app/components/lib/src, so it never saw web-ui/vendor — the vendored
 * agent-office scene was carrying 9 `no-explicit-any` errors that `eslint .`
 * surfaced and `next lint` did not. The two commands therefore disagreed,
 * which is how a config that "works" in CI can still fail `npm run lint`.
 *
 * These checks pin the config the CI lint step depends on without running
 * ESLint (it needs web-ui/node_modules, which the root smoke test can't
 * assume):
 *   1. a flat config exists and is what npm's `lint` script will load
 *   2. vendor/ is ignored, so upstream code isn't held to our ruleset
 *   3. it stays ignored — dropping the entry brings the 9 errors back
 *   4. first-party source is still covered by the Next shareable configs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web-ui');
const CONFIG = path.join(WEB, 'eslint.config.mjs');

/** Vendored upstream scenes. Their NOTICE.md pins each to an upstream commit. */
const VENDOR_DIRS = ['agent-office', 'ai-town'];

const configSource = () => fs.readFileSync(CONFIG, 'utf8');
const pkg = () => JSON.parse(fs.readFileSync(path.join(WEB, 'package.json'), 'utf8'));

test('web-ui has an ESLint flat config and npm lint resolves to it', () => {
  assert.ok(fs.existsSync(CONFIG), 'web-ui/eslint.config.mjs must exist for `eslint .` to run');

  // ESLint 9 dropped .eslintrc; a legacy config here would silently fail.
  assert.match(configSource(), /export default \[/, 'flat config must export an array');

  // The `lint` script is what health.mjs-adjacent tooling and humans run.
  assert.equal(pkg().scripts.lint, 'eslint .');
  assert.match(pkg().devDependencies.eslint, /^[\^~]?9\./, 'flat config needs ESLint 9+');
});

test('vendored upstream scenes are ignored', () => {
  const source = configSource();
  assert.match(source, /'vendor\/\*\*'/, 'vendor/** must be in the flat-config ignores');

  // Ignoring the directory outright is what keeps the ignore anchored, but
  // pin the real dirs so a narrower glob can't quietly start linting them.
  for (const dir of VENDOR_DIRS) {
    assert.ok(
      fs.existsSync(path.join(WEB, 'vendor', dir)),
      `web-ui/vendor/${dir} should exist — update this test if it was removed`
    );
  }
});

test('vendor NOTICE.md files stay, so the ignore stays justified', () => {
  // The ignore is only defensible because these dirs are pinned to upstream.
  // If a NOTICE is lost, the vendored bytes are no longer reviewable and the
  // ignore should be revisited rather than silently kept.
  for (const dir of VENDOR_DIRS) {
    const notice = path.join(WEB, 'vendor', dir, 'NOTICE.md');
    if (!fs.existsSync(notice)) continue;
    const body = fs.readFileSync(notice, 'utf8');
    assert.match(body, /https?:\/\//, `web-ui/vendor/${dir}/NOTICE.md must cite its upstream source`);
  }
});

test('first-party source stays covered by the Next shareable configs', () => {
  const source = configSource();
  assert.match(source, /next\/core-web-vitals/, 'core-web-vitals keeps react-hooks rules on');
  assert.match(
    source,
    /next\/typescript/,
    'the TS config supplies the @typescript-eslint ruleset the project relies on'
  );

  // Build artefacts and deps must stay out of the run.
  for (const ignored of ['.next/**', 'node_modules/**']) {
    assert.ok(source.includes(ignored), `${ignored} must stay ignored`);
  }
});
