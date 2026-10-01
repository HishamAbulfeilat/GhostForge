import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatResult, parseArgs, request, resolveBaseUrl, sessionHeaders } from './users.mjs'

const cliPath = fileURLToPath(new URL('./users.mjs', import.meta.url))
const USER_ID = 'u_0123456789ab'

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => JSON.stringify(data),
  }
}

test('CLI help is available without credentials or network access', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stdout, /GF_SESSION_TOKEN/)
  assert.match(result.stdout, /owner only/)
})

test('parses user listing and access updates', () => {
  assert.deepEqual(parseArgs(['list', '--json']), {
    command: 'list', userId: '', role: undefined, active: undefined, permissions: undefined, json: true,
  })
  assert.deepEqual(parseArgs([
    'update', USER_ID, '--role', 'user', '--active', 'false', '--permissions', 'chat,admin_tools',
  ]), {
    command: 'update', userId: USER_ID, role: 'user', active: false, permissions: ['chat', 'admin_tools'], json: false,
  })
  assert.deepEqual(parseArgs(['update', USER_ID, '--permissions', 'none']).permissions, [])
})

test('rejects malformed or ambiguous update arguments', () => {
  assert.throws(() => parseArgs(['update', '../admin', '--role', 'admin']), /User ID/)
  assert.throws(() => parseArgs(['update', USER_ID]), /at least one/)
  assert.throws(() => parseArgs(['update', USER_ID, '--role', 'owner']), /admin or user/)
  assert.throws(() => parseArgs(['update', USER_ID, '--active', 'yes']), /true or false/)
  assert.throws(() => parseArgs(['update', USER_ID, '--permissions', 'chat,,files']), /permission keys/)
  assert.throws(() => parseArgs(['update', USER_ID, '--role', 'user', '--role', 'admin']), /only be provided once/)
  assert.throws(() => parseArgs(['list', '--permissions', 'chat']), /Unknown option/)
})

test('remote API hosts require explicit opt-in and session tokens are encoded as cookies', () => {
  assert.throws(() => resolveBaseUrl({ GF_WEB_UI_URL: 'https://example.test' }), /not loopback/)
  assert.equal(
    resolveBaseUrl({ GF_WEB_UI_URL: 'https://example.test', GF_ALLOW_REMOTE_WEB_UI: '1' }),
    'https://example.test',
  )
  assert.deepEqual(sessionHeaders({ GF_SESSION_TOKEN: 'token value' }), {
    Cookie: 'gf_token=token%20value',
  })
  assert.throws(() => sessionHeaders({}), /GF_SESSION_TOKEN is required/)
  assert.throws(() => sessionHeaders({ GF_SESSION_TOKEN: 'token\r\nvalue' }), /invalid characters/)
})

test('list uses the authenticated GET /api/users contract and formats its response', async () => {
  let call
  const result = await request(
    { command: 'list' },
    { GF_SESSION_TOKEN: 'session-token' },
    async (url, init) => {
      call = { url, init }
      return jsonResponse({
        users: [{ id: USER_ID, username: 'sara', role: 'user', active: true, owner: false }],
        canManage: true,
      })
    },
  )

  assert.equal(call.url, 'http://127.0.0.1:3000/api/users')
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.headers.Cookie, 'gf_token=session-token')
  assert.match(formatResult({ command: 'list' }, result), /sara \(u_0123456789ab\).*user, active/)
})

test('update sends only selected access fields through PATCH /api/users', async () => {
  let call
  const result = await request(
    { command: 'update', userId: USER_ID, role: 'admin', permissions: ['chat'] },
    { GF_SESSION_TOKEN: 'session-token' },
    async (url, init) => {
      call = { url, init }
      return jsonResponse({
        user: { id: USER_ID, username: 'sara', role: 'admin', active: true, permissions: ['chat'] },
      })
    },
  )

  assert.equal(call.url, 'http://127.0.0.1:3000/api/users')
  assert.equal(call.init.method, 'PATCH')
  assert.equal(call.init.headers.Cookie, 'gf_token=session-token')
  assert.deepEqual(JSON.parse(call.init.body), { id: USER_ID, role: 'admin', permissions: ['chat'] })
  assert.match(formatResult({ command: 'update' }, result), /Updated sara .*admin, active, permissions=chat/)
})

test('API failures include status and server message; malformed successful responses fail clearly', async () => {
  await assert.rejects(
    request(
      { command: 'list' },
      { GF_SESSION_TOKEN: 'session-token' },
      async () => jsonResponse({ error: 'Only the owner can manage users' }, 403),
    ),
    /403: Only the owner can manage users/,
  )
  await assert.rejects(
    request({ command: 'list' }, { GF_SESSION_TOKEN: 'session-token' }, async () => jsonResponse({})),
    /did not include a users list/,
  )
})
