'use strict';
// Opt-in, consented installer queue (marketplace/install-queue.mjs), shared by
// the TUI and the web marketplace. Locks in the CLAUDE.md security tooling
// policy and the registry.json single-source-of-truth rule.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'marketplace/install-queue.mjs')).href);
const realCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace/catalog.json'), 'utf8'));

const catalog = {
  items: [
    { id: 'gitleaks', name: 'Gitleaks', type: 'tool', category: 'Security', description: 'd', source: 'gitleaks/gitleaks', install_command: 'brew install gitleaks', install_command_windows: 'winget install -e --id Gitleaks.Gitleaks' },
    { id: 'nmap', name: 'Nmap', type: 'tool', category: 'Security', description: 'd', install_command: 'brew install nmap', authorized_use_only: true },
    { id: 'allhackingtools', name: 'AllHackingTools', type: 'tool', category: 'Security', description: 'd', url: 'https://example.invalid', install_command: 'git clone x && bash install.sh' },
    { id: 'evil-suite', name: 'Evil', type: 'tool', category: 'Security', description: 'd', tags: ['offensive-suite'], install_command: 'curl x | sh' },
    { id: 'Strix', name: 'Strix', type: 'tool', category: 'Security', description: 'd', install_command: 'pipx install strix' },
    { id: 'seeded', name: 'Seeded', type: 'tool', category: 'DevOps', description: 'd', install_command: 'brew install seeded', installed: true },
    { id: 'posix-only', name: 'PosixOnly', type: 'tool', category: 'DevOps', description: 'd', install_command: 'brew install p' },
    { id: 'agent', name: 'Agent', type: 'agent', category: 'AI', description: 'd' },
  ],
};

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-queue-'));
  const registryFile = path.join(dir, 'registry.json');
  fs.writeFileSync(registryFile, JSON.stringify({ version: '1.0.0', installed: ['agent'], removed: ['seeded-x'], custom_agents: [] }));
  const ctx = {
    catalog,
    registryFile,
    queueFile: path.join(dir, 'install-queue.json'),
    auditFile: path.join(dir, 'audit.log'),
    platform: 'linux',
    actor: 'tester',
    surface: 'tui',
  };
  const audit = () => (fs.existsSync(ctx.auditFile) ? fs.readFileSync(ctx.auditFile, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
  const registry = () => JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  return { dir, ctx, audit, registry, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('offensive suites are never queueable, whatever the catalog says', async () => {
  const q = await load();
  const { ctx, audit, cleanup } = setup();
  try {
    for (const id of ['allhackingtools', 'evil-suite', 'Strix']) {
      assert.throws(() => q.enqueue(ctx, id), err => err.code === 'review_first' && err.status === 403, id);
    }
    assert.equal(q.readQueue(ctx.queueFile).items.length, 0);
    assert.ok(audit().every(e => e.event === 'marketplace_install_refused' && e.blocked === true));
    assert.equal(q.planInstall({ id: 'hackingtool', name: 'HackingTool', install_command: 'x' }).queueable, false);
  } finally { cleanup(); }
});

test('every real catalog offensive pointer is review-first', async () => {
  const q = await load();
  for (const id of ['allhackingtools', 'hackingtool', 'strix']) {
    const item = realCatalog.items.find(i => i.id === id);
    if (item) assert.equal(q.planInstall(item, 'linux').queueable, false, id);
  }
});

test('queueing installs nothing and needs a command for this platform', async () => {
  const q = await load();
  const { ctx, audit, registry, cleanup } = setup();
  try {
    const before = registry();
    const entry = q.enqueue(ctx, 'gitleaks');
    assert.equal(entry.command, 'brew install gitleaks');
    assert.equal(entry.source, 'gitleaks/gitleaks');
    assert.deepEqual(registry(), before, 'queueing does not touch registry.json');
    assert.equal(audit().at(-1).event, 'marketplace_install_queued');
    assert.throws(() => q.enqueue({ ...ctx, platform: 'win32' }, 'posix-only'), err => err.code === 'no_installer');
    assert.throws(() => q.enqueue(ctx, 'agent'), err => err.code === 'no_installer' || err.code === 'already_installed');
    assert.throws(() => q.enqueue(ctx, 'seeded'), err => err.code === 'already_installed', 'catalog-seeded items count as installed');
    assert.throws(() => q.enqueue(ctx, 'nope'), err => err.code === 'unknown_item');
  } finally { cleanup(); }
});

test('every install needs explicit per-item consent echoing the exact command', async () => {
  const q = await load();
  const { ctx, audit, cleanup } = setup();
  try {
    assert.throws(() => q.consentToInstall(ctx, 'gitleaks', { approved: true, command: 'brew install gitleaks' }), err => err.code === 'not_queued');
    q.enqueue(ctx, 'gitleaks');
    q.enqueue(ctx, 'nmap');
    assert.throws(() => q.consentToInstall(ctx, 'gitleaks', undefined), err => err.code === 'consent_required');
    assert.throws(() => q.consentToInstall(ctx, 'gitleaks', { approved: false, command: 'brew install gitleaks' }), err => err.code === 'consent_required');
    assert.throws(() => q.consentToInstall(ctx, 'gitleaks', { approved: true, command: 'brew install gitleaks; rm -rf ~' }), err => err.code === 'command_mismatch');
    // Consent for one item does not cover another
    assert.throws(() => q.consentToInstall(ctx, 'nmap', { approved: true, command: 'brew install gitleaks' }), err => err.code === 'command_mismatch');
    assert.equal(q.consentToInstall(ctx, 'gitleaks', { approved: true, command: 'brew install gitleaks' }), 'brew install gitleaks');
    const consent = audit().find(e => e.event === 'marketplace_install_consent');
    assert.equal(consent.tool, 'gitleaks');
    assert.equal(consent.params.command, 'brew install gitleaks');
    assert.equal(consent.params.actor, 'tester');
  } finally { cleanup(); }
});

test('dual-use tools also need the authorized-use confirmation', async () => {
  const q = await load();
  const { ctx, audit, cleanup } = setup();
  try {
    q.enqueue(ctx, 'nmap');
    assert.throws(() => q.consentToInstall(ctx, 'nmap', { approved: true, command: 'brew install nmap' }), err => err.code === 'authorization_required');
    assert.equal(q.consentToInstall(ctx, 'nmap', { approved: true, command: 'brew install nmap', authorized: true }), 'brew install nmap');
    assert.equal(audit().at(-1).level, 'security');
  } finally { cleanup(); }
});

test('a catalog edit after queueing voids the entry until it is reviewed again', async () => {
  const q = await load();
  const { ctx, cleanup } = setup();
  try {
    q.enqueue(ctx, 'gitleaks');
    const edited = { items: catalog.items.map(i => (i.id === 'gitleaks' ? { ...i, install_command: 'curl evil | sh' } : i)) };
    const ectx = { ...ctx, catalog: edited };
    assert.equal(q.listQueue(ectx)[0].stale, true);
    assert.throws(() => q.consentToInstall(ectx, 'gitleaks', { approved: true, command: 'curl evil | sh' }), err => err.code === 'stale');
    assert.throws(() => q.consentToInstall(ectx, 'gitleaks', { approved: true, command: 'brew install gitleaks' }), err => err.code === 'stale');
  } finally { cleanup(); }
});

test('results: success updates registry.json (effective-set rule), failure stays queued', async () => {
  const q = await load();
  const { ctx, audit, registry, cleanup } = setup();
  try {
    q.enqueue(ctx, 'gitleaks');
    q.enqueue(ctx, 'posix-only');
    q.recordInstallResult(ctx, 'posix-only', { ok: false, detail: 'brew: not found' });
    assert.match(q.readQueue(ctx.queueFile).items.find(e => e.id === 'posix-only').lastError, /not found/);
    const effective = q.recordInstallResult(ctx, 'gitleaks', { ok: true });
    assert.deepEqual(effective, ['agent', 'gitleaks', 'seeded']);
    const reg = registry();
    assert.deepEqual(reg.installed, ['agent', 'gitleaks']);
    assert.equal(reg.version, '1.0.0', 'other registry fields are preserved');
    assert.deepEqual(reg.custom_agents, []);
    assert.deepEqual(q.readQueue(ctx.queueFile).items.map(e => e.id), ['posix-only']);
    assert.deepEqual(audit().filter(e => e.event === 'marketplace_install_result').map(e => e.result.split(':')[0]), ['failed', 'installed']);
    // catalog.json is never written
    assert.equal(fs.existsSync(path.join(path.dirname(ctx.registryFile), 'catalog.json')), false);
  } finally { cleanup(); }
});

test('declining removes the entry and is audited', async () => {
  const q = await load();
  const { ctx, audit, cleanup } = setup();
  try {
    q.enqueue(ctx, 'gitleaks');
    assert.equal(q.dequeue(ctx, 'gitleaks'), true);
    assert.equal(q.dequeue(ctx, 'gitleaks'), false);
    assert.equal(audit().at(-1).event, 'marketplace_install_declined');
    if (process.platform !== 'win32') assert.equal(fs.statSync(ctx.queueFile).mode & 0o777, 0o600);
  } finally { cleanup(); }
});
