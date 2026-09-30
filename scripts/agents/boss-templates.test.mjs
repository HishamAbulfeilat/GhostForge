// Unit tests for agent team templates (run: node --test scripts/agents/boss-templates.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_TEMPLATE,
  applyTemplateConfig,
  listTemplateNames,
  loadTemplate,
  parseArgs,
  resolveTemplateName,
} from './boss.mjs'

test('template list exposes the supported presets and a clear default', () => {
  assert.equal(DEFAULT_TEMPLATE, 'pair')
  assert.deepEqual(listTemplateNames(), ['pair', 'reviewer-heavy', 'trio'])
  assert.equal(resolveTemplateName('default'), 'pair')
  assert.equal(resolveTemplateName('reviewer_heavy'), 'reviewer-heavy')
  assert.equal(resolveTemplateName('pair'), 'pair')
  assert.equal(loadTemplate('trio').name, 'trio')
})

test('parseArgs validates and accepts template selection on either side of the command', () => {
  assert.deepEqual(parseArgs(['start', '--template', 'trio']), { command: 'start', template: 'trio', extras: [] })
  assert.deepEqual(parseArgs(['--template=reviewer-heavy', 'once']), { command: 'once', template: 'reviewer-heavy', extras: [] })
  assert.equal(parseArgs(['--template', 'pair']).template, 'pair')
})

test('invalid template names fail with the known choices', () => {
  assert.throws(() => resolveTemplateName('unknown-template'), /Unknown agent team template "unknown-template"/)
  assert.throws(() => resolveTemplateName('bad'), /pair.*reviewer-heavy.*trio/)
})

test('template selection applies only to a cloned config', () => {
  const base = {
    agents: {
      copilot: { enabled: true },
      'copilot-qa': { enabled: true },
      'copilot-security': { enabled: true },
      'copilot-perf': { enabled: true },
      'copilot-design': { enabled: true },
      claude: { enabled: true },
    },
  }

  const pair = applyTemplateConfig(base, 'pair')
  assert.equal(pair.agents.copilot.enabled, true)
  assert.equal(pair.agents['copilot-qa'].enabled, true)
  assert.equal(pair.agents['copilot-security'].enabled, false)
  assert.equal(pair.agents['copilot-perf'].enabled, false)
  assert.equal(pair.agents['copilot-design'].enabled, false)
  assert.equal(base.agents['copilot-security'].enabled, true, 'input config is unchanged')
  assert.equal(base.agents['copilot-perf'].enabled, true)

  const trio = applyTemplateConfig(base, 'trio')
  assert.equal(trio.agents['copilot-qa'].enabled, true)
  assert.equal(trio.agents['copilot-security'].enabled, true)
  assert.equal(trio.agents['copilot-perf'].enabled, false)
  assert.equal(trio.template.name, 'trio')
})

test('a template never invents agents team.json does not define (they would have no worktree)', () => {
  const cfg = applyTemplateConfig({ agents: { claude: { enabled: true, worktree: '../gf-claude' } } }, 'pair')
  assert.equal('copilot' in cfg.agents, false)
  assert.equal('copilot-qa' in cfg.agents, false)
  assert.equal(parseArgs(['start']).template, null, 'no --template → team.json roster as-is')
})
