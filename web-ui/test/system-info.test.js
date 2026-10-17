const test = require('node:test')
const assert = require('node:assert/strict')

const info = require('../lib/system-info.ts')

test('parseWindowsBattery handles object, array and no battery', () => {
  assert.deepEqual(info.parseWindowsBattery({ EstimatedChargeRemaining: 77, BatteryStatus: 2 }), { pct: 77, charging: true, present: true })
  assert.deepEqual(info.parseWindowsBattery([{ EstimatedChargeRemaining: 20, BatteryStatus: 1 }]), { pct: 20, charging: false, present: true })
  assert.deepEqual(info.parseWindowsBattery(null), { pct: null, charging: false, present: false })
  assert.deepEqual(info.parseWindowsBattery([]), { pct: null, charging: false, present: false })
})

test('addStatfs accumulates used and total bytes', () => {
  const acc = { used: 0, total: 0 }
  info.addStatfs(acc, { bsize: 4096, blocks: 1000, bavail: 250 })
  info.addStatfs(acc, { bsize: 4096, blocks: 0, bavail: 0 }) // ignored
  assert.deepEqual(acc, { used: 750 * 4096, total: 1000 * 4096 })
})

test('disk, ram, cpu and battery getters are fast, valid and cached', () => {
  info.resetMetricsCache()
  const t0 = Date.now()
  const disk = info.getDisk()
  for (let i = 0; i < 50; i++) { info.getCPU(); info.getRAM(); info.getDisk(); info.getBattery() }
  assert.ok(Date.now() - t0 < 4000, 'metrics must not block (no child process on the hot path)')
  assert.ok(disk.totalGB > 0, 'disk total is read without spawning df/wmic')
  assert.ok(disk.pct >= 0 && disk.pct <= 100)
  assert.equal(info.getDisk(), disk, 'second read within the TTL returns the cached object')
  const ram = info.getRAM()
  assert.ok(ram.totalGB > 0 && ram.pct >= 0 && ram.pct <= 100)
  const cpu = info.getCPU()
  assert.ok(cpu >= 0 && cpu <= 100)
  const snap = info.getSystemSnapshot()
  assert.equal(snap.platform, process.platform)
  assert.equal(typeof snap.battery.present, 'boolean')
})
