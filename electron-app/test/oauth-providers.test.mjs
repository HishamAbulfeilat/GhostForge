import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { OAUTH_PROVIDERS, assertOAuthProvider, unsupportedOperation } from '../dist/main/oauth-providers.js'

test('only implemented OAuth providers are accepted', () => {
  assert.doesNotThrow(() => assertOAuthProvider('email', 'gmail'))
  assert.doesNotThrow(() => assertOAuthProvider('calendar', 'google'))
  assert.doesNotThrow(() => assertOAuthProvider('contacts', 'google'))
})

test('outlook (and junk) is rejected with a clear unsupported error', () => {
  for (const domain of Object.keys(OAUTH_PROVIDERS)) {
    for (const bad of ['outlook', '', undefined, null, 42, {}]) {
      assert.throws(() => assertOAuthProvider(domain, bad), /Unsupported .* OAuth provider/)
    }
    assert.throws(() => assertOAuthProvider(domain, 'outlook'), /Supported: (gmail|google)/)
  }
})

test('unsupported operations produce a consistent message', () => {
  assert.match(unsupportedOperation('Star', 'outlook').message, /Star is not supported for the outlook provider/)
})

test('preload types do not advertise outlook OAuth', () => {
  const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
  for (const line of preload.split(/\r?\n/).filter(l => /oauth(Start|Callback)/.test(l))) {
    assert.doesNotMatch(line, /outlook/)
  }
})

test('main process has no "not implemented" throws left in the integrations', () => {
  for (const f of ['email', 'calendar', 'contacts']) {
    const src = readFileSync(new URL(`../src/main/${f}-integration.ts`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /not implemented/i, f)
  }
})
