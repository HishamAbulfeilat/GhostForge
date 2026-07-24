const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const route = readFileSync(resolve(__dirname, '../app/api/jarvis/tts/route.ts'), 'utf8')

test('sends the Fish Audio model in the required request header', () => {
  assert.match(route, /model:\s*'s2\.1-pro-free'/)
  assert.doesNotMatch(route, /JSON\.stringify\(\{[\s\S]*?reference_id: voiceId,[\s\S]*?model:/)
})

test('explicit Fish Audio failures do not fall through to ElevenLabs', () => {
  const explicitFishStart = route.indexOf("if (engine === 'fish' || engine === 'fish-audio')")
  const explicitElevenLabsStart = route.indexOf("if (engine === 'elevenlabs')", explicitFishStart)
  const explicitFishBranch = route.slice(explicitFishStart, explicitElevenLabsStart)

  assert.ok(explicitFishStart >= 0)
  assert.match(explicitFishBranch, /reason: 'fish_audio_error'/)
  assert.match(explicitFishBranch, /status: 502/)
  assert.doesNotMatch(explicitFishBranch, /elevenLabsTTS/)
})
