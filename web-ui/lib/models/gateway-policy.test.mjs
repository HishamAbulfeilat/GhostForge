import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = file => readFileSync(join(webRoot, file), 'utf8')

test('the selected paid model precedes configured free-tier and gateway fallbacks', () => {
  const ai = read('lib/ai.ts')
  const selectedModel = ai.indexOf('// 1. Selected model (highest priority)')
  const freeProviders = ai.indexOf('// 2. Free-tier cloud providers you have keys for')
  const omniRoute = ai.indexOf('// 3. OmniRoute — optional, only when it is running')
  const pollinations = ai.indexOf('// 4. Pollinations — free and keyless')

  assert.ok(selectedModel >= 0 && selectedModel < freeProviders)
  assert.ok(freeProviders < omniRoute && omniRoute < pollinations)
  assert.match(ai, /FREE_TIER_FALLBACKS: ProviderId\[\] = \[[^\]]*'openrouter'/)
})

test('quota and rate-limit errors advance the fallback chain', () => {
  const ai = read('lib/ai.ts')
  assert.match(ai, /status === 429/)
  assert.match(ai, /msg\.includes\('quota'\)/)
  assert.match(ai, /msg\.includes\('rate limit'\)/)
  assert.match(ai, /if \(isFallbackError\(e\)\)[\s\S]*?continue/)
})

test('OpenRouter offers a DeepSeek free-tier model and keeps keys in server-side settings', () => {
  const providers = read('lib/providers.ts')
  assert.match(providers, /openrouter:[\s\S]*?keyEnv: 'OPENROUTER_API_KEY'/)
  assert.match(providers, /deepseek\/deepseek-r1:free/)
  assert.match(providers, /getProviderKey\(provider: ProviderId\)/)
  assert.match(providers, /saveProviderKey\(provider: ProviderId, key: string\)/)
})

test('OmniRoute is optional and defaults to a loopback endpoint with optional authentication', () => {
  const providers = read('lib/providers.ts')
  const ai = read('lib/ai.ts')
  assert.match(providers, /process\.env\.OMNIROUTE_URL \|\| 'http:\/\/localhost:20128\/v1'/)
  assert.match(providers, /OMNIROUTE_API_KEY/)
  assert.match(ai, /makeOmniRouteModel\(modelId = 'auto'\)/)
  assert.match(ai, /getOmniRouteKey\(\), modelId, opts/)
})
