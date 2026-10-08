// Child process for test/job-store.test.js: a second "server process" on the same jobs.db.
// argv: <mode> <username> <jobId> <count|ms> <tag>
const Module = require('node:module')
Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (err) {
      if (specifier.startsWith('.')) {
        for (const ext of ['.ts', '.js']) { try { return nextResolve(specifier + ext, context) } catch { /* next */ } }
      }
      throw err
    }
  },
})
const store = require('../../lib/job-hunter/store.ts')

const [mode, user, id, n, tag] = process.argv.slice(2)
async function main() {
  if (mode === 'update') {
    // Each update appends one log line: a lost update would lose a line
    for (let i = 0; i < Number(n); i++) await store.updateJob(user, id, { reasons: `${tag}-${i}` }, `${tag} ${i}`)
  } else if (mode === 'claim') {
    const won = await store.claimJob(user, id, ['ready'], { status: 'submitting' }, `claimed by ${tag}`)
    process.stdout.write(won ? 'won' : 'lost')
  } else if (mode === 'hold') {
    // Hold an operation on the job until told to stop
    await store.withJobOperation(user, id, async () => {
      process.stdout.write('holding\n')
      await new Promise(resolve => process.stdin.once('data', resolve))
    })
    process.stdout.write('released\n')
  } else if (mode === 'crash') {
    // Take the operation and die without releasing it
    await store.withJobOperation(user, id, async () => { process.stdout.write('holding\n'); process.exit(0) })
  } else if (mode === 'try') {
    try { await store.withJobOperation(user, id, async () => {}); process.stdout.write('ran') } catch (e) { process.stdout.write(`refused: ${e.message}`) }
  }
}
main().catch(e => { process.stderr.write(String(e && e.stack || e)); process.exit(1) })
