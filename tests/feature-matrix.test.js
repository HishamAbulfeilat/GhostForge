const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const root = resolve(__dirname, '..')
const doc = readFileSync(resolve(root, 'docs/FEATURE-MATRIX.md'), 'utf8')
const appDir = resolve(root, 'web-ui/app')

const rows = doc
  .split(/\r?\n/)
  .filter(line => line.startsWith('|') && !/^\|[-\s|:]+\|$/.test(line))
  .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
  .filter(cells => cells.length === 6 && cells[0] !== 'Feature')

function appPathExists(rel) {
  const base = resolve(appDir, rel)
  return ['', '.ts', '.tsx', '.js', '/page.tsx', '/route.ts'].some(suffix => existsSync(base + suffix))
}

test('matrix table parses into rows', () => {
  assert.ok(rows.length > 40, `expected many rows, got ${rows.length}`)
})

test('every cited web app path exists under web-ui/app', () => {
  const missing = []
  for (const [feature, , , , , evidence] of rows) {
    for (const [, rel] of evidence.matchAll(/`app\/([A-Za-z0-9_\-./]+)`/g)) {
      if (!appPathExists(rel)) missing.push(`${feature}: app/${rel}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('cited web pages are reachable page routes or API routes', () => {
  // A top-level `app/<name>` citation without /api must be a real page.
  const apiOnly = []
  for (const [feature, , , , , evidence] of rows) {
    for (const [, name] of evidence.matchAll(/`app\/([a-z][a-z0-9-]*)`/g)) {
      if (!existsSync(resolve(appDir, name, 'page.tsx')) && name !== 'layout') apiOnly.push(`${feature}: app/${name}`)
    }
  }
  assert.deepEqual(apiOnly, [])
})

test('Web column is unavailable for Android/iOS packaging', () => {
  const row = rows.find(cells => cells[0] === 'Android/iOS packaged app')
  assert.ok(row, 'Android/iOS packaged app row exists')
  assert.equal(row[1], '❌')
  const webPackaging = ['web-ui/capacitor.config.ts', 'web-ui/capacitor.config.json', 'web-ui/android', 'web-ui/ios']
  for (const rel of webPackaging) {
    assert.equal(existsSync(resolve(root, rel)), false, `${rel} would be a web packaging surface; update the matrix`)
  }
})

test('Android/iOS evidence points at real packaging surfaces', () => {
  const row = rows.find(cells => cells[0] === 'Android/iOS packaged app')
  for (const rel of ['electron-app/android', 'electron-app/ios', 'scripts/build-android.sh', 'scripts/build-ios.sh']) {
    assert.ok(row[5].includes(rel.replace('scripts/', '')), `${rel} cited`)
    assert.ok(existsSync(resolve(root, rel)), `${rel} exists`)
  }
})

test('Agent World and Snippets claims match navigation', () => {
  const navbar = readFileSync(resolve(root, 'web-ui/components/Navbar.tsx'), 'utf8')
  assert.ok(existsSync(resolve(appDir, 'agent-world/page.tsx')))
  assert.match(navbar, /href:\s*'\/agent-world'/)
  assert.ok(existsSync(resolve(appDir, 'snippets/page.tsx')))
  const snippets = rows.find(cells => cells[0].startsWith('Snippets'))
  if (/\/snippets/.test(snippets[5]) && /not a Navbar item/.test(snippets[5])) {
    assert.doesNotMatch(navbar, /href:\s*'\/snippets'/, 'matrix says Snippets is not in Navbar')
  } else {
    assert.match(navbar, /href:\s*'\/snippets'/)
  }
})

test('matrix marks only known status symbols', () => {
  for (const cells of rows) {
    for (const cell of cells.slice(1, 5)) assert.match(cell, /^(✅|⚠️|❌)$/, `${cells[0]}: ${cell}`)
  }
})
