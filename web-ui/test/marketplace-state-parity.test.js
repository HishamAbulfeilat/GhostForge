'use strict'
// The web UI (lib/marketplace-state.ts) and the TUI (tui/lib/marketplace-state.js)
// read the same registry.json. They must compute the same installed and marked
// sets, and migrate generated objects out of installed[] the same way, or one
// surface hides tools the other never installed (review items #10/#11).

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const web = require('../lib/marketplace-state.ts')
const tuiPath = path.resolve(__dirname, '../../tui/lib/marketplace-state.js')

const generatedCmd = { id: 'my-cmd', type: 'command', name: 'My cmd', file: 'commands/my-cmd.md', createdAt: '2026-11-01T00:00:00Z' }
const generatedAgent = { id: 'my-agent', type: 'agent', name: 'My agent', file: 'agents/my-agent.md', createdAt: '2026-11-02T00:00:00Z' }

const FIXTURES = {
  'mixed registry': {
    catalog: {
      items: [
        { id: 'semgrep' }, { id: 'trivy' }, { id: 'gitleaks' },
        { id: 'seeded', installed: true }, { id: 'seeded-removed', installed: true },
        null, { name: 'no id' }, { id: 42 },
      ],
    },
    registry: {
      version: '1.0.0',
      installed: ['trivy', generatedCmd, 'trivy', '', null, 'web-old-mark', 'removed-too'],
      marked: ['semgrep', 'trivy', 'removed-too', 7],
      removed: ['seeded-removed', 'removed-too', null],
      generated: [generatedAgent, 'bad'],
      custom_agents: [{ name: 'x' }],
    },
  },
  'legacy file (no marked/generated)': {
    catalog: { items: [{ id: 'a' }, { id: 'b', installed: true }] },
    registry: { installed: ['a', generatedCmd], removed: [] },
  },
  'empty / malformed': {
    catalog: { items: 'nope' },
    registry: { installed: 'nope', marked: null },
  },
  'missing registry': {
    catalog: { items: [{ id: 'a', installed: true }] },
    registry: undefined,
  },
}

test('web and TUI compute the same effective installed and marked sets', async () => {
  const tui = await import(tuiPath)
  for (const [name, { catalog, registry }] of Object.entries(FIXTURES)) {
    assert.deepEqual(
      web.computeEffectiveMarketplaceIds(catalog, registry),
      tui.computeEffectiveMarketplaceIds(catalog, registry),
      `${name}: installed sets differ`,
    )
    assert.deepEqual(
      web.computeMarkedMarketplaceIds(catalog, registry),
      tui.computeMarkedMarketplaceIds(catalog, registry),
      `${name}: marked sets differ`,
    )
    assert.deepEqual(web.normalizeRegistry(registry), tui.normalizeRegistry(registry), `${name}: normalized registry differs`)
  }
})

test('the shared rules on the mixed fixture', () => {
  const { catalog, registry } = FIXTURES['mixed registry']
  assert.deepEqual(web.computeEffectiveMarketplaceIds(catalog, registry), ['seeded', 'trivy', 'web-old-mark'])
  // trivy is really installed, removed-too is removed: neither counts as marked.
  assert.deepEqual(web.computeMarkedMarketplaceIds(catalog, registry), ['semgrep'])
  const normalized = web.normalizeRegistry(registry)
  assert.ok(normalized.installed.every(id => typeof id === 'string'))
  assert.deepEqual(normalized.generated, [generatedAgent, generatedCmd])
  assert.deepEqual(normalized.custom_agents, [{ name: 'x' }])
})

test('mark/remove helpers agree between web and TUI', async () => {
  const tui = await import(tuiPath)
  const { registry } = FIXTURES['mixed registry']
  assert.deepEqual(web.recordMarked(registry, 'gitleaks'), tui.recordMarked(registry, 'gitleaks'))
  assert.deepEqual(web.recordRemoved(registry, 'trivy', false), tui.recordRemoved(registry, 'trivy', false))
  assert.deepEqual(web.recordRemoved(registry, 'seeded', true), tui.recordRemoved(registry, 'seeded', true))
})
