import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ECC_OFFICIAL_REPOSITORY,
  buildECCContext,
  clearECCContext,
  loadECCConfig,
  skillsFor,
  stageECCContext,
} from './lib/ecc.mjs'

const config = {
  enabled: true,
  ref: 'v2.2.2',
  maxContextBytes: 48_000,
  coreSkills: ['verification-loop'],
  taskSkills: { feature: ['tdd-workflow'] },
  reviewSkills: ['security-review'],
  planningSkills: ['strategic-compact'],
}

test('repo ECC configuration stays pinned to the official release', () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const actual = loadECCConfig(root)
  assert.equal(actual.enabled, true)
  assert.equal(actual.repository, ECC_OFFICIAL_REPOSITORY)
  assert.match(actual.ref, /^v\d+\.\d+\.\d+$/)
})

test('ECC task routing combines core, kind, and area skills without duplicates', () => {
  assert.deepEqual(
    skillsFor(config, { kind: 'feature', area: ['web-ui/app/api'] }),
    ['verification-loop', 'tdd-workflow', 'frontend-patterns', 'backend-patterns'],
  )
  assert.deepEqual(
    skillsFor(config, { mode: 'review' }),
    ['verification-loop', 'security-review'],
  )
})

test('ECC context is staged inside the worker and cleaned up', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-ecc-'))
  const cache = path.join(root, 'cache')
  for (const name of ['verification-loop', 'tdd-workflow']) {
    const dir = path.join(cache, '.agents', 'skills', name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\nFollow ${name}.`)
  }

  const context = buildECCContext(config, cache, { kind: 'feature' })
  assert.match(context, /verification-loop/)
  assert.match(context, /tdd-workflow/)
  const staged = stageECCContext(root, context)
  assert.equal(fs.existsSync(staged), true)
  clearECCContext(staged)
  assert.equal(fs.existsSync(staged), false)
  fs.rmSync(root, { recursive: true, force: true })
})
