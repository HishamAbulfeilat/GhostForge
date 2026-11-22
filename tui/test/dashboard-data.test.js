import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const data = require('../lib/dashboard-data.cjs');

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' },
  });
}

test('tag names from the repository are never run through a shell', t => {
  const repo = mkdtempSync(join(tmpdir(), 'gf-dash-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'a');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '-m', 'first');
  // Valid ref names that a shell would expand inside double quotes.
  const evil = ['v1$(touch${IFS}pwned-dollar)', 'v2`touch${IFS}pwned-tick`'];
  for (const tag of evil) git(repo, 'tag', '-a', tag, '-m', `notes for ${tag}`);
  git(repo, 'tag', 'v0.9');

  // The old dashboard ran these through execSync from the repo directory.
  const releases = data.fetchReleases(repo);

  assert.ok(!existsSync(join(repo, 'pwned-dollar')), '$( ) in a tag name was executed');
  assert.ok(!existsSync(join(repo, 'pwned-tick')), 'backticks in a tag name were executed');
  assert.ok(!existsSync(join(process.cwd(), 'pwned-dollar')));
  assert.deepEqual(releases.map(r => r.tag).sort(), [...evil, 'v0.9'].sort());
  const annotated = releases.find(r => r.tag === evil[0]);
  assert.equal(annotated.msg, `notes for ${evil[0]}`.substring(0, 35));
  assert.match(annotated.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(releases.find(r => r.tag === 'v0.9').msg, 'first');
});

test('fetchActivity and the gh fetchers use argument arrays with a timeout', () => {
  const calls = [];
  const run = (file, args, opts) => { calls.push({ file, args, opts }); return ''; };
  data.fetchActivity('/repo "$(x)"', run);
  data.fetchTickets('/repo', run);
  data.fetchPipelines('/repo', run);
  data.fetchOpenPRs('/repo', run);
  data.fetchReleases('/repo', run);
  for (const call of calls) {
    assert.ok(['git', 'gh'].includes(call.file), call.file);
    assert.ok(Array.isArray(call.args));
  }
  assert.deepEqual(calls[0].args.slice(0, 2), ['-C', '/repo "$(x)"']);
  assert.ok(data.EXEC_TIMEOUT_MS > 0 && data.EXEC_TIMEOUT_MS <= 30000);
});

test('the carbon monitor PID is validated and probed without a shell', () => {
  assert.equal(data.isPidRunning(String(process.pid)), true);
  assert.equal(data.isPidRunning(`${process.pid}\n`), true);
  for (const bad of ['', 'abc', '1; touch pwned', '$(id)', '-1', '0', '12 34', null]) {
    assert.equal(data.isPidRunning(bad), false, String(bad));
  }
});

test('dashboard.js and its data module contain no shell-string exec calls', () => {
  for (const file of ['../dashboard.js', '../lib/dashboard-data.cjs']) {
    const src = readFileSync(join(HERE, file), 'utf8');
    assert.doesNotMatch(src, /\bexecSync\s*\(/, `${file} uses execSync`);
    assert.doesNotMatch(src, /\bexec\s*\(\s*`/, `${file} builds a shell command from a template`);
    assert.doesNotMatch(src, /kill -0/, `${file} shells out to kill`);
  }
});
