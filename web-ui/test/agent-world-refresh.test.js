const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '../app/agent-world/page.tsx'), 'utf8')
const loadBody = source.slice(source.indexOf('const load = useCallback'), source.indexOf('return (\n    <main'))

test('refresh keeps the last loaded snapshot instead of resetting to loading', () => {
  assert.match(loadBody, /prev\.status === 'loaded' \? \{ \.\.\.prev, refreshing: true \}/)
  assert.doesNotMatch(loadBody, /setState\(\{ status: 'loading' \}\)/)
})

test('refresh failure keeps the last snapshot and surfaces an inline alert', () => {
  assert.match(loadBody, /prev\.status === 'loaded'\s*\?\s*\{ \.\.\.prev, refreshing: false, refreshError: message \}/)
  assert.match(loadBody, /: \{ status: 'error', message \}/)
  assert.match(source, /state\.refreshError &&[\s\S]*role="alert"/)
})

test('in-flight requests are aborted on unmount and superseded loads', () => {
  assert.match(loadBody, /controllerRef\.current\?\.abort\(\)/)
  assert.match(loadBody, /signal/)
  assert.match(loadBody, /if \(signal\.aborted\) return/)
  const effect = source.slice(source.indexOf("document.addEventListener('visibilitychange'"))
  assert.match(effect, /return \(\) => \{[\s\S]*clearInterval\(timer\)[\s\S]*removeEventListener\('visibilitychange'[\s\S]*abort\(\)/)
})

test('polling pauses while the document is hidden', () => {
  assert.match(source, /setInterval\(tick, POLL_INTERVAL_MS\)/)
  assert.match(source, /document\.visibilityState !== 'hidden'/)
})

test('page uses logical Tailwind utilities only', () => {
  assert.doesNotMatch(source, /\b(?:ml|mr|pl|pr)-\d|text-left|text-right/)
})

test('CLI sessions refresh as soon as the tab is visible again, and clean up', () => {
  const api = fs.readFileSync(path.resolve(__dirname, '../app/agent-world/shared/api.ts'), 'utf8')
  const hook = api.slice(api.indexOf('export function useCliWorld'), api.indexOf('export function useCliSessionDetail'))
  assert.match(hook, /addEventListener\('visibilitychange', onVisible\)/)
  assert.match(hook, /return \(\) => \{[\s\S]*clearInterval\(timer\)[\s\S]*removeEventListener\('visibilitychange', onVisible\)/)
})
