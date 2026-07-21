/**
 * G.F.A.I. Biometric Authentication API
 * 
 * Voice biometrics: uses Resemblyzer Python script to create/compare voice embeddings.
 * Typing biometrics: tracks average typing speed and word patterns.
 * 
 * Endpoints:
 *   POST /api/jarvis/biometrics/enroll   — enroll voice sample (base64 wav)
 *   POST /api/jarvis/biometrics/verify   — verify voice against enrolled profile
 *   GET  /api/jarvis/biometrics/status   — get biometric status
 */

import { NextRequest, NextResponse } from 'next/server'
import { writeFile, readFile, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { auditLog } from '@/lib/audit'

const execAsync = promisify(exec)
const BIOMETRIC_DIR  = join(homedir(), '.ghostforge', 'biometrics')
const PROFILE_FILE   = join(BIOMETRIC_DIR, 'voice_profile.npy')
const TYPING_FILE    = join(BIOMETRIC_DIR, 'typing_profile.json')

interface TypingProfile {
  avgWordLen:     number
  sessionCount:   number
  commonPhrases:  string[]
  avgResponseLen: number
  lastUpdated:    string
}

async function ensureDir() {
  if (!existsSync(BIOMETRIC_DIR)) await mkdir(BIOMETRIC_DIR, { recursive: true })
}

// ── Voice embedding via Resemblyzer Python script ─────────────────────────────

const RESEMBLYZER_ENROLL = `
import sys, numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav
from pathlib import Path
encoder = VoiceEncoder()
wav = preprocess_wav(Path(sys.argv[1]))
embedding = encoder.embed_utterance(wav)
np.save(sys.argv[2], embedding)
print("enrolled")
`

const RESEMBLYZER_VERIFY = `
import sys, numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav
from pathlib import Path
encoder = VoiceEncoder()
wav = preprocess_wav(Path(sys.argv[1]))
test_emb = encoder.embed_utterance(wav)
profile  = np.load(sys.argv[2])
similarity = float(np.dot(test_emb, profile) / (np.linalg.norm(test_emb) * np.linalg.norm(profile)))
print(f"{similarity:.4f}")
`

export async function GET(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const voiceEnrolled  = existsSync(PROFILE_FILE)
  const typingEnrolled = existsSync(TYPING_FILE)
  let typingProfile: TypingProfile | null = null

  if (typingEnrolled) {
    try { typingProfile = JSON.parse(await readFile(TYPING_FILE, 'utf8')) } catch { /* */ }
  }

  // Check if Resemblyzer is available
  let resemblyzerAvailable = false
  try {
    await execAsync('python3 -c "import resemblyzer; print(\'ok\')"', { timeout: 3000 })
    resemblyzerAvailable = true
  } catch { /* not installed */ }

  return NextResponse.json({
    voice: { enrolled: voiceEnrolled, resemblyzerAvailable },
    typing: { enrolled: typingEnrolled, profile: typingProfile },
    securityMode: voiceEnrolled ? 'biometric' : 'pin-only',
  })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    void auditLog({ level: 'security', event: 'biometric_unauthorized', risk: 90 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await ensureDir()
  const body = await req.json() as { action: string; audio?: string; typingData?: object }
  const { action, audio, typingData } = body

  if (action === 'enroll-voice') {
    if (!audio) return NextResponse.json({ error: 'No audio data' }, { status: 400 })

    // Write temp wav file
    const tmpWav = join(BIOMETRIC_DIR, 'tmp_enroll.wav')
    const audioBuffer = Buffer.from(audio, 'base64')
    await writeFile(tmpWav, audioBuffer)

    // Run Resemblyzer to create embedding
    const scriptPath = join(BIOMETRIC_DIR, 'enroll.py')
    await writeFile(scriptPath, RESEMBLYZER_ENROLL)

    try {
      await execAsync(`python3 "${scriptPath}" "${tmpWav}" "${PROFILE_FILE}"`, { timeout: 30000 })
      await unlink(tmpWav).catch(() => {})
      await unlink(scriptPath).catch(() => {})
      void auditLog({ level: 'info', event: 'voice_profile_enrolled' })
      return NextResponse.json({ success: true, message: 'Voice profile enrolled successfully' })
    } catch (e) {
      await unlink(tmpWav).catch(() => {})
      return NextResponse.json({ error: `Enrollment failed: ${(e as Error).message}` }, { status: 500 })
    }
  }

  if (action === 'verify-voice') {
    if (!audio) return NextResponse.json({ error: 'No audio data' }, { status: 400 })
    if (!existsSync(PROFILE_FILE)) return NextResponse.json({ verified: false, reason: 'No voice profile enrolled' })

    const tmpWav = join(BIOMETRIC_DIR, 'tmp_verify.wav')
    const audioBuffer = Buffer.from(audio, 'base64')
    await writeFile(tmpWav, audioBuffer)

    const scriptPath = join(BIOMETRIC_DIR, 'verify.py')
    await writeFile(scriptPath, RESEMBLYZER_VERIFY)

    try {
      const { stdout } = await execAsync(`python3 "${scriptPath}" "${tmpWav}" "${PROFILE_FILE}"`, { timeout: 15000 })
      const similarity = parseFloat(stdout.trim())
      await unlink(tmpWav).catch(() => {})
      await unlink(scriptPath).catch(() => {})

      const THRESHOLD = 0.82 // ~82% similarity = same speaker
      const verified = similarity >= THRESHOLD

      void auditLog({
        level: verified ? 'info' : 'security',
        event: verified ? 'voice_verified' : 'voice_verification_failed',
        result: `similarity=${similarity.toFixed(3)}`,
        risk: verified ? 0 : 80,
      })

      return NextResponse.json({ verified, similarity, threshold: THRESHOLD })
    } catch (e) {
      await unlink(tmpWav).catch(() => {})
      return NextResponse.json({ error: `Verification failed: ${(e as Error).message}` }, { status: 500 })
    }
  }

  if (action === 'update-typing-profile') {
    if (!typingData) return NextResponse.json({ error: 'No typing data' }, { status: 400 })
    const profile = { ...typingData, lastUpdated: new Date().toISOString() }
    await writeFile(TYPING_FILE, JSON.stringify(profile, null, 2))
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
