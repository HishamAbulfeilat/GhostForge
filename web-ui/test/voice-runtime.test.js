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
