// Regression (T-272): a failed `npm ci` must log npm's reason, not the usage dump (run: node --test scripts/agents/boss-npm.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { npmFailureSummary } from './boss.mjs'

const EUSAGE = [
  'npm error code EUSAGE',
  'npm error',
  'npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.',
  'npm error',
  "npm error Invalid: lock file's mammoth@0.3.29 does not satisfy mammoth@1.13.0",
  'npm error',
  'npm error Clean install a project',
  'npm error',
  'npm error Usage:',
  'npm error npm ci',
  'npm error',
  'npm error   --include-workspace-root',
  'npm error     Include the workspace root when workspaces are enabled for a command.',
  'npm error',
  'npm error Run "npm help ci" for more info',
].join('\n')

test('EUSAGE keeps the reason and drops the usage text', () => {
  const s = npmFailureSummary(EUSAGE)
  assert.match(s, /are in sync/)
  assert.match(s, /mammoth@0\.3\.29/)
  assert.doesNotMatch(s, /workspace root/)
  assert.doesNotMatch(s, /Usage:/)
})

test('EUSAGE reason is capped from the start', () => {
  const s = npmFailureSummary(EUSAGE, 60)
  assert.ok(s.startsWith('npm error code EUSAGE'))
  assert.ok(s.length <= 61)
})

test('other failures still log the tail', () => {
  const out = 'x'.repeat(1000) + '\nnpm error code EPERM'
  const s = npmFailureSummary(out, 100)
  assert.ok(s.startsWith('…'))
  assert.match(s, /EPERM$/)
})
