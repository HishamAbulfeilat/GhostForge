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
import { isAuthorizedRequest } from '@/lib/auth'
import { homedir } from 'os'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { auditLog } from '@/lib/audit'
import { enrollmentConflict, hashIdentity, verifyIdentity, type StoredIdentity } from '@/lib/identity-check'

const execAsync = promisify(exec)
const BIOMETRIC_DIR  = join(homedir(), '.ghostforge', 'biometrics')
const PROFILE_FILE   = join(BIOMETRIC_DIR, 'voice_profile.npy')
const TYPING_FILE    = join(BIOMETRIC_DIR, 'typing_profile.json')
const IDENTITY_FILE  = join(BIOMETRIC_DIR, 'identity.json')

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

function ownerDisplayName(): string {
  return (process.env.OWNER_FULL_NAME || '').trim() || 'owner'
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
  if (!isAuthorizedRequest(req)) {
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

// ── Parse request body (supports both JSON and FormData) ────────────────────
interface BiometricBody {
  action: string
  audio?: string
  typingData?: object
  name?: unknown
  dob?: unknown
  keyword?: unknown
}

async function parseBody(req: NextRequest): Promise<BiometricBody> {
  const ct = req.headers.get('content-type') || ''
  if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
    const fd = await req.formData()
    const action = (fd.get('action') as string) || ''
    const audioFile = fd.get('audio') as File | null
    let audio: string | undefined
    if (audioFile) {
      const arrayBuffer = await audioFile.arrayBuffer()
      audio = Buffer.from(arrayBuffer).toString('base64')
    }
    return { action, audio }
  }
  const json = await req.json()
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Body must be a JSON object')
  return json as BiometricBody
}

async function readStoredIdentity(): Promise<StoredIdentity | null> {
  try {
    const parsed = JSON.parse(await readFile(IDENTITY_FILE, 'utf8')) as StoredIdentity
    return parsed && parsed.version === 1 && typeof parsed.salt === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** Store the hashed name / date of birth / keyword sent with an enrollment. */
async function saveEnrolledIdentity(body: BiometricBody): Promise<void> {
  if (!body.name && !body.dob && !body.keyword) return
  await writeFile(IDENTITY_FILE, JSON.stringify(hashIdentity(body), null, 2), { mode: 0o600 })
}

// ── Save audio as webm/ogg without requiring Resemblyzer ────────────────────
// Simple fingerprint: store raw audio bytes hash as "profile" when Resemblyzer unavailable
const AUDIO_PROFILE_FILE = join(homedir(), '.ghostforge', 'biometrics', 'voice_audio.bin')
const META_FILE          = join(homedir(), '.ghostforge', 'biometrics', 'meta.json')

interface BiometricMeta {
  enrolled: boolean
  method: 'resemblyzer' | 'raw-audio' | 'none'
  enrolledAt: string
  ownerName: string
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    void auditLog({ level: 'security', event: 'biometric_unauthorized', risk: 90 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await ensureDir()

  let body: BiometricBody
  try {
    body = await parseBody(req)
  } catch (e) {
    return NextResponse.json({ error: `Failed to parse request: ${(e as Error).message}` }, { status: 400 })
  }
  const { action, audio, typingData } = body

  // ── Check if Resemblyzer is available ────────────────────────────────────
  let hasResemblyzer = false
  try {
    await execAsync('python3 -c "import resemblyzer"', { timeout: 3000 })
    hasResemblyzer = true
  } catch { /* not installed — use raw audio fallback */ }

  if (action === 'enroll-voice') {
    if (!audio) return NextResponse.json({ error: 'No audio data provided' }, { status: 400 })

    const audioBuffer = Buffer.from(audio, 'base64')
    if (audioBuffer.length < 1000) {
      return NextResponse.json({ error: 'Audio sample too short — please record at least 5 seconds' }, { status: 400 })
    }
    const conflict = enrollmentConflict(body)
    if (conflict) return NextResponse.json({ error: conflict }, { status: 400 })

    if (hasResemblyzer) {
      // Full Resemblyzer embedding
      const tmpWav = join(BIOMETRIC_DIR, 'tmp_enroll.wav')
      const scriptPath = join(BIOMETRIC_DIR, 'enroll.py')
      await writeFile(tmpWav, audioBuffer)
      await writeFile(scriptPath, RESEMBLYZER_ENROLL)
      try {
        await execAsync(`python3 "${scriptPath}" "${tmpWav}" "${PROFILE_FILE}"`, { timeout: 30000 })
        await unlink(tmpWav).catch(() => {})
        await unlink(scriptPath).catch(() => {})
        const meta: BiometricMeta = { enrolled: true, method: 'resemblyzer', enrolledAt: new Date().toISOString(), ownerName: ownerDisplayName() }
        await writeFile(META_FILE, JSON.stringify(meta, null, 2))
        await saveEnrolledIdentity(body)
        void auditLog({ level: 'info', event: 'voice_profile_enrolled', result: 'resemblyzer' })
        return NextResponse.json({ success: true, message: 'Voice profile enrolled (Resemblyzer)', method: 'resemblyzer' })
      } catch (e) {
        await unlink(tmpWav).catch(() => {})
        // Fall through to raw audio fallback
        hasResemblyzer = false
      }
    }

    // Raw audio fallback — save audio bytes directly
    await writeFile(AUDIO_PROFILE_FILE, audioBuffer)
    const meta: BiometricMeta = { enrolled: true, method: 'raw-audio', enrolledAt: new Date().toISOString(), ownerName: ownerDisplayName() }
    await writeFile(META_FILE, JSON.stringify(meta, null, 2))
    await saveEnrolledIdentity(body)
    void auditLog({ level: 'info', event: 'voice_profile_enrolled', result: 'raw-audio' })
    return NextResponse.json({ success: true, message: 'Voice profile saved (audio reference mode — install resemblyzer for biometric matching)', method: 'raw-audio' })
  }

  if (action === 'verify-voice') {
    if (!audio) return NextResponse.json({ error: 'No audio data' }, { status: 400 })

    // Check if enrolled
    const metaExists = existsSync(META_FILE)
    const profileExists = existsSync(PROFILE_FILE) || existsSync(AUDIO_PROFILE_FILE)
    if (!metaExists || !profileExists) {
      return NextResponse.json({ verified: false, reason: 'no_profile', askIdentity: true })
    }

    const meta: BiometricMeta = JSON.parse(await readFile(META_FILE, 'utf8'))
    const audioBuffer = Buffer.from(audio, 'base64')

    if (hasResemblyzer && existsSync(PROFILE_FILE) && meta.method === 'resemblyzer') {
      const tmpWav = join(BIOMETRIC_DIR, 'tmp_verify.wav')
      const scriptPath = join(BIOMETRIC_DIR, 'verify.py')
      await writeFile(tmpWav, audioBuffer)
      await writeFile(scriptPath, RESEMBLYZER_VERIFY)
      try {
        const { stdout } = await execAsync(`python3 "${scriptPath}" "${tmpWav}" "${PROFILE_FILE}"`, { timeout: 15000 })
        const similarity = parseFloat(stdout.trim())
        await unlink(tmpWav).catch(() => {})
        await unlink(scriptPath).catch(() => {})
        const THRESHOLD = 0.82
        const verified = similarity >= THRESHOLD
        const askIdentity = !verified && similarity > 0.65  // unsure — ask identity questions
        void auditLog({ level: verified ? 'info' : 'security', event: verified ? 'voice_verified' : 'voice_verification_failed', result: `similarity=${similarity.toFixed(3)}`, risk: verified ? 0 : 80 })
        return NextResponse.json({ verified, similarity, threshold: THRESHOLD, askIdentity, method: 'resemblyzer' })
      } catch (e) {
        await unlink(tmpWav).catch(() => {})
        return NextResponse.json({ verified: false, reason: 'resemblyzer_error', askIdentity: true, error: (e as Error).message })
      }
    }

    // Raw audio fallback — can't compare audio reliably, ask identity
    return NextResponse.json({ verified: false, reason: 'no_resemblyzer', askIdentity: true, method: 'raw-audio' })
  }

  // ── Identity check: { name, dob, keyword } ──────────────────────────────
  // Name / DOB come from OWNER_FULL_NAME / OWNER_DOB when set (never hardcoded),
  // otherwise from the hashed enrollment record; the keyword only from enrollment.
  if (action === 'identity-challenge') {
    const result = verifyIdentity(body, await readStoredIdentity())
    if (!result.ok) {
      return NextResponse.json({ verified: false, reason: result.reason, error: result.error }, { status: result.status })
    }
    const { verified, checked } = result
    void auditLog({ level: verified ? 'info' : 'security', event: verified ? 'identity_verified' : 'identity_failed', result: `checked=${checked.join(',')}`, risk: verified ? 0 : 90 })
    return NextResponse.json({ verified, checked, message: verified ? 'Identity confirmed.' : 'Identity could not be verified. Access denied.' })
  }

  if (action === 'update-typing-profile') {
    if (!typingData) return NextResponse.json({ error: 'No typing data' }, { status: 400 })
    const profile = { ...typingData, lastUpdated: new Date().toISOString() }
    await writeFile(TYPING_FILE, JSON.stringify(profile, null, 2))
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
