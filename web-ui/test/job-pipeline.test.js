// Application pipeline after Applied (lib/job-hunter/pipeline.ts): manual stages, follow-ups, reminders
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-jobpipe-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (err) {
      if (specifier.startsWith('.')) {
        for (const ext of ['.ts', '.js', '/index.ts']) { try { return nextResolve(specifier + ext, context) } catch { /* next */ } }
      }
      throw err
    }
  },
})
const store = require('../lib/job-hunter/store.ts')
const pipeline = require('../lib/job-hunter/pipeline.ts')

test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 200))
  store.closeJobStores()
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const listing = n => ({
  key: `p${n}`, source: 'test', title: `Engineer ${n}`, company: `Co ${n}`, location: 'Remote', remote: true, salary: '',
  url: 'https://example.com/j', applyUrl: 'https://example.com/j', ats: 'lever', description: '', postedAt: '', fit: 'High', score: 90, reasons: '',
})
async function jobs(user, statuses) {
  await store.upsertJobs(user, statuses.map((_, i) => listing(i)))
  const list = await store.listJobs(user)
  for (const [i, j] of list.entries()) await store.updateJob(user, j.id, { status: statuses[i] })
  return store.listJobs(user)
}
const NOW = new Date('2026-10-08T12:00:00Z')

test('only sent applications get a pipeline, and only the owner can change it', async () => {
  const [sent, ready] = await jobs('pipe1', ['submitted', 'ready'])
  assert.equal(pipeline.pipelineOf(sent).stage, 'applied', 'a sent application starts as "applied"')
  await assert.rejects(pipeline.updatePipeline('pipe1', ready.id, { stage: 'interview' }), /once the application has been sent/)
  assert.equal((await store.getJob('pipe1', ready.id)).pipeline, undefined)
  await assert.rejects(pipeline.updatePipeline('someone-else', sent.id, { stage: 'interview' }), /Job not found/)
  await assert.rejects(pipeline.updatePipeline('pipe1', sent.id, { stage: 'hired' }), /Unknown stage/)
  await assert.rejects(pipeline.updatePipeline('pipe1', sent.id, { followUpAt: '2026-02-30' }), /YYYY-MM-DD/)
  await assert.rejects(pipeline.updatePipeline('pipe1', sent.id, { followUpInDays: 0 }), /1 to 365/)
  await assert.rejects(pipeline.updatePipeline('pipe1', sent.id, { notes: { html: 1 } }), /text/)
})

test('stages, follow-up dates and notes are saved with a history and log line; status is untouched', async () => {
  const [job] = await jobs('pipe2', ['submitted'])
  let j = await pipeline.updatePipeline('pipe2', job.id, { stage: 'screening', followUpInDays: 7, notes: 'Recruiter: Sam' }, NOW)
  assert.equal(j.status, 'submitted')
  assert.equal(j.pipeline.stage, 'screening')
  assert.equal(j.pipeline.followUpAt, pipeline.localDay(new Date(NOW.getTime() + 7 * 86_400_000)))
  assert.equal(j.pipeline.notes, 'Recruiter: Sam')
  assert.deepEqual(j.pipeline.history.map(h => h.stage), ['screening'])
  assert.match(j.log.at(-1).msg, /Pipeline: stage: screening, follow up on .*, notes updated/)
  j = await pipeline.updatePipeline('pipe2', job.id, { stage: 'interview', followUpAt: '2026-11-02' }, NOW)
  assert.equal(j.pipeline.notes, 'Recruiter: Sam', 'fields not sent are kept')
  assert.equal(j.pipeline.followUpAt, '2026-11-02')
  assert.deepEqual(j.pipeline.history.map(h => h.stage), ['screening', 'interview'])
  j = await pipeline.updatePipeline('pipe2', job.id, { followUpAt: null, notes: 'x'.repeat(5000) }, NOW)
  assert.equal(j.pipeline.followUpAt, undefined)
  assert.equal(j.pipeline.notes.length, 4000)
})

test('one follow-up reminder is sent on the day, not before, and not for closed applications', async () => {
  const [a, b, c, d] = await jobs('pipe3', ['submitted', 'submitted', 'submitted', 'submitted'])
  await pipeline.updatePipeline('pipe3', a.id, { followUpAt: '2026-10-08' })
  await pipeline.updatePipeline('pipe3', b.id, { followUpAt: '2026-10-09' })
  await pipeline.updatePipeline('pipe3', c.id, { followUpAt: '2026-10-01', stage: 'rejected' })
  await pipeline.updatePipeline('pipe3', d.id, { followUpAt: '2026-10-05', stage: 'interview' })
  const sent = []
  const notify = async (username, id, payload) => { sent.push({ username, id, ...payload }); return 'sent' }
  assert.equal(await pipeline.sendFollowUpReminders('pipe3', '2026-10-08', notify), 2)
  assert.deepEqual(sent.map(s => s.id).sort(), [a.id, d.id].sort())
  assert.match(sent.find(s => s.id === d.id).body, /stage interview/)
  assert.match(sent.find(s => s.id === a.id).title, /Follow up: Engineer 0/)
  // Again the same day (or from a second server process): nothing new
  assert.equal(await pipeline.sendFollowUpReminders('pipe3', '2026-10-08', notify), 0)
  // The next day b is due; a new date for a re-arms its reminder
  await pipeline.updatePipeline('pipe3', a.id, { followUpAt: '2026-10-09' })
  assert.equal(await pipeline.sendFollowUpReminders('pipe3', '2026-10-09', notify), 2)
  assert.equal(sent.length, 4)
})

test('due follow-ups are shown only for open applications on or after the day', () => {
  const job = (stage, followUpAt) => ({ status: 'submitted', pipeline: { stage, followUpAt } })
  assert.equal(pipeline.followUpDue(job('applied', '2026-10-08'), '2026-10-08'), true)
  assert.equal(pipeline.followUpDue(job('applied', '2026-10-09'), '2026-10-08'), false)
  assert.equal(pipeline.followUpDue(job('offer', '2026-10-01'), '2026-10-08'), false)
  assert.equal(pipeline.followUpDue({ status: 'needs_user', pipeline: { stage: 'applied', followUpAt: '2026-10-01' } }, '2026-10-08'), false)
})
