/**
 * Owner identity check used by the JARVIS "ID VERIFY" panel.
 *
 * Contract (POST /api/jarvis/biometrics):
 *   { action: 'enroll-voice', audio, name, dob, keyword }   stores the identity (hashed)
 *   { action: 'identity-challenge', name, dob, keyword }    returns { verified }
 *
 * Name and date of birth are compared against OWNER_FULL_NAME / OWNER_DOB when
 * those env vars are set, otherwise against what was stored at enrollment.
 * The keyword only exists in the enrollment record. Nothing is stored in
 * clear text: each value is normalised and hashed with scrypt and a random salt.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

export interface StoredIdentity {
  version: 1
  salt: string
  /** scrypt hash of the normalised full name */
  name?: string
  /** scrypt hashes of every ISO date the enrolled date of birth could mean */
  dob?: string[]
  /** scrypt hash of the normalised keyword */
  keyword?: string
  enrolledAt: string
}

export interface IdentityInput {
  name?: unknown
  dob?: unknown
  keyword?: unknown
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

export function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeKeyword(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function iso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthIndex(word: string): number {
  const w = word.toLowerCase()
  if (w.length < 3) return 0
  const i = MONTHS.findIndex(m => m.startsWith(w))
  return i + 1
}

/**
 * Every ISO date (YYYY-MM-DD) a typed date of birth could mean. Numeric
 * day/month orders are ambiguous (03/04/1990), so both readings are returned.
 * An unparseable value yields an empty list.
 */
export function dobCandidates(value: string): string[] {
  const s = value.normalize('NFKC').toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').trim()
  const out = new Set<string>()
  const add = (v: string | null) => { if (v) out.add(v) }

  let m = s.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/)
  if (m) add(iso(+m[1], +m[2], +m[3]))

  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/)
  if (m) {
    add(iso(+m[3], +m[2], +m[1])) // day/month/year
    add(iso(+m[3], +m[1], +m[2])) // month/day/year
  }

  m = s.match(/^(\d{1,2})[ -]+([a-z]+)\.?[ -]+(\d{4})$/) // 14 July 1990
  if (m) add(iso(+m[3], monthIndex(m[2]), +m[1]))

  m = s.match(/^([a-z]+)\.?[ -]+(\d{1,2})[ -]+(\d{4})$/) // July 14 1990
  if (m) add(iso(+m[3], monthIndex(m[1]), +m[2]))

  return [...out]
}

function hash(salt: string, kind: string, value: string): string {
  return scryptSync(`${kind}:${value}`, Buffer.from(salt, 'hex'), 32).toString('hex')
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Build the record stored at enrollment. Missing fields are left out. */
export function hashIdentity(input: IdentityInput, now = new Date()): StoredIdentity {
  const salt = randomBytes(16).toString('hex')
  const rec: StoredIdentity = { version: 1, salt, enrolledAt: now.toISOString() }
  const name = normalizeName(text(input.name))
  const dobs = dobCandidates(text(input.dob))
  const keyword = normalizeKeyword(text(input.keyword))
  if (name) rec.name = hash(salt, 'name', name)
  if (dobs.length) rec.dob = dobs.map(d => hash(salt, 'dob', d))
  if (keyword) rec.keyword = hash(salt, 'keyword', keyword)
  return rec
}

/** Owner identity from OWNER_FULL_NAME / OWNER_DOB (ISO date), if configured. */
export function envIdentity(env: NodeJS.ProcessEnv = process.env): { name?: string; dob?: string[] } {
  const name = normalizeName(env.OWNER_FULL_NAME || '')
  const dob = dobCandidates(env.OWNER_DOB || '')
  return { ...(name ? { name } : {}), ...(dob.length ? { dob } : {}) }
}

export type IdentityResult =
  | { ok: true; verified: boolean; checked: string[] }
  | { ok: false; status: number; reason: string; error: string }

/**
 * Check a submitted identity. Name, date of birth and keyword are all required.
 * Each must match its configured source; a field with no source configured is
 * not part of the check, but at least one field must be checkable.
 */
export function verifyIdentity(
  input: IdentityInput,
  stored: StoredIdentity | null,
  env: NodeJS.ProcessEnv = process.env,
): IdentityResult {
  const nameIn = normalizeName(text(input.name))
  const dobIn = text(input.dob)
  const keywordIn = normalizeKeyword(text(input.keyword))
  const missing = [!nameIn && 'name', !dobIn && 'dob', !keywordIn && 'keyword'].filter(Boolean) as string[]
  if (missing.length) {
    return { ok: false, status: 400, reason: 'missing_fields', error: `Missing required field(s): ${missing.join(', ')}` }
  }

  const fromEnv = envIdentity(env)
  const dobIn_ = dobCandidates(dobIn)
  const checked: string[] = []
  let verified = true

  if (fromEnv.name) {
    checked.push('name')
    if (nameIn !== fromEnv.name) verified = false
  } else if (stored?.name) {
    checked.push('name')
    if (!same(hash(stored.salt, 'name', nameIn), stored.name)) verified = false
  }

  if (fromEnv.dob) {
    checked.push('dob')
    if (!dobIn_.some(d => fromEnv.dob!.includes(d))) verified = false
  } else if (stored?.dob?.length) {
    checked.push('dob')
    const hashes = dobIn_.map(d => hash(stored.salt, 'dob', d))
    if (!hashes.some(h => stored.dob!.some(s => same(h, s)))) verified = false
  }

  if (stored?.keyword) {
    checked.push('keyword')
    if (!same(hash(stored.salt, 'keyword', keywordIn), stored.keyword)) verified = false
  }

  if (!checked.length) {
    return {
      ok: false,
      status: 503,
      reason: 'not_configured',
      error: 'Identity check is not set up: enroll your voice with name, date of birth and keyword, or set OWNER_FULL_NAME / OWNER_DOB.',
    }
  }
  return { ok: true, verified, checked }
}

/**
 * When the owner identity is configured in env, an enrollment must match it,
 * otherwise verification could never succeed afterwards. Returns an error
 * message, or null when the enrollment is consistent.
 */
export function enrollmentConflict(input: IdentityInput, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = envIdentity(env)
  const name = normalizeName(text(input.name))
  const dob = text(input.dob)
  if (fromEnv.name && name && name !== fromEnv.name) return 'Name does not match the configured owner identity.'
  if (fromEnv.dob && dob && !dobCandidates(dob).some(d => fromEnv.dob!.includes(d))) {
    return 'Date of birth does not match the configured owner identity.'
  }
  if (dob && !dobCandidates(dob).length) return 'Date of birth was not understood — use a form like 14 July 1990 or 1990-07-14.'
  return null
}
