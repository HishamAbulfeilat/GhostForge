const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const WEB_UI = join(__dirname, '..')
const read = relative => readFileSync(join(WEB_UI, relative), 'utf8')

test('OmniRoute never uses a placeholder bearer token', () => {
  const ai = read('lib/ai.ts')
  const providers = read('lib/providers.ts')
  assert.doesNotMatch(ai, /OMNIROUTE_API_KEY\s*\|\|\s*['"]omniroute['"]/)
  assert.doesNotMatch(providers, /OMNIROUTE_API_KEY\s*\|\|\s*['"]omniroute['"]/)
  assert.doesNotMatch(ai, /Authorization:\s*`Bearer\s+\$\{[^}]*omniroute/i)
  assert.doesNotMatch(providers, /Authorization:\s*`Bearer\s+\$\{[^}]*omniroute/i)
})

test('OmniRoute auth headers are conditional on a configured key', () => {
  const ai = read('lib/ai.ts')
  const providers = read('lib/providers.ts')
  assert.match(ai, /getOmniRouteKey\(\)/)
  assert.match(ai, /createOpenAI\(\{ baseURL: omniRouteBaseURL\(\), apiKey: apiKey \?\? '' \}\)/)
  assert.match(ai, /generateOpenAICompatible\('OmniRoute', omniRouteBaseURL\(\), getOmniRouteKey\(\)/)
  assert.match(providers, /\.\.\.\(apiKey \? \{ Authorization: `Bearer \$\{apiKey\}` \} : \{\}\)/)
})
