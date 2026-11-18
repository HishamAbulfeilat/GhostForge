'use strict'
// Every permission key a server route checks must exist in the catalog
// (lib/permissions.ts). A key that is not in the catalog can never be granted,
// because user creation and the permission editor drop unknown keys, so the
// route would be admin-only by accident (this happened to /api/workflows).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { ALL_PERMISSIONS } = require('../lib/permissions.ts')

const WEB_UI = path.resolve(__dirname, '..')
const SKIP = new Set(['node_modules', '.next', 'test', 'e2e', 'vendor'])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) out.push(full)
  }
  return out
}

const CHECKS = /\b(?:requirePermission|hasPermission)\(\s*[^,()]+,\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g

test('every requirePermission / hasPermission literal is a catalog key', () => {
  const known = new Set(ALL_PERMISSIONS)
  const bad = []
  let seen = 0
  for (const file of [...walk(path.join(WEB_UI, 'app')), ...walk(path.join(WEB_UI, 'lib'))]) {
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(CHECKS)) {
      seen++
      if (!known.has(m[1])) bad.push(`${path.relative(WEB_UI, file)}: "${m[1]}"`)
    }
  }
  assert.ok(seen > 10, `expected to find permission checks, found ${seen}`)
  assert.deepEqual(bad, [], `unknown permission keys:\n${bad.join('\n')}`)
})

test('the workflows API is guarded by the n8n (Workflows) permission', () => {
  const src = fs.readFileSync(path.join(WEB_UI, 'app/api/workflows/route.ts'), 'utf8')
  const keys = [...src.matchAll(CHECKS)].map(m => m[1])
  assert.ok(keys.length >= 4)
  assert.ok(keys.every(k => k === 'n8n'), `workflows route keys: ${keys.join(', ')}`)
})
