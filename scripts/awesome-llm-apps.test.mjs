import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { filterApps, parseArgs, parseReadme, usage } from './awesome-llm-apps.mjs'

const cliPath = fileURLToPath(new URL('./awesome-llm-apps.mjs', import.meta.url))

test('CLI help documents category filtering without fetching the catalog', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stdout, /--category/)
  assert.match(result.stdout, /--search/)
})

test('CLI parses category and search options', () => {
  assert.deepEqual(parseArgs(['--category', 'agents', '--search', 'planner']), {
    category: 'agents',
    search: 'planner',
    json: false,
    help: false,
  })
})

test('heading category is used when app text has no inferred category', () => {
  const apps = parseReadme([
    '## AI Agents',
    '* [Workflow Builder](https://example.com/workflow-builder) - A visual workflow authoring tool.',
    '## Projects',
    '* [Voice Notes](https://example.com/voice-notes) - Transcribes short audio clips.',
  ].join('\n'))

  assert.equal(apps[0].category, 'agents')
  assert.equal(apps[1].category, 'voice')
  assert.deepEqual(filterApps(apps, { category: 'agents' }).map(app => app.name), ['Workflow Builder'])
})

test('category inferred from app text takes precedence over an unmapped heading', () => {
  const apps = parseReadme('## Projects\n* [Audio Notes](https://example.com/audio) - Voice transcription')
  assert.equal(apps[0].category, 'voice')
})

test('usage describes default catalog listing and available options', () => {
  assert.match(usage(), /By default, lists the Awesome LLM Apps catalog/i)
})
