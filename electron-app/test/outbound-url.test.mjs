import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateOutboundUrl } from '../dist/main/outbound-url.js'

test('credential destinations require an allowlisted host and default port', () => {
  assert.equal(
    validateOutboundUrl(
      'https://api.github.com/repos/example/project',
      ['api.github.com'],
      'GitHub API',
    ).hostname,
    'api.github.com',
  )
  assert.throws(
    () => validateOutboundUrl('https://api.github.com:8443/repos/example/project', ['api.github.com'], 'GitHub API'),
    /default port/,
  )
  assert.throws(
    () => validateOutboundUrl('https://generativelanguage.googleapis.com.evil.test/v1beta', ['generativelanguage.googleapis.com'], 'Google AI Studio'),
    /host is not allowed/,
  )
  assert.throws(
    () => validateOutboundUrl('https://user:pass@api.github.com/repos/example/project', ['api.github.com'], 'GitHub API'),
    /without credentials/,
  )
})

test('local n8n may use its fixed service port but not an alternate port', () => {
  assert.equal(
    validateOutboundUrl(
      'http://127.0.0.1:5678/api/v1/workflows',
      ['127.0.0.1'],
      'n8n',
      ['http:'],
      ['5678'],
    ).port,
    '5678',
  )
  assert.throws(
    () => validateOutboundUrl('http://127.0.0.1:5679/api/v1/workflows', ['127.0.0.1'], 'n8n', ['http:'], ['5678']),
    /default port/,
  )
})
