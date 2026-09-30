const { existsSync } = require('node:fs')
const { resolve } = require('node:path')

const ROOT = resolve(__dirname, '..', '..')
const TEAM_SCRIPT = resolve(ROOT, 'scripts', 'agents', 'team.mjs')

const AGENT_TEAM_ACTIONS = Object.freeze(['start', 'stop', 'status', 'say', 'add_task'])

function validateAgentTeamAction(action, params = {}) {
  const name = String(action ?? params.action ?? '').trim().toLowerCase()
  if (!AGENT_TEAM_ACTIONS.includes(name)) {
    throw new Error(`Unsupported agent_team action: "${action || params.action || ''}". Allowed: ${AGENT_TEAM_ACTIONS.join(', ')}`)
  }

  const normalized = { ...params }
  if (name === 'status') return { action: name, params: {} }
  if (name === 'start' || name === 'stop') return { action: name, params: {} }

  if (name === 'say') {
    const from = String(normalized.from || normalized.sender || '').trim()
    const to = String(normalized.to || normalized.target || '').trim()
    const message = String(normalized.message || normalized.text || '').trim()
    if (!from || !to || !message) {
      throw new Error('agent_team say requires from, to, and message values')
    }
    return { action: name, params: { from, to, message } }
  }

  if (name === 'add_task') {
    const title = String(normalized.title || normalized.task || normalized.name || '').trim()
    if (!title) {
      throw new Error('agent_team add_task requires a title')
    }
    const kind = String(normalized.kind || 'feature').trim() || 'feature'
    const area = normalized.area
      ? Array.isArray(normalized.area)
        ? normalized.area
        : String(normalized.area).split(',').map(part => part.trim()).filter(Boolean)
      : []
    const from = String(normalized.from || normalized.sender || 'jarvis').trim() || 'jarvis'
    return {
      action: name,
      params: { title, kind, area, from },
    }
  }

  return { action: name, params: normalized }
}

function buildCliArgs(action, params) {
  const { action: command, params: normalized } = validateAgentTeamAction(action, params)
  switch (command) {
    case 'status':
      return ['status']
    case 'start':
      return ['start']
    case 'stop':
      return ['stop']
    case 'say':
      return ['say', '--from', normalized.from, '--to', normalized.to, normalized.message]
    case 'add_task': {
      const args = ['add', normalized.title, '--kind', normalized.kind]
      if (normalized.area.length) args.push('--area', normalized.area.join(','))
      args.push('--from', normalized.from)
      return args
    }
    default:
      return [command]
  }
}

function runAgentTeamCommand(action, params = {}, { cwd = ROOT, runner = require('node:child_process').spawnSync } = {}) {
  if (!existsSync(TEAM_SCRIPT)) {
    return { ok: false, output: 'Agent-team controls are unavailable: team.mjs was not found.' }
  }

  try {
    const args = buildCliArgs(action, params)
    const result = runner(process.execPath, [TEAM_SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
    return {
      ok: result.status === 0,
      output: output || (result.status === 0 ? 'Command completed.' : 'Agent-team command failed.'),
      code: result.status ?? null,
    }
  } catch (error) {
    return {
      ok: false,
      output: `Agent-team command failed: ${error.message}`,
      code: null,
    }
  }
}

module.exports = {
  AGENT_TEAM_ACTIONS,
  validateAgentTeamAction,
  runAgentTeamCommand,
}
