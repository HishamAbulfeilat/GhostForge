import assert from 'node:assert/strict'
import { test } from 'node:test'
import { N8nIntegration, validateN8nUrl } from '../dist/main/n8n-integration.js'
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

test('n8n remote HTTP requires explicit opt-in and config updates are atomic', () => {
  assert.throws(
    () => validateN8nUrl('http://n8n.example.test:5678'),
    /GF_ALLOW_REMOTE_N8N=1/,
  )
  assert.equal(
    validateN8nUrl('http://n8n.example.test:5678/', true),
    'http://n8n.example.test:5678',
  )
  assert.throws(
    () => validateN8nUrl('https://n8n.example.test/path?token=secret', true),
    /query or fragment/,
  )

  const integration = new N8nIntegration({ baseUrl: 'http://localhost:5678', apiKey: 'secret' })
  const embeddedCredentials = ['user', 'pass'].join(':')
  assert.throws(
    () => integration.updateConfig({ baseUrl: `http://${embeddedCredentials}@n8n.example.test` }),
    /without credentials/,
  )
  assert.equal(integration.getStatus().url, 'http://localhost:5678')
})

test('n8n rejects header injection in constructor and update API keys', () => {
  assert.throws(
    () => new N8nIntegration({ apiKey: 'secret\r\nX-Evil: injected' }),
    /invalid characters/,
  )
  const integration = new N8nIntegration()
  assert.throws(
    () => integration.updateConfig({ apiKey: 'secret\nX-Evil: injected' }),
    /invalid characters/,
  )
})
