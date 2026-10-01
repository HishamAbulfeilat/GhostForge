import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import { getPackageInfo, resolveProjectPath } from '../tools/health.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const realRepoRoot = realpathSync.native(repoRoot);

// Junctions need no extra privileges on Windows; elsewhere use plain dir links.
function linkDir(target, linkPath) {
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function makeSandbox(t) {
  const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'gf-health-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  mkdirSync(path.join(root, 'inner'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: 'outside-secret' }));
  writeFileSync(path.join(root, 'inner', 'package.json'), JSON.stringify({ name: 'inner', version: '1.0.0' }));
  return { base, root, outside };
}

test('resolveProjectPath accepts paths inside the allowed workspace root', () => {
  assert.equal(resolveProjectPath('.', repoRoot), realRepoRoot);
  assert.equal(resolveProjectPath('mcp', repoRoot), path.join(realRepoRoot, 'mcp'));
});

test('resolveProjectPath rejects traversal outside the allowed workspace root', () => {
  assert.throws(() => resolveProjectPath('../', repoRoot), /escapes the allowed workspace root/);
  assert.throws(() => resolveProjectPath('../../../../etc', repoRoot), /escapes the allowed workspace root/);
  assert.throws(() => resolveProjectPath('/tmp', repoRoot), /escapes the allowed workspace root/);
  assert.throws(() => resolveProjectPath('mcp/../../', repoRoot), /escapes the allowed workspace root/);
});

test('resolveProjectPath rejects a symlink inside the root that targets an external directory', (t) => {
  const { root, outside } = makeSandbox(t);
  linkDir(outside, path.join(root, 'escape'));

  assert.throws(() => resolveProjectPath('escape', root), /escapes the allowed workspace root/);
  assert.throws(() => resolveProjectPath('escape/nested/missing', root), /escapes the allowed workspace root/);
});

test('resolveProjectPath allows symlinks that stay inside the root', (t) => {
  const { root } = makeSandbox(t);
  linkDir(path.join(root, 'inner'), path.join(root, 'alias'));

  assert.equal(resolveProjectPath('alias', root), path.join(root, 'inner'));
  assert.equal(resolveProjectPath('inner/not-yet-created', root), path.join(root, 'inner', 'not-yet-created'));
});

test('resolveProjectPath works when the allowed root itself is reached through a symlink', (t) => {
  const { base, root } = makeSandbox(t);
  const rootLink = path.join(base, 'root-link');
  linkDir(root, rootLink);

  assert.equal(resolveProjectPath('.', rootLink), root);
  assert.equal(resolveProjectPath('inner', rootLink), path.join(root, 'inner'));
  assert.deepEqual(getPackageInfo(path.join(root, 'inner'), rootLink), {
    exists: true,
    name: 'inner',
    version: '1.0.0',
    scripts: []
  });
});

test('getPackageInfo refuses a package.json symlinked outside the root', (t) => {
  const { root, outside } = makeSandbox(t);
  const project = path.join(root, 'linked-pkg');
  mkdirSync(project);
  try {
    symlinkSync(path.join(outside, 'package.json'), path.join(project, 'package.json'), 'file');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('file symlinks need Developer Mode or admin rights on Windows');
      return;
    }
    throw error;
  }

  const info = getPackageInfo(resolveProjectPath('linked-pkg', root), root);
  assert.equal(info.invalid, true);
  assert.equal(info.name, undefined);
});
