const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

// lib/*.ts use extensionless relative imports; resolve them to the .ts file.
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) return nextResolve(specifier + '.ts', context)
      throw err
    }
  },
})

const { detectLanguage, getSpeechLang, platformLabel } = require('../lib/platform.ts')

test.after(() => {
  hooks.deregister()
})

// ── detectLanguage ───────────────────────────────────────────────────────────

test('detectLanguage recognizes Arabic script', () => {
  assert.equal(detectLanguage('مرحبا كيف حالك'), 'ar')
})

test('detectLanguage recognizes Chinese, Japanese and Korean scripts', () => {
  assert.equal(detectLanguage('你好世界'), 'zh')
  assert.equal(detectLanguage('こんにちは'), 'ja')
  assert.equal(detectLanguage('안녕하세요'), 'ko')
})

test('detectLanguage recognizes common French and Spanish words', () => {
  assert.equal(detectLanguage('bonjour, merci beaucoup'), 'fr')
  assert.equal(detectLanguage('hola, muchas gracias'), 'es')
})

test('detectLanguage falls back to English when nothing else matches', () => {
  assert.equal(detectLanguage('hello there, how are you'), 'en')
  assert.equal(detectLanguage(''), 'en')
})

// ── getSpeechLang ────────────────────────────────────────────────────────────

test('getSpeechLang maps known language codes to BCP-47 speech tags', () => {
  assert.equal(getSpeechLang('ar'), 'ar-SA')
  assert.equal(getSpeechLang('en'), 'en-US')
  assert.equal(getSpeechLang('de'), 'de-DE')
})

test('getSpeechLang falls back to en-US for an unknown language code', () => {
  assert.equal(getSpeechLang('xx'), 'en-US')
})

// ── platformLabel ────────────────────────────────────────────────────────────

test('platformLabel picks the most specific label for each platform flag', () => {
  assert.equal(platformLabel({ isIOS: true }), '📱 iPhone/iPad')
  assert.equal(platformLabel({ isAndroid: true }), '📱 Android')
  assert.equal(platformLabel({ isMac: true }), '🖥 Mac')
  assert.equal(platformLabel({ isWindows: true }), '🖥 Windows')
  assert.equal(platformLabel({ isLinux: true }), '🖥 Linux')
  assert.equal(platformLabel({}), '🌐 Web')
})

test('platformLabel checks flags in iOS > Android > Mac > Windows > Linux precedence', () => {
  assert.equal(platformLabel({ isIOS: true, isAndroid: true, isMac: true }), '📱 iPhone/iPad')
  assert.equal(platformLabel({ isAndroid: true, isMac: true, isWindows: true }), '📱 Android')
})
