import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getBridgeAuthHeaders, getHealthEndpoint, resolveBridgeToken } from '../dist/main/bridge-auth.js'
import { getTranscript } from '../dist/main/youtube.js'

test('Mark-L token prefers MARKL_BRIDGE_TOKEN over the token file', () => {
  const token = resolveBridgeToken(
    { MARKL_BRIDGE_TOKEN: ' env-token ', WS_BRIDGE_TOKEN: 'wrong-token' },
    () => 'file-token'
  )
  assert.equal(token, 'env-token')
  assert.deepEqual(
    getBridgeAuthHeaders({ MARKL_BRIDGE_TOKEN: 'env-token' }, () => 'file-token'),
    { Authorization: 'Bearer env-token' }
  )
})

test('Mark-L token falls back to the bridge token file without WS override', () => {
  assert.equal(
    resolveBridgeToken({ WS_BRIDGE_TOKEN: 'wrong-token' }, () => ' file-token '),
    'file-token'
  )
})

test('health endpoint selection keeps generic JARVIS discovery separate from Mark-L', () => {
  assert.equal(getHealthEndpoint('http://localhost:8765/', 'jarvis'), 'http://localhost:8765/health')
  assert.equal(
    getHealthEndpoint('http://localhost:8765/', 'mark-l'),
    'http://localhost:8765/api/mark-l/health'
  )
})

test('YouTube transcript behavior still forwards the video id to the bridge', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, init) => {
    request = { url, init }
    return new Response(JSON.stringify({ transcript: [{ text: 'hello', start: 0, duration: 1 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    assert.deepEqual(
      await getTranscript('https://www.youtube.com/watch?v=abcdefghijk'),
      [{ text: 'hello', start: 0, duration: 1 }]
    )
    assert.equal(request.url, 'http://localhost:8765/transcript')
    assert.deepEqual(JSON.parse(request.init.body), { video_id: 'abcdefghijk' })
  } finally {
    globalThis.fetch = originalFetch
  }
})
