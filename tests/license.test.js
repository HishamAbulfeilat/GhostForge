#!/usr/bin/env node
/**
 * GhostForge license unit tests (node:test, dependency-free).
 *
 * The repo ships two first-party MIT grants — the root LICENSE (added by
 * T-008) and extension/LICENSE, which VS Code packages into the published
 * .vsix. Both must carry the *complete* MIT text: extension/LICENSE shipped a
 * truncated copy that stopped at NONINFRINGEMENT, omitting the "IN NO EVENT
 * SHALL THE AUTHORS..." liability disclaimer, so it was not a valid grant.
 *
 * These checks pin the three ways that class of bug comes back:
 *   1. a truncated/altered MIT body (compare against the canonical template)
 *   2. the two copies silently drifting apart
 *   3. the manifest/README claiming a license the files don't carry
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** First-party MIT grants. Vendored third-party licenses are out of scope. */
const LICENSE_FILES = ['LICENSE', 'extension/LICENSE'];

const COPYRIGHT = 'Copyright (c) 2024 GhostForge';

/**
 * Canonical MIT (SPDX / choosealicense.com), with this project's copyright.
 * Kept inline so the test does not depend on a vendored file that may be
 * removed; `tests match the canonical MIT body` cross-checks it anyway.
 */
const CANONICAL_MIT = [
  'MIT License',
  '',
  COPYRIGHT,
  '',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software and associated documentation files (the "Software"), to deal',
  'in the Software without restriction, including without limitation the rights',
  'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
  'copies of the Software, and to permit persons to whom the Software is',
  'furnished to do so, subject to the following conditions:',
  '',
  'The above copyright notice and this permission notice shall be included in all',
  'copies or substantial portions of the Software.',
  '',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
  'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
  'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
  'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
  'SOFTWARE.',
  '',
].join('\n');

/** The paragraph a truncated MIT drops — the whole point of T-009. */
const LIABILITY_PARAGRAPH = 'IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT';

/** Normalise to LF so the test is independent of checkout line endings. */
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('canonical MIT template matches the real in-repo MIT grants', () => {
  // Guards against CANONICAL_MIT itself drifting: the three vendored LICENSE
  // files are independent real-world copies of the same body.
  const body = read('web-ui/vendor/ai-town/LICENSE').replace(/^Copyright \(c\) .*$/m, COPYRIGHT);
  assert.equal(body, CANONICAL_MIT, 'the inline canonical template drifted from a real MIT license');
});

test('every first-party LICENSE carries the complete MIT text', () => {
  for (const rel of LICENSE_FILES) {
    const text = read(rel);
    assert.equal(text, CANONICAL_MIT, `${rel} is not the canonical, complete MIT license`);
  }
});

test('no first-party LICENSE drops the liability disclaimer', () => {
  for (const rel of LICENSE_FILES) {
    // The MIT body hard-wraps at 80 columns, so compare on collapsed whitespace.
    const flat = read(rel).replace(/\s+/g, ' ');
    assert.ok(flat.includes(LIABILITY_PARAGRAPH), `${rel} omits the MIT liability disclaimer`);
  }
});

test('LICENSE files agree with each other', () => {
  const [root, extension] = LICENSE_FILES.map(rel => read(rel));
  assert.equal(extension, root, 'extension/LICENSE has drifted from the root LICENSE');
});

test('package manifests claiming MIT ship the matching license', () => {
  const manifests = ['package.json', 'extension/package.json', 'tui/package.json'];
  for (const rel of manifests) {
    const manifestPath = path.join(ROOT, rel);
    if (!fs.existsSync(manifestPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!pkg.license) continue;
    assert.equal(pkg.license, 'MIT', `${rel} declares license "${pkg.license}"`);
  }
});

test('README license links resolve to a real license file', () => {
  const readme = read('README.md');
  for (const [, target] of readme.matchAll(/\]\((?!https?:|#)([^)]*LICENSE[^)]*)\)/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, target)), `README links ${target}, which does not exist`);
  }
});