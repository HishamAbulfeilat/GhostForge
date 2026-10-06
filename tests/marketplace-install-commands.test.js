#!/usr/bin/env node
/**
 * Cross-platform install-command tests (node:test, dependency-free).
 *
 * These lock in the T-002 invariants so a future catalog edit cannot quietly
 * reintroduce a Windows user being handed a POSIX one-liner:
 *
 *   1. On win32 the resolver NEVER returns a command containing a
 *      POSIX-only tool (brew / apt-get / sudo / pip3 / python3 …).
 *   2. Every winget command is `-e --id Publisher.Id` (exact match, so an
 *      ambiguous search can't install the wrong package).
 *   3. A POSIX command never contains a Windows-only tool (winget), which
 *      would mean the two platforms' fields had been swapped.
 *   4. Commands never end in `|| echo …` / `|| true` — those exit 0, so the
 *      TUI marked the item installed even though nothing was installed.
 *   5. Items with a real installer expose one on every platform the upstream
 *      supports (i.e. the Windows gap is deliberate, not accidental).
 *
 * The resolver itself (marketplace/install-commands.mjs) is exercised through
 * its exported API, which is the same one the TUI and scripts/marketplace.sh use.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace/catalog.json'), 'utf8'));

// ESM resolver — load it through dynamic import from this CommonJS test file.
let resolver;
const resolverPath = path.join(ROOT, 'marketplace/install-commands.mjs');

/**
 * Tools that only exist on a POSIX shell; running them on Windows cannot work.
 * `pip`/`python` are deliberately absent — those are the Windows launcher names
 * too (`pip install x` and `py -3` are the correct Windows spellings). It is
 * `pip3`/`python3` that are POSIX-only.
 */
const POSIX_ONLY = /\b(brew|sudo|apt-get|apt|pipx|pip3|python3|curl|wget|xargs)\b/;
/** Tools that only exist on Windows. */
const WINDOWS_ONLY = /\bwinget\b/;

/** Items that legitimately ship no Windows installer (upstream has none). */
const NO_WINDOWS_INSTALLER = new Set(['localai', 'openjarvis']);

test.before(async () => {
  resolver = await import(require('url').pathToFileURL(resolverPath).href);
});

test('resolver returns the platform command and never a POSIX one on Windows', () => {
  for (const item of catalog.items) {
    // Items with no install_command at all are in-app agents/skills — nothing to
    // install. Only items that declare a POSIX installer are expected to have a
    // Windows counterpart (or be on the deliberate-exception list).
    if (!item.install_command) continue;
    const win = resolver.resolveInstallCommand(item, 'win32');
    if (win === null) {
      assert.ok(
        NO_WINDOWS_INSTALLER.has(item.id),
        `${item.id} has no Windows command but is not on the known no-installer list; ` +
          `add a verified install_command_windows or move it to NO_WINDOWS_INSTALLER`
      );
      continue;
    }
    assert.ok(
      !POSIX_ONLY.test(win),
      `${item.id} would run a POSIX-only command on Windows: ${win}`
    );
  }
});

test('POSIX commands never contain Windows-only tooling', () => {
  for (const item of catalog.items) {
    const posix = resolver.resolveInstallCommand(item, 'linux');
    if (posix) {
      assert.ok(
        !WINDOWS_ONLY.test(posix),
        `${item.id} POSIX command uses winget: ${posix}`
      );
    }
  }
});

test('macOS and Linux resolve to the same command', () => {
  for (const item of catalog.items) {
    assert.equal(
      resolver.resolveInstallCommand(item, 'darwin'),
      resolver.resolveInstallCommand(item, 'linux'),
      `${item.id} resolves differently on macOS and Linux`
    );
  }
});

test('every winget command uses an exact publisher.id match', () => {
  for (const item of catalog.items) {
    const win = item.install_command_windows;
    if (!win || !WINDOWS_ONLY.test(win)) continue;
    assert.match(
      win,
      /^winget install --id [\w.-]+ -e$/,
      `${item.id} winget command must be an exact --id <publisher.id> match: ${win}`
    );
  }
});

test('no install command ends in a clause that always exits 0', () => {
  // `cmd || echo 'see the site'` succeeds even when the install failed, so the
  // TUI printed "installed successfully" and wrote registry.json. Match the
  // echo with any trailing quoted argument, not just end-of-string.
  const swallowsFailure = /(\|\|\s*(echo|true|:)\b)|(\|\|\s*:\s)/;
  for (const item of catalog.items) {
    for (const key of ['install_command', 'install_command_windows']) {
      const cmd = item[key];
      if (typeof cmd !== 'string') continue;
      assert.ok(
        !swallowsFailure.test(cmd),
        `${item.id}.${key} swallows failure with a trailing || echo/true: ${cmd}`
      );
    }
  }
});

test('items with a POSIX installer but no Windows one link out for manual setup', () => {
  for (const item of catalog.items) {
    if (!item.install_command) continue;
    if (resolver.hasInstallCommandForPlatform(item, 'win32')) continue;
    assert.ok(
      item.url || item.file,
      `${item.id} has no Windows installer and no url/file to fall back to`
    );
  }
});

test('explainMissingCommand only produces a hint when there is no command', () => {
  for (const item of catalog.items) {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const hint = resolver.explainMissingCommand(item, platform);
      if (hint !== null) {
        assert.equal(
          resolver.resolveInstallCommand(item, platform),
          null,
          `${item.id}: got a "no installer" hint on ${platform} but a command exists`
        );
      }
    }
  }
});

test('resolver tolerates malformed input instead of throwing', () => {
  assert.equal(resolver.resolveInstallCommand(null), null);
  assert.equal(resolver.resolveInstallCommand(undefined), null);
  assert.equal(resolver.resolveInstallCommand({}), null);
  assert.equal(resolver.resolveInstallCommand({ install_command: '   ' }, 'linux'), null);
  assert.equal(resolver.resolveInstallCommand({ install_command: 42 }, 'linux'), null);
});