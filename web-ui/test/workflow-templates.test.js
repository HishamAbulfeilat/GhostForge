const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function read(filePath) {
  return fs.readFileSync(path.join(__dirname, filePath), 'utf8')
}

test('workflow templates are reusable and conversion logic is preserved', () => {
  const templateSource = read('../lib/workflows/templates.ts')
  assert.match(templateSource, /export const WORKFLOW_TEMPLATES/)
  assert.match(templateSource, /export function templateToWorkflow/)
  assert.match(templateSource, /deps: step\.deps\.map\(dep => `s\$\{dep\}`\)/)
  assert.match(templateSource, /name: 'Ship a feature'/)
  assert.match(templateSource, /name: 'Fix a bug'/)
})

test('workflow presets remain exposed on the page', () => {
  const pageSource = read('../app/workflows/page.tsx')
  assert.match(pageSource, /WORKFLOW_TEMPLATES\.map/)
  assert.match(pageSource, /createFromTemplate\s*\(/)
  assert.match(pageSource, /templateToWorkflow\(/)
})
