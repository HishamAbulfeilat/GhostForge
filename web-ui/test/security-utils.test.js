const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

// lib/*.ts use extensionless relative imports; resolve them to the .ts file.
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw err
    }
  },
})

const { checkRateLimit, getClientIP } = require('../lib/ratelimit.ts')
const { assessRisk, behavioralScore, HIGH_RISK_TOOLS } = require('../lib/audit.ts')
const {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSIONS_BY_GROUP,
  permissionLabel,
  DEFAULT_USER_PERMISSIONS,
  ALL_PERMISSIONS,
} = require('../lib/permissions.ts')
const { TOOL_PERMISSION, permissionForTool, CHAT_BASELINE_PERMISSION } = require('../lib/tool-permissions.ts')

test.after(() => {
  hooks.deregister()
})

// ── ratelimit.ts ─────────────────────────────────────────────────────────────

test('checkRateLimit allows requests under the limit and decrements remaining', () => {
  const key = `rl-test-${Math.random()}`
  const first = checkRateLimit(key, 3, 60_000)
  assert.equal(first.allowed, true)
  assert.equal(first.remaining, 2)
  assert.equal(first.limit, 3)

  const second = checkRateLimit(key, 3, 60_000)
  assert.equal(second.allowed, true)
  assert.equal(second.remaining, 1)
})

test('checkRateLimit blocks once the limit is reached within the window', () => {
  const key = `rl-block-${Math.random()}`
  checkRateLimit(key, 2, 60_000)
  checkRateLimit(key, 2, 60_000)
  const third = checkRateLimit(key, 2, 60_000)
  assert.equal(third.allowed, false)
  assert.equal(third.remaining, 0)
  assert.ok(third.resetIn >= 0)
})

test('checkRateLimit tracks separate keys independently', () => {
  const a = `rl-a-${Math.random()}`
  const b = `rl-b-${Math.random()}`
  checkRateLimit(a, 1, 60_000)
  const blockedA = checkRateLimit(a, 1, 60_000)
  const allowedB = checkRateLimit(b, 1, 60_000)
  assert.equal(blockedA.allowed, false)
  assert.equal(allowedB.allowed, true)
})

test('getClientIP prefers x-real-ip, then req.ip, then rightmost x-forwarded-for, then cf-connecting-ip', () => {
  const header = (map) => ({ headers: { get: (k) => map[k] ?? null } })

  assert.equal(
    getClientIP(header({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' })),
    '1.1.1.1',
  )
  assert.equal(
    getClientIP({ ...header({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }), ip: '4.4.4.4' }),
    '4.4.4.4',
  )
  assert.equal(
    getClientIP(header({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' })),
    '3.3.3.3',
  )
  assert.equal(
    getClientIP(header({ 'cf-connecting-ip': '5.5.5.5' })),
    '5.5.5.5',
  )
  assert.equal(getClientIP(header({})), 'local')
})

// ── audit.ts risk assessment ─────────────────────────────────────────────────

test('assessRisk flags destructive shell patterns as danger', () => {
  const r = assessRisk('terminal_command', { command: 'sudo rm -rf /' })
  assert.equal(r.level, 'danger')
  assert.equal(r.risk, 95)
  assert.equal(r.requires_confirmation, true)
})

test('assessRisk warns on medium-risk shell patterns but allows low-risk ones through', () => {
  const warn = assessRisk('terminal_command', { command: 'npm uninstall left-pad' })
  assert.equal(warn.level, 'warn')
  assert.equal(warn.requires_confirmation, true)

  const safe = assessRisk('terminal_command', { command: 'ls -la' })
  assert.equal(safe.level, 'warn') // terminal_command always carries baseline risk
  assert.equal(safe.requires_confirmation, false)
})

test('assessRisk treats messaging tools and low-risk info tools as expected', () => {
  const msg = assessRisk('send_imessage', { to: 'friend', body: 'hi' })
  assert.equal(msg.requires_confirmation, false)
  assert.ok(msg.risk > 0)

  const info = assessRisk('get_time', {})
  assert.equal(info.level, 'safe')
  assert.equal(info.requires_confirmation, false)
})

test('HIGH_RISK_TOOLS includes the tools that require explicit confirmation gating', () => {
  assert.ok(HIGH_RISK_TOOLS.has('terminal_command'))
  assert.ok(HIGH_RISK_TOOLS.has('mac_control'))
  assert.ok(!HIGH_RISK_TOOLS.has('get_time'))
})

test('behavioralScore is neutral (100) without enough session history', () => {
  assert.equal(behavioralScore('hello there', null), 100)
  assert.equal(
    behavioralScore('hello there', { avgWordLen: 4, commonPhrases: [], queryPatterns: [], sessionCount: 2, lastSeen: '' }),
    100,
  )
})

test('behavioralScore penalizes a large average-word-length deviation from the profile', () => {
  const profile = { avgWordLen: 4, commonPhrases: [], queryPatterns: [], sessionCount: 10, lastSeen: '' }
  const closeMatch = behavioralScore('what time is it now', profile)
  const farMatch = behavioralScore('internationalization configurability extraordinary', profile)
  assert.ok(farMatch < closeMatch)
})

test('behavioralScore penalizes messages missing every known common phrase', () => {
  const profile = { avgWordLen: 4, commonPhrases: ['good morning', 'thanks jarvis'], queryPatterns: [], sessionCount: 10, lastSeen: '' }
  const withPhrase = behavioralScore('good morning, how is the weather', profile)
  const withoutPhrase = behavioralScore('completely unrelated text here', profile)
  assert.ok(withoutPhrase < withPhrase)
})

// ── permissions.ts ────────────────────────────────────────────────────────────

test('every permission key is unique and belongs to a declared group', () => {
  const keys = PERMISSIONS.map(p => p.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const p of PERMISSIONS) {
    assert.ok(PERMISSION_GROUPS.includes(p.group), `${p.key} has unknown group ${p.group}`)
  }
})

test('PERMISSIONS_BY_GROUP buckets every permission under its group', () => {
  for (const group of PERMISSION_GROUPS) {
    const bucket = PERMISSIONS_BY_GROUP[group] || []
    for (const p of bucket) assert.equal(p.group, group)
  }
  const total = Object.values(PERMISSIONS_BY_GROUP).reduce((n, arr) => n + arr.length, 0)
  assert.equal(total, PERMISSIONS.length)
})

test('permissionLabel resolves known keys and falls back to the raw key for unknown ones', () => {
  assert.equal(permissionLabel('chat'), 'JARVIS Chat')
  assert.equal(permissionLabel('not_a_real_permission'), 'not_a_real_permission')
})

test('DEFAULT_USER_PERMISSIONS and ALL_PERMISSIONS only reference real permission keys', () => {
  const known = new Set(ALL_PERMISSIONS)
  for (const key of DEFAULT_USER_PERMISSIONS) assert.ok(known.has(key), `unknown default permission ${key}`)
  assert.equal(ALL_PERMISSIONS.length, PERMISSIONS.length)
})

// ── tool-permissions.ts ───────────────────────────────────────────────────────

test('every TOOL_PERMISSION value maps to a permission that actually exists', () => {
  const known = new Set(ALL_PERMISSIONS)
  for (const [tool, perm] of Object.entries(TOOL_PERMISSION)) {
    assert.ok(known.has(perm), `tool "${tool}" maps to unknown permission "${perm}"`)
  }
})

test('permissionForTool resolves mapped tools and returns undefined for unmapped ones', () => {
  assert.equal(permissionForTool('terminal_command'), 'terminal')
  assert.equal(permissionForTool('not_a_real_tool'), undefined)
})

test('privileged tools are gated behind non-baseline permissions', () => {
  assert.equal(permissionForTool('get_time'), CHAT_BASELINE_PERMISSION)
  assert.notEqual(permissionForTool('terminal_command'), CHAT_BASELINE_PERMISSION)
  assert.notEqual(permissionForTool('mac_control'), CHAT_BASELINE_PERMISSION)
})
