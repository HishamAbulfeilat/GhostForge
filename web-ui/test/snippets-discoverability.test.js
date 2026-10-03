const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

test('the snippets page exists', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'app', 'snippets', 'page.tsx')))
})

test('Navbar links to /snippets', () => {
  const navbar = read('components/Navbar.tsx')
  assert.match(navbar, /href:\s*'\/snippets'[^}]*label:\s*'Snippets'/)
})

test('CommandPalette has a keyboard-navigable Snippets command for /snippets', () => {
  const palette = read('components/CommandPalette.tsx')
  assert.match(palette, /id:\s*'snippets'[^\n]*go\('\/snippets'\)/)
  assert.match(palette, /ArrowDown/)
  assert.match(palette, /Enter/)
})
