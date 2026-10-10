// Generates public/soundtrack.wav: an original synthwave bed (pad, bass, arp,
// drums) plus a whoosh on every scene change, timed from src/timeline.json.
// Dependency-free and deterministic, so the audio re-renders in sync whenever
// the scenes change. Run: node scripts/gen-audio.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { fps, scenes } = JSON.parse(readFileSync(join(root, 'src/timeline.json'), 'utf8'))
const SR = 44100
const totalSec = scenes.reduce((n, s) => n + s.len, 0) / fps
const N = Math.ceil(totalSec * SR)
const L = new Float32Array(N)
const R = new Float32Array(N)

const BPM = 120
const BEAT = 60 / BPM
const TAU = Math.PI * 2
const midi = n => 440 * 2 ** ((n - 69) / 12)

// Deterministic noise
let seed = 1234567
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1

function add(t0, dur, fn, gain = 1, pan = 0) {
  const s0 = Math.max(0, Math.floor(t0 * SR))
  const s1 = Math.min(N, Math.floor((t0 + dur) * SR))
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4)
  const gr = gain * Math.sin((pan + 1) * Math.PI / 4)
  for (let i = s0; i < s1; i++) {
    const v = fn((i - s0) / SR, i / SR)
    L[i] += v * gl
    R[i] += v * gr
  }
}
const env = (t, dur, a, r) => Math.min(1, t / a) * Math.min(1, Math.max(0, (dur - t) / r))

// Am – F – C – G, two seconds (one bar) each
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [55, 60, 64], // C
  [55, 59, 62], // G
]
const BAR = BEAT * 4
const bars = Math.ceil(totalSec / BAR)
const introEnd = scenes[0].len / fps
const outroStart = totalSec - scenes[scenes.length - 1].len / fps

for (let b = 0; b < bars; b++) {
  const t = b * BAR
  const chord = CHORDS[b % CHORDS.length]
  // Pad: detuned sines with a slow swell
  for (const n of chord) {
    for (const det of [-0.12, 0.12]) {
      const f = midi(n + det)
      add(t, BAR + 0.4, (x) => env(x, BAR + 0.4, 0.5, 0.6) * (Math.sin(TAU * f * x) + 0.25 * Math.sin(TAU * 2 * f * x)), 0.035, det < 0 ? -0.5 : 0.5)
    }
  }
  if (t < introEnd - 0.01) continue
  const drums = t < outroStart
  // Bass on every beat
  for (let k = 0; k < 4; k++) {
    const f = midi(chord[0] - 24)
    add(t + k * BEAT, BEAT * 0.9, (x) => Math.exp(-x * 4) * Math.tanh(2.2 * Math.sin(TAU * f * x)), 0.16)
  }
  // Arp: eighth notes, triangle pluck, ping-pong
  for (let k = 0; k < 8; k++) {
    const n = chord[k % 3] + (k >= 4 ? 12 : 0)
    const f = midi(n + 12)
    const tri = (x) => (2 / Math.PI) * Math.asin(Math.sin(TAU * f * x))
    add(t + k * BEAT / 2, 0.45, (x) => Math.exp(-x * 9) * tri(x), 0.05, k % 2 ? 0.6 : -0.6)
    add(t + k * BEAT / 2 + 0.375, 0.45, (x) => Math.exp(-x * 9) * tri(x), 0.02, k % 2 ? -0.6 : 0.6) // echo
  }
  if (!drums) continue
  for (let k = 0; k < 4; k++) {
    // Kick: sine sweeping from 170 Hz down to 50 Hz
    add(t + k * BEAT, 0.35, (x) => Math.exp(-x * 12) * Math.sin(TAU * (50 * x + (120 / 25) * (1 - Math.exp(-x * 25)))), 0.35)
    // Hat on the off-beat
    let prev = 0
    add(t + k * BEAT + BEAT / 2, 0.06, (x) => { const n = rand(); const hp = n - prev; prev = n; return Math.exp(-x * 60) * hp }, 0.05, 0.3)
    // Clap on 2 and 4
    if (k % 2 === 1) add(t + k * BEAT, 0.18, (x) => Math.exp(-x * 22) * rand(), 0.07, -0.2)
  }
}

// Whoosh into every scene change, and a soft chime on each scene start
let at = 0
for (const [i, s] of scenes.entries()) {
  if (i > 0) {
    let lp = 0
    add(at - 0.6, 0.9, (x) => {
      const p = x / 0.9
      const cutoff = 0.02 + 0.25 * Math.sin(Math.PI * p)
      lp += cutoff * (rand() - lp)
      return Math.sin(Math.PI * p) ** 2 * lp * 3
    }, 0.12)
  }
  const bell = midi(i === scenes.length - 1 ? 81 : 76)
  add(at + 0.05, 1.6, (x) => Math.exp(-x * 3) * (Math.sin(TAU * bell * x) + 0.4 * Math.sin(TAU * bell * 2.76 * x)), 0.05)
  at += s.len / fps
}

// Master: gentle fade in/out, soft clip, normalise to -1 dBFS
const fadeIn = 0.8 * SR
const fadeOut = 2.5 * SR
let peak = 0
for (let i = 0; i < N; i++) {
  const g = Math.min(1, i / fadeIn, (N - i) / fadeOut)
  L[i] = Math.tanh(L[i] * g * 1.2)
  R[i] = Math.tanh(R[i] * g * 1.2)
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
}
const norm = 0.89 / (peak || 1)

const data = Buffer.alloc(N * 4)
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(L[i] * norm * 32767), i * 4)
  data.writeInt16LE(Math.round(R[i] * norm * 32767), i * 4 + 2)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22)
header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34)
header.write('data', 36); header.writeUInt32LE(data.length, 40)
mkdirSync(join(root, 'public'), { recursive: true })
writeFileSync(join(root, 'public/soundtrack.wav'), Buffer.concat([header, data]))
console.log(`public/soundtrack.wav: ${totalSec.toFixed(1)} s, ${scenes.length} scenes`)
