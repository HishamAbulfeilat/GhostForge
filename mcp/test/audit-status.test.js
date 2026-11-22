import assert from 'node:assert/strict';
import test from 'node:test';

import { auditFailure, buildHealthReport, npmInvocation, registerHealthTool, runNpmAudit } from '../tools/health.js';
import { buildSecurityReport, registerSecurityTool } from '../tools/security.js';

const ENOLOCK = {
  error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.', detail: 'Try creating one first with: npm i --package-lock-only' }
};
const CLEAN = { metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } };
const RISKY = { metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 2, critical: 0, total: 3 } } };

test('a failed npm audit is reported as unknown, never as ok / score 100', () => {
  for (const failed of [ENOLOCK, { error: 'spawn npm ENOENT' }, {}, { raw: 'x', error: 'Failed to parse npm audit output' }, null]) {
    const security = buildSecurityReport('/p', failed);
    assert.equal(security.ok, false);
    assert.equal(security.status, 'unknown');
    assert.ok(security.error);
    assert.equal(security.total, null);

    const health = buildHealthReport('/p', { exists: true }, failed);
    assert.equal(health.ok, false);
    assert.equal(health.status, 'unknown');
    assert.equal(health.score, null);
    assert.notEqual(health.summary, 'Healthy');
    assert.ok(health.error);
  }
  assert.match(auditFailure(ENOLOCK), /ENOLOCK/);
});

test('a successful audit still scores and grades the project', () => {
  assert.equal(auditFailure(CLEAN), null);
  assert.deepEqual(
    { ok: buildSecurityReport('/p', CLEAN).ok, status: buildSecurityReport('/p', CLEAN).status },
    { ok: true, status: 'ok' }
  );
  assert.equal(buildSecurityReport('/p', RISKY).status, 'warning');
  assert.equal(buildSecurityReport('/p', RISKY).total, 3);
  const health = buildHealthReport('/p', { exists: true }, RISKY);
  assert.equal(health.ok, true);
  assert.equal(health.score, 78);
  assert.equal(health.summary, 'Needs attention');
});

test('npm is started as npm.cmd through a fixed shell line on Windows only', async () => {
  assert.deepEqual(npmInvocation('win32'), { file: 'npm.cmd', shell: true });
  assert.deepEqual(npmInvocation('linux'), { file: 'npm', shell: false });
  assert.deepEqual(npmInvocation('darwin'), { file: 'npm', shell: false });

  const calls = [];
  const exec = async (file, args, opts) => {
    calls.push({ file, args, opts });
    return { stdout: JSON.stringify(CLEAN) };
  };
  assert.deepEqual(await runNpmAudit('C:\\proj "&calc"', { exec, platform: 'win32' }), CLEAN);
  assert.equal(calls[0].file, 'npm.cmd');
  assert.deepEqual(calls[0].args, ['audit', '--json']);
  assert.equal(calls[0].opts.shell, true);
  assert.equal(calls[0].opts.cwd, 'C:\\proj "&calc"');
});

test('runNpmAudit reads the JSON npm prints with a non-zero exit, and reports spawn errors', async () => {
  const exitOne = async () => { const e = new Error('exit 1'); e.stdout = JSON.stringify(RISKY); throw e; };
  assert.deepEqual(await runNpmAudit('/p', { exec: exitOne, platform: 'linux' }), RISKY);
  const missing = async () => { throw Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' }); };
  const result = await runNpmAudit('/p', { exec: missing, platform: 'linux' });
  assert.match(auditFailure(result), /ENOENT/);
});

test('the registered tools return the unknown status end to end', async () => {
  const tools = {};
  const server = { tool: (name, _desc, _schema, handler) => { tools[name] = handler; } };
  // A project with only package.json and no lockfile: npm audit fails (ENOLOCK)
  // or npm is unavailable; either way the result must not be "ok".
  const { mkdtempSync, rmSync, writeFileSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'gf-audit-')));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'nolock', version: '1.0.0' }));
    registerHealthTool(server, { repoRoot: root });
    registerSecurityTool(server, { repoRoot: root });
    const security = (await tools.security_scan({ projectPath: '.' })).structuredContent;
    assert.equal(security.ok, false);
    assert.equal(security.status, 'unknown');
    const health = (await tools.health_check({ projectPath: '.' })).structuredContent;
    assert.equal(health.ok, false);
    assert.equal(health.score, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
