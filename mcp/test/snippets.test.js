import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { registerSnippetTools, resolveSnippetPath } from '../tools/snippets.js';

function setup(t) {
  const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'gf-snippets-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repoRoot = path.join(base, 'repo');
  const snippets = path.join(repoRoot, 'snippets');
  mkdirSync(snippets, { recursive: true });
  writeFileSync(path.join(snippets, 'api-hook.md'), '# hook');
  writeFileSync(path.join(repoRoot, 'README.md'), '# repo readme');
  mkdirSync(path.join(base, 'private'));
  writeFileSync(path.join(base, 'private', 'notes.md'), 'secret notes');
  const tools = {};
  registerSnippetTools({ tool: (name, _d, _s, handler) => { tools[name] = handler; } }, { repoRoot });
  return { base, snippets, getSnippet: async name => (await tools.get_snippet({ name })).structuredContent };
}

test('get_snippet returns snippets inside snippets/', async t => {
  const { getSnippet } = setup(t);
  for (const name of ['api-hook', 'api-hook.md']) {
    const res = await getSnippet(name);
    assert.equal(res.ok, true, name);
    assert.equal(res.content, '# hook');
  }
});

test('get_snippet refuses names that leave snippets/', async t => {
  const { getSnippet, base } = setup(t);
  for (const name of [
    '../README',
    '../README.md',
    '../../private/notes',
    path.join(base, 'private', 'notes'),
    'sub/../../README',
    '..\\README',
    '.hidden',
    '',
  ]) {
    const res = await getSnippet(name);
    assert.equal(res.ok, false, `${name} should be refused`);
    assert.equal(res.content, undefined);
  }
});

test('a symlink inside snippets/ that points outside is refused', async t => {
  const { getSnippet, snippets, base } = setup(t);
  try {
    symlinkSync(path.join(base, 'private', 'notes.md'), path.join(snippets, 'leak.md'), 'file');
  } catch {
    t.skip('symlinks unavailable');
    return;
  }
  assert.equal((await getSnippet('leak')).ok, false);
  assert.equal(resolveSnippetPath(snippets, 'leak'), null);
});
