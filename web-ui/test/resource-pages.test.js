const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const read = relative => readFileSync(resolve(__dirname, '..', relative), 'utf8')

test('resource pages expose the requested catalogs', () => {
  assert.match(read('app/design-resources/page.tsx'), /Coolors/)
  assert.match(read('app/open-source-tools/page.tsx'), /OpenHuman/)
  assert.match(read('app/vigolium/page.tsx'), /Vigolium/)
  assert.match(read('components/ResourceCatalogPage.tsx'), /ResourceCatalogPage/)
})

test('Vigolium page frames every example as authorized defensive testing', () => {
  const page = read('app/vigolium/page.tsx')
  assert.match(page, /Authorized defensive testing only/)
  assert.match(page, /own or have explicit permission/)
  assert.match(page, /your-owned-staging/)
  assert.match(page, /agent audit --source/)
  assert.doesNotMatch(page, /vigolium agent autopilot|generate custom JS exploits/i)
})
