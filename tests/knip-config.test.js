#!/usr/bin/env node
/**
 * web-ui knip configuration unit tests (node:test, dependency-free).
 *
 * knip reports "unused" files by following static imports. This repo has a
 * handful of files that are genuinely live but unreachable that way, so they
 * are suppressed in web-ui/knip.jsonc instead of deleted. Suppressions are
 * the risky part: a stale one hides a file that later becomes dead, and a
 * wrong deletion breaks a working feature. So these checks pin both halves:
 *
 *   1. every suppressed file still EXISTS (a suppression can't hide a deletion)
 *   2. every suppressed file still has the live reference that justifies it
 *   3. the old lib .js/.ts twins stay deleted (tests load the .ts)
 *   4. the removed deps are really gone, and the kept one is really loaded
 *
 * knip itself is not run here (it needs a network install); these assertions
 * read the same source of truth the config does.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web-ui');
const KNIP = path.join(WEB, 'knip.jsonc');
const PKG = path.join(WEB, 'package.json');

const pkg = () => JSON.parse(fs.readFileSync(PKG, 'utf8'));
const read = (...p) => fs.readFileSync(path.join(WEB, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(WEB, ...p));

/**
 * knip.jsonc is JSONC, but the only non-JSON in it is `//` comments. Strip
 * them rather than adding a jsonc parser as a test dependency.
 */
function knipConfig() {
  const stripped = fs.readFileSync(KNIP, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(stripped);
}

const ignoredFiles = () => knipConfig().ignore || [];

test('a knip config exists and lists the files it suppresses', () => {
  assert.ok(fs.existsSync(KNIP), 'web-ui/knip.jsonc must exist');
  assert.ok(ignoredFiles().length > 0, 'the ignore list should not be empty');
});

test('every suppressed file still exists on disk', () => {
  // The core anti-regression check: a suppression entry must never outlive
  // the file it names. If a suppressed file is ever deleted for real, the
  // entry has to be removed with it — this test is what makes that visible.
  for (const rel of ignoredFiles()) {
    assert.ok(exists(rel), `knip.jsonc ignores "${rel}" but that file no longer exists — drop the entry`);
  }
});

test('the string-path fixture is still rendered by the a11y tests', () => {
  // test/fixtures/command-palette-page.tsx is loaded as a *string* path, which
  // is the whole reason knip can't see it. If the harness stops taking a path
  // argument, the fixture is dead and the suppression is lying.
  const harness = read('test', 'command-palette-access.test.js');
  assert.match(harness, /command-palette-page\.tsx/, 'the fixture must still be referenced by the a11y test');
  assert.match(harness, /renderPage\(FIXTURE/, 'it must still be passed to the render harness');
});

test('the former lib .js/.ts twins are gone; only the TypeScript module remains', () => {
  // lib/agent-team-api and lib/agent-workflow-templates used to be
  // hand-maintained .js/.ts pairs (the .js only so node:test could require
  // them). They drifted, so the .js halves were deleted and the tests now
  // compile the .ts (web-ui/test/load-ts.js). A re-added .js twin would make
  // `@/lib/<name>` ambiguous again and hide the .ts from knip.
  for (const name of ['agent-team-api', 'agent-workflow-templates']) {
    assert.ok(exists('lib', `${name}.ts`), `lib/${name}.ts must exist`);
    assert.ok(!exists('lib', `${name}.js`), `lib/${name}.js must not come back — load the .ts in tests`);
    assert.ok(!ignoredFiles().includes(`lib/${name}.ts`), `lib/${name}.ts no longer needs a knip suppression`);
  }
  assert.match(read('app', 'api', 'agents', 'templates', 'route.ts'), /@\/lib\/agent-workflow-templates/);
  assert.match(read('app', 'api', 'snippets', 'route.ts'), /@\/lib\/agent-team-api/);
});

test('the ignored vendor file is still unmodified upstream', () => {
  // vendor/ai-town/NOTICE.md pins the tree to a commit so the local diff stays
  // reviewable. Deleting an upstream file would be an undocumented deviation,
  // which is why it is suppressed rather than removed.
  const notice = path.join(WEB, 'vendor', 'ai-town', 'NOTICE.md');
  if (fs.existsSync(notice)) {
    assert.match(fs.readFileSync(notice, 'utf8'), /https?:\/\//, 'the vendor NOTICE must cite its upstream source');
  }
  assert.ok(
    exists('vendor', 'ai-town', 'src', 'components', 'PositionIndicator.tsx'),
    'the suppressed vendor file must still exist'
  );
});

test('the genuinely-unused dependencies were removed, not suppressed', () => {
  // clsx / ws / xterm had zero import sites. They must be GONE from
  // package.json — the fix for real dead deps is deletion, not an ignore entry.
  const deps = pkg().dependencies;
  for (const dead of ['clsx', 'ws', 'xterm']) {
    assert.equal(deps[dead], undefined, `${dead} had no importers and must not come back`);
    assert.ok(
      !ignoredFiles().includes(dead),
      `${dead} should be deleted outright, not added to the ignore list`
    );
  }

  // The live terminal must keep the v6 scoped packages it actually imports.
  assert.match(
    read('components', 'XTermWrapper.tsx'),
    /from '@xterm\/xterm'/,
    'XTermWrapper must keep using the scoped @xterm/xterm package'
  );
  assert.ok(deps['@xterm/xterm'], '@xterm/xterm is the live import and must stay a dependency');
});

test('eslint-config-next is kept because the flat config really loads it', () => {
  // eslint.config.mjs resolves it through FlatCompat by STRING name, which
  // knip cannot follow. Dropping the package would break `npm run lint`
  // rather than slim it, so the suppression is load-bearing.
  assert.ok(pkg().devDependencies['eslint-config-next'], 'eslint-config-next must stay a devDependency');
  const ignoredDeps = knipConfig().ignoreDependencies || [];
  assert.ok(
    ignoredDeps.includes('eslint-config-next'),
    'eslint-config-next is used via FlatCompat and must be suppressed, not removed'
  );

  const config = read('eslint.config.mjs');
  assert.match(config, /next\/core-web-vitals/, 'the config must still extend the Next shareable configs');
  assert.match(config, /next\/typescript/, 'the config must still extend the Next TypeScript config');
});

test('the optional native dependency stays optional and unsuppressed-by-accident', () => {
  // @nut-tree/nut-js is lazily require()d in a try/catch so the app runs
  // without native bindings. It must NOT become a hard dependency (that would
  // force every install, including CI/Linux, to build native modules).
  const ignoredDeps = knipConfig().ignoreDependencies || [];
  assert.ok(ignoredDeps.includes('@nut-tree/nut-js'), 'the optional native dep needs a suppression');
  assert.equal(
    pkg().dependencies['@nut-tree/nut-js'],
    undefined,
    'the optional native dep must not be promoted to a real dependency'
  );
  assert.match(
    read('lib', 'nutjs.js'),
    /require\('@nut-tree\/nut-js'\)/,
    'nutjs.js must keep the lazy require the suppression documents'
  );
});

test('the unlisted binaries are OS executables, not npm packages', () => {
  // knip sees a command name in an execFileSync string and assumes it is a
  // bin it cannot account for. Suppressing the name is correct; adding an npm
  // package to satisfy it would be wrong.
  const binaries = knipConfig().ignoreBinaries || [];
  assert.ok(binaries.length > 0, 'the OS binaries knip cannot resolve need suppressing');
  for (const bin of binaries) {
    assert.equal(
      pkg().dependencies[bin],
      undefined,
      `${bin} is an OS tool — it must not be added as an npm dependency`
    );
  }
  // Spot-check two real call sites so the list can't drift into fiction.
  assert.match(read('app', 'api', 'jarvis', 'screen-capture', 'route.ts'), /'screencapture'/);
  assert.match(read('lib', 'system-info.ts'), /wmic|pmset/);
});