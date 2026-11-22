#!/usr/bin/env node
/**
 * The advisory PR Quality Check comment must not fail fork PRs (read-only
 * token) and must find its earlier comment past the first page of comments.
 * Runs the workflow's own github-script body against fake github/context/core.
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const WORKFLOW = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pr-check.yml'), 'utf8')

function commentStep() {
  const start = WORKFLOW.indexOf('- name: Post PR comment')
  assert.ok(start >= 0, 'comment step present')
  const rest = WORKFLOW.slice(start)
  const next = rest.indexOf('\n      - name:', 1)
  return next === -1 ? rest : rest.slice(0, next)
}

function scriptBody(step) {
  const lines = step.split('\n')
  const i = lines.findIndex(l => /^\s+script: \|\s*$/.test(l))
  assert.ok(i >= 0, 'script block present')
  const indent = lines[i + 1].match(/^\s*/)[0].length
  const body = []
  for (const line of lines.slice(i + 1)) {
    if (line.trim() && line.match(/^\s*/)[0].length < indent) break
    body.push(line.slice(indent))
  }
  return body.join('\n')
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function fakes({ headRepo, comments = [] }) {
  const calls = []
  const github = {
    rest: {
      issues: {
        listComments: async () => { throw new Error('use paginate') },
        createComment: async args => { calls.push(['create', args]); return {} },
        updateComment: async args => { calls.push(['update', args]); return {} },
      },
    },
    paginate: async (fn, args) => {
      assert.equal(fn, github.rest.issues.listComments)
      calls.push(['paginate', args])
      return comments
    },
  }
  const context = {
    repo: { owner: 'owner', repo: 'GhostForge' },
    issue: { number: 7 },
    payload: { pull_request: { head: { repo: { full_name: headRepo } } } },
  }
  let summary = ''
  const core = {
    info() {},
    summary: { addRaw(text) { summary += text; return this }, async write() { return this } },
  }
  return { github, context, core, calls, summary: () => summary }
}

async function run(f) {
  const fn = new AsyncFunction('github', 'context', 'core', 'process', scriptBody(commentStep()))
  await fn(f.github, f.context, f.core, { env: {} })
}

test('comment step is advisory: continue-on-error', () => {
  assert.match(commentStep(), /continue-on-error: true/)
})

test('fork PRs get a job summary and no comment API call', async () => {
  const f = fakes({ headRepo: 'someone/GhostForge' })
  await run(f)
  assert.deepEqual(f.calls, [])
  assert.match(f.summary(), /GhostForge PR Quality Check/)
})

test('same-repo PRs update the existing comment even when it is past the first page', async () => {
  const comments = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, body: `chatter ${i}` }))
  comments[40] = { id: 41, body: '## ⚡ GhostForge PR Quality Check\nold' }
  comments[10] = { id: 11, body: null }
  const f = fakes({ headRepo: 'owner/GhostForge', comments })
  await run(f)
  const kinds = f.calls.map(c => c[0])
  assert.deepEqual(kinds, ['paginate', 'update'])
  assert.equal(f.calls[1][1].comment_id, 41)
})

test('same-repo PRs without a previous comment get a new one', async () => {
  const f = fakes({ headRepo: 'owner/GhostForge', comments: [] })
  await run(f)
  assert.deepEqual(f.calls.map(c => c[0]), ['paginate', 'create'])
})
