import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/access'
import { getProfile, importCv, saveProfile, type ApplicantData, type AutopilotSettings, type JobPreferences, type ModelChoice } from '@/lib/job-hunter'
import { MAX_CV_BYTES } from '@/lib/job-hunter/cv'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const list = (v: unknown, max = 20) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
  .map(x => String(x).trim()).filter(Boolean).slice(0, max).map(x => x.slice(0, 120))

const text = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max)

/** GET /api/jobs/profile — CV summary, applicant data and preferences */
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user
  const p = await getProfile(user.username)
  return NextResponse.json({
    profile: {
      ...p,
      // The full CV text stays server-side; the UI only needs a preview
      cv: p.cv ? { fileName: p.cv.fileName, uploadedAt: p.cv.uploadedAt, preview: p.cv.text.slice(0, 600), length: p.cv.text.length } : null,
    },
  })
}

/** PUT /api/jobs/profile { applicant?, preferences?, customAnswers? } */
export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user

  let body: {
    applicant?: Partial<ApplicantData>; preferences?: Partial<JobPreferences>; customAnswers?: Record<string, string>
    model?: ModelChoice | null; autopilot?: Partial<AutopilotSettings>
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Parameters<typeof saveProfile>[1] = {}
  if (body.applicant) {
    const a = body.applicant
    const yn = (v: unknown) => (v === 'yes' || v === 'no' ? v : '') as 'yes' | 'no' | ''
    patch.applicant = {
      firstName: text(a.firstName, 60), lastName: text(a.lastName, 60), email: text(a.email, 120), phone: text(a.phone, 40),
      city: text(a.city, 80), country: text(a.country, 80), linkedin: text(a.linkedin), github: text(a.github), portfolio: text(a.portfolio),
      workAuthorized: yn(a.workAuthorized), needsSponsorship: yn(a.needsSponsorship), howHeard: text(a.howHeard, 80) || 'Job board',
    }
  }
  if (body.preferences) {
    const p = body.preferences
    const remote = ['remote', 'hybrid', 'onsite', 'any'].includes(String(p.remote)) ? p.remote as JobPreferences['remote'] : 'any'
    const minSalary = Number(p.minSalary)
    patch.preferences = {
      titles: list(p.titles, 5), locations: list(p.locations, 10), remote,
      minSalary: Number.isFinite(minSalary) && minSalary > 0 ? minSalary : null,
      mustHaves: list(p.mustHaves), niceToHaves: list(p.niceToHaves), dealbreakers: list(p.dealbreakers),
      companies: list(p.companies, 20).map(c => c.toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean),
    }
  }
  if (body.customAnswers && typeof body.customAnswers === 'object') {
    patch.customAnswers = Object.fromEntries(Object.entries(body.customAnswers).slice(0, 50).map(([k, v]) => [text(k, 160), text(v, 1000)]))
  }
  if (body.model !== undefined) {
    // null = follow the model selected in Settings
    patch.model = body.model && body.model.provider && body.model.model
      ? { provider: text(body.model.provider, 40), model: text(body.model.model, 200) }
      : null
  }
  if (body.autopilot) {
    const a = body.autopilot
    const clamp = (v: unknown, min: number, max: number, dflt: number) => {
      const n = Math.round(Number(v))
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt
    }
    const current = (await getProfile(user.username)).autopilot
    // Only the changed settings: saveProfile merges them onto the fresh profile.
    // Spreading `current` here would write a stale submittedByDay over a run
    // that finished meanwhile (and let autopilot exceed the daily limit).
    patch.autopilot = {
      ...(a.enabled !== undefined ? { enabled: a.enabled === true } : {}),
      ...(a.intervalHours !== undefined ? { intervalHours: clamp(a.intervalHours, 1, 168, current.intervalHours) } : {}),
      ...(a.dailyLimit !== undefined ? { dailyLimit: clamp(a.dailyLimit, 1, 25, current.dailyLimit) } : {}),
      ...(a.minScore !== undefined ? { minScore: clamp(a.minScore, 50, 100, current.minScore) } : {}),
      ...(a.mode !== undefined ? { mode: a.mode === 'full' ? 'full' as const : 'safe' as const } : {}),
      ...(a.linkedinEasyApply !== undefined ? { linkedinEasyApply: a.linkedinEasyApply === true } : {}),
      ...(a.linkedinDailyLimit !== undefined ? { linkedinDailyLimit: clamp(a.linkedinDailyLimit, 1, 15, current.linkedinDailyLimit) } : {}),
      ...(a.laptopControl !== undefined ? { laptopControl: a.laptopControl === true } : {}),
    }
  }
  const profile = await saveProfile(user.username, patch)
  return NextResponse.json({ ok: true, updatedAt: profile.updatedAt })
}

/** POST /api/jobs/profile — multipart CV upload (field "cv") */
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, 'job_hunter')
  if (user instanceof NextResponse) return user

  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('cv')
    file = f instanceof File ? f : null
  } catch {
    return NextResponse.json({ error: 'Send the CV as multipart form data' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'No CV file' }, { status: 400 })
  if (file.size > MAX_CV_BYTES) return NextResponse.json({ error: 'CV is larger than 5 MB' }, { status: 413 })

  try {
    const { profile, insights } = await importCv(user.username, file.name, Buffer.from(await file.arrayBuffer()))
    return NextResponse.json({
      ok: true,
      cv: { fileName: profile.cv!.fileName, length: profile.cv!.text.length },
      applicant: profile.applicant,
      suggestedTitles: insights.titles,
      skills: insights.skills,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read the CV' }, { status: 400 })
  }
}
