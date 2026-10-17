import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cpuPercentBetween,
  parseWindowsBattery,
  parseWindowsGpus,
  volumeFromStatfs,
  sampleCpuTimes,
} from '../dist/main/platform-metrics.js'
import { getFullSystemReport } from '../dist/main/hardware-monitor.js'

test('cpuPercentBetween computes busy percent from two samples', () => {
  assert.equal(cpuPercentBetween({ idle: 100, total: 200 }, { idle: 150, total: 300 }), 50)
  assert.equal(cpuPercentBetween({ idle: 100, total: 200 }, { idle: 100, total: 200 }), 0)
  assert.equal(cpuPercentBetween({ idle: 0, total: 0 }, { idle: 0, total: 100 }), 100)
})

test('sampleCpuTimes sums per-core times', () => {
  const t = sampleCpuTimes([
    { times: { user: 10, nice: 0, sys: 5, idle: 85, irq: 0 } },
    { times: { user: 20, nice: 0, sys: 5, idle: 75, irq: 0 } },
  ])
  assert.deepEqual(t, { idle: 160, total: 200 })
})

test('parseWindowsBattery handles object, array, and missing battery', () => {
  assert.deepEqual(
    parseWindowsBattery({ EstimatedChargeRemaining: 80, BatteryStatus: 2, EstimatedRunTime: 71582788 }),
    { percent: 80, charging: true, timeRemaining: null, present: true },
  )
  assert.deepEqual(
    parseWindowsBattery([{ EstimatedChargeRemaining: 40, BatteryStatus: 1, EstimatedRunTime: 120 }]),
    { percent: 40, charging: false, timeRemaining: 120, present: true },
  )
  assert.equal(parseWindowsBattery(null).present, false)
  assert.equal(parseWindowsBattery([]).present, false)
})

test('parseWindowsGpus normalises single and multiple adapters', () => {
  assert.deepEqual(parseWindowsGpus({ Name: 'GPU A', AdapterRAM: 2147483648 }), [{ name: 'GPU A', memoryTotalMB: 2048 }])
  assert.equal(parseWindowsGpus([{ Name: 'A' }, { Name: 'B', AdapterRAM: 0 }]).length, 2)
  assert.deepEqual(parseWindowsGpus(null), [])
})

test('volumeFromStatfs converts blocks to GB', () => {
  const v = volumeFromStatfs({ bsize: 4096, blocks: 262144, bavail: 131072 }) // 1 GB total, 0.5 free
  assert.deepEqual(v, { totalGB: 1, usedGB: 0.5, freeGB: 0.5, percent: 50 })
})

test('getFullSystemReport works on this platform without Unix tools and is fast', async () => {
  const t0 = Date.now()
  const r = await getFullSystemReport()
  assert.ok(Date.now() - t0 < 8000)
  assert.ok(r.ram.totalGB > 0)
  assert.ok(r.cpu.cores > 0)
  assert.ok(r.cpu.usagePercent >= 0 && r.cpu.usagePercent <= 100)
  if (process.platform === 'win32') assert.ok(r.disks.length > 0)
})
