const test = require('node:test')
const assert = require('node:assert/strict')
const {
  collectRecognitionTranscript,
  findWakePhrase,
  normalizeSpeech,
} = require('../lib/voice-runtime')

test('normalizes punctuation and repeated whitespace', () => {
  assert.equal(normalizeSpeech('  Hey,   JARVIS! '), 'hey jarvis')
})

test('detects only the supported wake phrases', () => {
  assert.equal(findWakePhrase('could you wake up, hey GhostForge please'), 'hey ghostforge')
  assert.equal(findWakePhrase('HEY JARVIS, are you there?'), 'hey jarvis')
  assert.equal(findWakePhrase('Jarvis is a movie character'), null)
})

test('collects cumulative browser recognition results without dropping words', () => {
  const results = [
    { 0: { transcript: 'open the' } },
    { 0: { transcript: 'browser please' } },
  ]

  assert.equal(collectRecognitionTranscript(results), 'open the browser please')
})

test('Permissions-Policy lets the app itself use the mic and camera that JARVIS voice needs', async () => {
  const path = require('node:path')
  const { pathToFileURL } = require('node:url')
  const { default: config } = await import(pathToFileURL(path.join(__dirname, '..', 'next.config.mjs')).href)
  const rules = await config.headers()
  const policy = rules.find(r => r.source === '/:path*').headers.find(h => h.key === 'Permissions-Policy').value
  assert.match(policy, /microphone=\(self\)/)
  assert.match(policy, /camera=\(self\)/)
  assert.match(policy, /geolocation=\(\)/)
})
