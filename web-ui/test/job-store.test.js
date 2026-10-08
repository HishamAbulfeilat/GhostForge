// Job Hunter storage: jobs.db (node:sqlite), the one-time jobs.json migration,
// the JSON fallback, and safety across two server processes.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { spawn } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-jobstore-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
delete process.env.JOB_HUNTER_STORE

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (err) {
      if (specifier.startsWith('.')) {
        for (const ext of ['.ts', '.js']) { try { return nextResolve(specifier + ext, context) } catch { /* next */ } }
      }
      throw err
    }
  },
})
const store = require('../lib/job-hunter/store.ts')
const WORKER = join(__dirname, 'fixtures', 'job-store-worker.js')

test.after(() => {
  store.closeJobStores()
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const listing = (key, extra = {}) => ({
  key, source: 'test', title: `Engineer ${key}`, company: `Co ${key}`, location: 'Remote', remote: true, salary: '',
  url: 'https://example.com/j', applyUrl: 'https://example.com/j', ats: 'other', description: '', postedAt: '',
  fit: 'High', score: 80, reasons: '', ...extra,
})

function legacyJob(id, i) {
  const now = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
  return { ...listing(`k${i}`), id, status: i % 2 ? 'ready' : 'submitted', log: [{ at: now, msg: 'Found on test' }], createdAt: now, updatedAt: now, tailoredResume: 'CV', submitPressedAt: i % 2 ? undefined : now }
}

function run(args, { stdin } = {}) {
  const child = spawn(process.execPath, [WORKER, ...args], { env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome }, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { err += d })
  const done = new Promise((resolve, reject) => child.on('exit', code => code === 0 ? resolve(out) : reject(new Error(`worker ${args[0]} exited ${code}: ${err}`))))
  if (!stdin) child.stdin.end()
  return { child, done, output: () => out }
}

async function waitFor(fn, ms = 15_000) {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 20))
  }
}

test('jobs are stored in SQLite (jobs.db), not a whole-file jobs.json', async () => {
  assert.equal(store.jobStorage(), 'sqlite')
  await store.upsertJobs('sq', [listing('a'), listing('b')])
  assert.ok(existsSync(join(store.userDir('sq'), 'jobs.db')))
  assert.ok(!existsSync(join(store.userDir('sq'), 'jobs.json')))
  const [a] = await store.listJobs('sq')
  await store.updateJob('sq', a.id, { reasons: 'updated' }, 'a log line')
  const got = await store.getJob('sq', a.id)
  assert.equal(got.reasons, 'updated')
  assert.equal(got.log.at(-1).msg, 'a log line')
  assert.equal(await store.getJob('sq', 'missing'), null)
  assert.equal(await store.updateJob('sq', 'missing', { reasons: 'x' }), null)
})

test('an existing jobs.json is migrated once, in order, and kept as a backup', async () => {
  const dir = store.userDir('legacy')
  mkdirSync(dir, { recursive: true })
  const jobs = Array.from({ length: 30 }, (_, i) => legacyJob(`id${i}`, i))
  const raw = JSON.stringify(jobs, null, 2)
  writeFileSync(join(dir, 'jobs.json'), raw)

  const listed = await store.listJobs('legacy')
  assert.deepEqual(listed.map(j => j.id), jobs.map(j => j.id), 'same jobs, same order')
  assert.deepEqual(listed[1], JSON.parse(raw)[1], 'records are unchanged')
  assert.equal((await store.getJob('legacy', 'id0')).submitPressedAt, jobs[0].submitPressedAt, 'Submit-pressed marks survive the move')

  // The original file is set aside byte for byte, never deleted
  assert.ok(!existsSync(join(dir, 'jobs.json')))
  const backups = readdirSync(dir).filter(f => f.startsWith('jobs.json.migrated-') && f.endsWith('.bak'))
  assert.equal(backups.length, 1)
  assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), raw)

  // A new jobs.json appearing later (e.g. restored by hand) is not imported twice over live data
  writeFileSync(join(dir, 'jobs.json'), JSON.stringify([legacyJob('stray', 99)]))
  store.closeJobStores()
  assert.equal((await store.listJobs('legacy')).length, 30)
  assert.equal(readdirSync(dir).filter(f => f.startsWith('jobs.json.migrated-')).length, 2, 'it is set aside as a backup too')
})

test('an unreadable jobs.json is kept, not overwritten or deleted', async () => {
  const dir = store.userDir('broken')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'jobs.json'), '[{"id": "half-writ')
  assert.deepEqual(await store.listJobs('broken'), [])
  const kept = readdirSync(dir).filter(f => f.startsWith('jobs.json.unreadable-'))
  assert.equal(kept.length, 1)
  assert.equal(readFileSync(join(dir, kept[0]), 'utf8'), '[{"id": "half-writ')
})

test('JOB_HUNTER_STORE=json keeps the legacy file store, and refuses once jobs.db exists', async () => {
  process.env.JOB_HUNTER_STORE = 'json'
  try {
    assert.equal(store.jobStorage(), 'json')
    await store.upsertJobs('jsonuser', [listing('j1')])
    const [j] = await store.listJobs('jsonuser')
    await store.updateJob('jsonuser', j.id, { status: 'ready' }, 'prepared')
    assert.equal(JSON.parse(readFileSync(join(store.userDir('jsonuser'), 'jobs.json'), 'utf8'))[0].status, 'ready')
    assert.ok(!existsSync(join(store.userDir('jsonuser'), 'jobs.db')))
    // Data already moved to jobs.db must not silently show as an empty list
    await assert.rejects(store.listJobs('sq'), /jobs\.db.*Node\.js 22\.13/)
  } finally {
    delete process.env.JOB_HUNTER_STORE
  }
  // Back on SQLite, the JSON user's file is migrated on first use
  assert.equal((await store.listJobs('jsonuser'))[0].status, 'ready')
})

test('upsertJobs keeps progress and de-duplicates across boards on SQLite', async () => {
  const { added } = await store.upsertJobs('dedupe', [listing('x', { company: 'Acme Inc', title: 'Sr. Engineer', source: 'ats' })])
  assert.equal(added, 1)
  const [x] = await store.listJobs('dedupe')
  await store.updateJob('dedupe', x.id, { status: 'submitted', attempts: 1 })
  // Same key again: refreshed, progress kept. Same job from another board: dropped.
  const again = await store.upsertJobs('dedupe', [
    listing('x', { company: 'Acme Inc', title: 'Sr. Engineer', source: 'ats', salary: '$100k' }),
    listing('other-board', { company: 'Acme', title: 'Senior Engineer', source: 'board' }),
    listing('y'),
  ])
  assert.equal(again.added, 1)
  const after = await store.listJobs('dedupe')
  assert.equal(after.length, 2)
  assert.equal(after[0].status, 'submitted')
  assert.equal(after[0].attempts, 1)
  assert.equal(after[0].salary, '$100k')
})

test('two server processes updating the same job lose no updates', async () => {
  await store.upsertJobs('multi', [listing('m')])
  const [m] = await store.listJobs('multi')
  const a = run(['update', 'multi', m.id, '20', 'A'])
  const b = run(['update', 'multi', m.id, '20', 'B'])
  // This process writes too, interleaved with both children
  for (let i = 0; i < 5; i++) await store.updateJob('multi', m.id, {}, `P ${i}`)
  await Promise.all([a.done, b.done])
  const log = (await store.getJob('multi', m.id)).log.map(l => l.msg)
  assert.equal(log.filter(l => l.startsWith('A ')).length, 20)
  assert.equal(log.filter(l => l.startsWith('B ')).length, 20)
  assert.equal(log.filter(l => l.startsWith('P ')).length, 5)
  // Each process's own updates stay in order
  assert.deepEqual(log.filter(l => l.startsWith('A ')), Array.from({ length: 20 }, (_, i) => `A ${i}`))
})

test('claimJob is a compare-and-set across processes: exactly one approval wins', async () => {
  await store.upsertJobs('claim', [listing('c')])
  const [c] = await store.listJobs('claim')
  for (let round = 0; round < 3; round++) {
    await store.updateJob('claim', c.id, { status: 'ready' })
    const results = await Promise.all([1, 2, 3].map(n => run(['claim', 'claim', c.id, '0', `w${n}`]).done))
    assert.equal(results.filter(r => r === 'won').length, 1, results.join(','))
    assert.equal((await store.getJob('claim', c.id)).status, 'submitting')
  }
})

test('an operation running in another process blocks this one, and is released after', async () => {
  await store.upsertJobs('ops', [listing('o')])
  const [o] = await store.listJobs('ops')
  const holder = run(['hold', 'ops', o.id, '0', 'h'], { stdin: true })
  await waitFor(() => holder.output().includes('holding'))
  await assert.rejects(store.withJobOperation('ops', o.id, async () => 'ran'), /already running/)
  holder.child.stdin.end('go\n')
  await holder.done
  assert.equal(await store.withJobOperation('ops', o.id, async () => 'ran'), 'ran')
  // And the other way round: a child is refused while this process holds the job
  let release
  const mine = store.withJobOperation('ops', o.id, () => new Promise(r => { release = r }))
  assert.match(await run(['try', 'ops', o.id, '0', 't']).done, /refused: An operation on this application is already running/)
  release()
  await mine
  assert.equal(await run(['try', 'ops', o.id, '0', 't']).done, 'ran')
})

test('an operation left by a process that died is taken over', async () => {
  await store.upsertJobs('crash', [listing('z')])
  const [z] = await store.listJobs('crash')
  await run(['crash', 'crash', z.id, '0', 'c']).done
  assert.equal(await store.withJobOperation('crash', z.id, async () => 'ran'), 'ran')
})
