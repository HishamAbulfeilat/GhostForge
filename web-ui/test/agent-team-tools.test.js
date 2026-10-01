const test = require('node:test')
const assert = require('node:assert/strict')

const { AGENT_TEAM_ACTIONS, validateAgentTeamAction, runAgentTeamCommand } = require('../lib/agent-team.js')
const { permissionForTool } = require('../lib/tool-permissions.ts')

function hasPermission(user, key) {
  if (!user) return false
  if (user.role === 'admin') return true
  return Array.isArray(user.permissions) && user.permissions.includes(key)
}

test('agent-team actions are registered with the JARVIS tool catalog', () => {
  assert.deepEqual(AGENT_TEAM_ACTIONS, ['start', 'stop', 'status', 'say', 'add_task'])
  assert.equal(permissionForTool('agent_team'), 'admin_tools')
  assert.equal(hasPermission({ role: 'user', permissions: ['chat'] }, 'admin_tools'), false)
  assert.equal(hasPermission({ role: 'admin', permissions: [] }, 'admin_tools'), true)
})

test('agent-team validation rejects invalid input before dispatch', () => {
  assert.deepEqual(validateAgentTeamAction('start', {}), { action: 'start', params: {} })
  assert.deepEqual(validateAgentTeamAction('status', {}), { action: 'status', params: {} })
  assert.deepEqual(validateAgentTeamAction('say', { from: 'copilot', to: 'boss', message: 'hello' }), {
    action: 'say',
    params: { from: 'copilot', to: 'boss', message: 'hello' },
  })
  assert.deepEqual(validateAgentTeamAction('add_task', { title: 'Review PR', kind: 'refactor', area: ['web-ui', 'lib'], from: 'copilot' }), {
    action: 'add_task',
    params: { title: 'Review PR', kind: 'refactor', area: ['web-ui', 'lib'], from: 'copilot' },
  })
  assert.throws(() => validateAgentTeamAction('say', { from: 'copilot', to: 'boss' }), /requires from, to, and message values/)
  assert.throws(() => validateAgentTeamAction('add_task', { kind: 'feature' }), /requires a title/)
})

test('agent-team action dispatch routes through the local team interface', () => {
  const calls = []
  const result = runAgentTeamCommand('say', { from: 'copilot', to: 'all', message: 'hello' }, {
    runner: (...args) => {
      calls.push(args)
      return { status: 0, stdout: 'sent\n', stderr: '' }
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.output, 'sent')
  assert.equal(calls[0][0], process.execPath)
  assert.match(calls[0][1][0], /team\.mjs$/)
  assert.deepEqual(calls[0][1].slice(1), ['say', '--from', 'copilot', '--to', 'all', 'hello'])

  const addResult = runAgentTeamCommand('add_task', { title: 'Fix UI', area: 'web-ui,lib', from: 'copilot' }, {
    runner: (...args) => {
      calls.push(args)
      return { status: 0, stdout: 'queued\n', stderr: '' }
    },
  })
  assert.equal(addResult.ok, true)
  assert.equal(addResult.output, 'queued')
  assert.deepEqual(calls[1][1].slice(1), ['add', 'Fix UI', '--kind', 'feature', '--area', 'web-ui,lib', '--from', 'copilot'])
})
