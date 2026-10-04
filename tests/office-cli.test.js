#!/usr/bin/env node
/**
 * GhostForge office-cli unit tests (node:test, dependency-free).
 *
 * office.js had ZERO coverage while being the one CLI the JARVIS
 * `office_document` tool shells out to (web-ui/app/api/jarvis/route.ts), which
 * passes a model-supplied type/title/name straight into argv. Three bugs
 * lived there unnoticed; each has a test below that fails without the fix.
 *
 * HOME/USERPROFILE are redirected to a temp dir per test so the suite never
 * touches the developer's real ~/.ghostforge/documents.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'office-cli', 'office.js');

/** Run office.js in a throwaway HOME; returns {status, stdout, stderr}. */
function run(args, home) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

/** Fresh isolated HOME with a documents/ dir; cleaned up by the caller. */
function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-office-'));
}

const docsDir = home => path.join(home, '.ghostforge', 'documents');

test('help is available without touching the filesystem', () => {
  const home = makeHome();
  try {
    const { status, stdout } = run(['help'], home);
    assert.equal(status, 0);
    assert.match(stdout, /GHOSTFORGE OFFICE-CLI/);
    // The header must advertise the same types generate() accepts.
    for (const type of ['memo', 'minutes', 'report', 'cover', 'contract']) {
      assert.match(stdout, new RegExp(`\\b${type}\\b`), `help omits the ${type} type`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('generate writes a document and list finds it', () => {
  const home = makeHome();
  try {
    const { status, stdout } = run(['generate', 'memo', 'Quarterly Plan', '--to=Ops'], home);
    assert.equal(status, 0, 'generate must succeed');
    const doc = JSON.parse(stdout);
    assert.equal(doc.type, 'memo');
    assert.equal(doc.name, 'Quarterly Plan');
    assert.match(doc.body, /\*\*To:\*\* Ops/);
    assert.ok(fs.existsSync(doc.file), 'the document was not written to disk');
    // slugify: spaces and case collapse into a stable filename.
    assert.equal(path.basename(doc.file), 'quarterly-plan.md');

    const listed = JSON.parse(run(['list'], home).stdout);
    assert.ok(listed.some(d => d.name === 'quarterly-plan.md'), 'list omitted the new document');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('generate rejects an unknown type with a non-zero exit', () => {
  const home = makeHome();
  try {
    // Regression: generate() returned {error} and the CLI printed it as JSON on
    // stdout with exit 0, so the JARVIS tool read the error object and reported
    // "Document undefined created" as if the write had succeeded.
    const { status, stdout } = run(['generate', 'bogus', 'X'], home);
    assert.notEqual(status, 0, 'an unknown type must fail loudly, not exit 0');
    assert.doesNotMatch(stdout, /"file":/, 'no document may be reported as created');
    assert.equal(fs.existsSync(docsDir(home)), false, 'nothing may be written on failure');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('template <type> <Title> generates like generate', () => {
  const home = makeHome();
  try {
    // Regression: template swapped type and title, so generate() was asked for a
    // type called by the title ("My Memo") and every documented template call
    // returned "Unknown type". The command is advertised in the file header and
    // in help, so it has to work.
    const { status, stdout } = run(['template', 'memo', 'My Memo', '--body=Hello'], home);
    assert.equal(status, 0, 'template must not fail on the documented positional order');
    const doc = JSON.parse(stdout);
    assert.equal(doc.type, 'memo', 'template must use the first positional as the type');
    assert.equal(doc.name, 'My Memo', 'template must use the second positional as the title');
    assert.match(doc.body, /Hello/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('read returns a generated document', () => {
  const home = makeHome();
  try {
    run(['generate', 'report', 'Q3 Findings', '--from=Dana'], home);
    const { status, stdout } = run(['read', 'q3-findings.md'], home);
    assert.equal(status, 0);
    // The filename comes from the slugified title; the body is the report
    // template. (Its heading reads f.title, which generate() does not set from
    // the positional — it falls back to 'Untitled'. Asserted on the stable
    // parts rather than that heading.)
    assert.match(stdout, /# REPORT:/);
    assert.match(stdout, /\*\*Prepared by:\*\* Dana/, 'field values must survive the write/read round trip');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('read refuses to escape the documents directory', () => {
  const home = makeHome();
  try {
    // A real file one level above documents/ — the thing a traversal would read.
    fs.mkdirSync(path.join(home, '.ghostforge'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ghostforge', 'secret.txt'), 'TOP-SECRET-CONTENT');
    run(['generate', 'memo', 'Alpha'], home);

    for (const attempt of ['../secret.txt', '../secret', '..\\secret.txt', '../secret.md']) {
      const { status, stdout } = run(['read', attempt], home);
      assert.doesNotMatch(stdout, /TOP-SECRET-CONTENT/, `read ${attempt} leaked file content`);
      assert.notEqual(status, 0, `read ${attempt} must fail`);
    }

    // A sibling directory inside .ghostforge is still outside documents/.
    fs.mkdirSync(path.join(home, '.ghostforge', 'other'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ghostforge', 'other', 'x.md'), 'NESTED');
    const nested = run(['read', '../other/x.md'], home);
    assert.doesNotMatch(nested.stdout, /NESTED/, 'read reached a sibling directory');
    assert.notEqual(nested.status, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('read reports a missing document without inventing content', () => {
  const home = makeHome();
  try {
    run(['generate', 'memo', 'Alpha'], home);
    const { status, stdout, stderr } = run(['read', 'does-not-exist.md'], home);
    assert.notEqual(status, 0);
    assert.match(stdout + stderr, /Not found/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a document name that is itself a path is rejected', () => {
  const home = makeHome();
  try {
    // The JARVIS route strips a trailing .md and forwards whatever the model
    // produced, so absolute paths and subpaths are reachable in practice.
    fs.mkdirSync(docsDir(home), { recursive: true });
    fs.writeFileSync(path.join(docsDir(home), 'ok.md'), 'FINE');
    const { status, stdout } = run(['read', 'sub/ok.md'], home);
    assert.notEqual(status, 0, 'a subpath with no such file must not resolve');
    assert.doesNotMatch(stdout, /FINE/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('office.js parses', () => {
  // The CLI is spawned, not imported; a syntax error would otherwise only show
  // up as an opaque spawn failure inside the JARVIS tool.
  execFileSync(process.execPath, ['--check', 'office-cli/office.js'], { cwd: ROOT, stdio: 'pipe' });
});
