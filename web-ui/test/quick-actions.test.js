const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { resolve } = require('node:path')
const { JARVIS_QUICK_ACTIONS, TERMINAL_FEATURE_GROUPS, getJarvisQuickAction } = require('../lib/quick-actions')
const { shouldExecuteViaApi } = require('../lib/terminal-routing')

test('Jarvis quick actions resolve to deterministic tools', () => {
  assert.equal(getJarvisQuickAction('time').tool, 'get_time')
  assert.equal(getJarvisQuickAction('screenshot').tool, 'take_screenshot')
  assert.equal(new Set(JARVIS_QUICK_ACTIONS.map(action => action.id)).size, JARVIS_QUICK_ACTIONS.length)
})

test('GhostForge terminal shortcuts reference existing scripts', () => {
  const root = resolve(__dirname, '../..')
  const ghostforgeCommands = TERMINAL_FEATURE_GROUPS.flatMap(group => group.commands)
    .map(entry => entry.command.match(/^ghostforge\s+([\w-]+)/)?.[1])
    .filter(Boolean)

  for (const command of ghostforgeCommands) {
    assert.equal(existsSync(resolve(root, `scripts/${command}.sh`)), true, `${command} script should exist`)
  }
})

test('marketplace shortcut resolves its catalog from any working directory', () => {
  const marketplaceScript = require('node:fs').readFileSync(resolve(__dirname, '../../scripts/marketplace.sh'), 'utf8')
  assert.match(marketplaceScript, /CATALOG_PATH="\$CATALOG" node/)
  assert.match(marketplaceScript, /process\.env\.CATALOG_PATH/)
})

test('terminal shortcuts are complete, input-free commands', () => {
  const commands = TERMINAL_FEATURE_GROUPS.flatMap(group => group.commands.map(entry => entry.command))
  assert.equal(commands.some(command => command === 'ghostforge explain'), false)
  assert.equal(commands.some(command => command.includes('pr-description')), false)
  assert.equal(commands.some(command => command === 'ghostforge commit'), false)
  assert.equal(commands.every(shouldExecuteViaApi), true)
})

test('terminal quick commands bypass the interactive TUI session', () => {
  assert.equal(shouldExecuteViaApi('ghostforge carbon status'), true)
  assert.equal(shouldExecuteViaApi('git status --short'), true)
  assert.equal(shouldExecuteViaApi('gh pr status'), true)
  assert.equal(shouldExecuteViaApi('help'), false)
})
