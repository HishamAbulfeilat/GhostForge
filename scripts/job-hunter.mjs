#!/usr/bin/env node
/**
 * ghostforge jobs — Job Hunter in the terminal.
 *
 * Runs the same engine as the web UI (web-ui/lib/job-hunter) and shares its
 * data (~/.ghostforge/jobs/<user>/), so a CV uploaded in one shows up in the
 * other. Needs Node 22.15+ / 23.5+ (TypeScript stripping + module hooks).
 */
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = join(ROOT, 'web-ui')

// web-ui/lib uses extensionless relative imports (Next.js style)
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) {
        for (const ext of ['.ts', '.js', '/index.ts']) {
          try { return next(specifier + ext, context) } catch { /* try next */ }
        }
      }
      throw err
    }
  },
})

// Pick up JSEARCH_API_KEY and model keys the web UI uses
for (const f of ['.env.local', '.env']) {
  const p = join(WEB, f)
  if (existsSync(p)) { try { process.loadEnvFile(p) } catch { /* ignore */ } }
}

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m`, red: s => `\x1b[31m${s}\x1b[0m`,
}
const FIT = { High: c.green, Medium: c.yellow, Low: c.dim, Skip: c.dim }

function help() {
  console.log(`${c.bold('ghostforge jobs')} — find jobs that match your CV and apply with one approval

${c.bold('Setup')}
  jobs cv <file.pdf|docx|txt>          Read your CV (fills contact details, suggests roles)
  jobs prefs [options]                 Show or set what to look for
      --roles "Frontend Engineer, React Developer"
      --locations "Tokyo, Japan, Remote"
      --remote any|remote|hybrid|onsite
      --min-salary 8000000  --dealbreakers "agency, crypto"  --companies "stripe, figma"
  jobs me [field value]                Show or set application details
                                       (firstName lastName email phone city country linkedin
                                        github portfolio workAuthorized needsSponsorship)

${c.bold('Hunt')}
  jobs search [roles…] [--prepare N] [--no-ai]
                                       Search every source, keep jobs in your locations,
                                       score fit, auto-prepare the top N (default 3)
  jobs list [--status ready|found|needs_user|submitted]
  jobs show <id>                       Tailored CV, cover letter and answers
  jobs prepare <id>                    Tailor CV + cover letter for one job
  jobs approve <id> [--yes]            Fill the application (submits where safe)
  jobs dismiss <id>

${c.bold('Options')}
  --user <username>                    GhostForge account (default: the owner)

LinkedIn, Indeed and Glassdoor listings come through JSearch: set JSEARCH_API_KEY
in web-ui/.env.local (free RapidAPI key). Other sources need no key.`)
}

function parseArgs(argv) {
  const flags = {}, rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[key] = true
      else { flags[key] = next; i++ }
    } else rest.push(a)
  }
  return { flags, rest }
}

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean)

function row(j) {
  const fit = (FIT[j.fit] || c.dim)(`${String(j.score).padStart(3)} ${j.fit.padEnd(6)}`)
  const status = j.status === 'ready' ? c.cyan('ready') : j.status === 'needs_user' ? c.yellow('needs you') : j.status === 'submitted' ? c.green('applied') : c.dim(j.status)
  return `${c.dim(j.id)}  ${fit}  ${c.bold(j.title)} ${c.dim('@')} ${j.company}  ${c.dim(`${j.location || ''}${j.remote ? ' · remote' : ''} · ${j.ats}`)}  ${status}`
}

async function confirm(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = (await rl.question(`${q} [y/N] `)).trim().toLowerCase()
  rl.close()
  return a === 'y' || a === 'yes'
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return help()
  const { flags, rest } = parseArgs(argv)
  const user = String(flags.user || process.env.ADMIN_USERNAME || 'hisham').toLowerCase()
  const jh = await import(pathToFileURL(join(WEB, 'lib', 'job-hunter', 'index.ts')).href)
  const generate = flags['no-ai'] ? null : undefined

  switch (cmd) {
    case 'cv': {
      const file = rest[0]
      if (!file || !existsSync(file)) throw new Error('Usage: jobs cv <path to your CV>')
      console.log(c.dim('Reading CV…'))
      const { profile, insights } = await jh.importCv(user, basename(file), readFileSync(file), generate === null ? null : jh.aiGenerate)
      const a = profile.applicant
      console.log(`${c.green('✓')} ${profile.cv.fileName} (${profile.cv.text.length} characters)`)
      console.log(`  ${a.firstName} ${a.lastName} · ${a.email || c.yellow('no email')} · ${a.phone || c.yellow('no phone')}`)
      if (insights.titles.length) console.log(`  Suggested roles: ${insights.titles.join(', ')}`)
      console.log(c.dim('Next: ghostforge jobs prefs --locations "Your City, Remote"   then   ghostforge jobs search'))
      return
    }
    case 'prefs': {
      const current = await jh.getProfile(user)
      const p = { ...current.preferences }
      if (flags.roles) p.titles = list(flags.roles)
      if (flags.locations) p.locations = list(flags.locations)
      if (flags.remote) p.remote = ['any', 'remote', 'hybrid', 'onsite'].includes(flags.remote) ? flags.remote : p.remote
      if (flags['min-salary']) p.minSalary = Number(flags['min-salary']) || null
      if (flags.dealbreakers) p.dealbreakers = list(flags.dealbreakers)
      if (flags.companies) p.companies = list(flags.companies)
      const changed = Object.keys(flags).some(k => k !== 'user')
      if (changed) await jh.saveProfile(user, { preferences: p })
      console.log(`${changed ? c.green('Saved. ') : ''}Roles: ${p.titles.join(', ') || c.yellow('none')}
Locations: ${p.locations.join(', ') || 'anywhere'} · work style: ${p.remote}${p.minSalary ? ` · min salary ${p.minSalary}` : ''}
Dealbreakers: ${p.dealbreakers.join(', ') || 'none'} · company boards: ${p.companies.join(', ') || 'none'}`)
      return
    }
    case 'me': {
      const profile = await jh.getProfile(user)
      if (rest.length >= 2) {
        const [field, ...value] = rest
        if (!(field in profile.applicant)) throw new Error(`Unknown field "${field}"`)
        await jh.saveProfile(user, { applicant: { ...profile.applicant, [field]: value.join(' ') } })
        console.log(c.green(`Saved ${field}.`))
        return
      }
      for (const [k, v] of Object.entries(profile.applicant)) console.log(`${k.padEnd(18)} ${v || c.dim('—')}`)
      const missing = jh.missingApplicantFields(profile)
      if (missing.length) console.log(c.yellow(`\nMissing before you can apply: ${missing.join(', ')}`))
      return
    }
    case 'search': {
      const prepare = flags.prepare !== undefined ? Number(flags.prepare) : 3
      console.log(c.dim('Searching sources, filtering by location, scoring fit…'))
      const r = await jh.runSearch(user, { terms: rest.length ? [rest.join(' ')] : undefined, autoPrepare: generate === null ? 0 : prepare, generate })
      for (const s of r.report) console.log(c.dim(`  ${s.source}: ${s.error ? c.red(s.error) : s.count}`))
      console.log(`\nFound ${r.found} · ${r.matched} in your locations · ${c.bold(String(r.added))} new · ${c.cyan(String(r.prepared))} prepared for approval`)
      const top = (await jh.listJobs(user)).filter(j => j.fit !== 'Skip').sort((a, b) => b.score - a.score).slice(0, 10)
      if (top.length) { console.log(''); top.forEach(j => console.log(row(j))) }
      if (r.linkedin[0]) console.log(c.dim(`\nLinkedIn search: ${r.linkedin[0].url}`))
      console.log(c.dim('Review: ghostforge jobs show <id>   Apply: ghostforge jobs approve <id>'))
      return
    }
    case 'list': {
      const jobs = (await jh.listJobs(user))
        .filter(j => j.status !== 'dismissed' && (!flags.status || j.status === flags.status))
        .sort((a, b) => b.score - a.score)
      if (!jobs.length) console.log(c.dim('No jobs yet — run: ghostforge jobs search'))
      jobs.forEach(j => console.log(row(j)))
      return
    }
    case 'show': {
      const j = await jh.getJob(user, rest[0] || '')
      if (!j) throw new Error('Job not found')
      console.log(row(j))
      console.log(c.dim(`${j.source} · ${j.url}\n${j.reasons}`))
      if (j.tailoredResume) console.log(`\n${c.bold('── Tailored CV ──')}\n${j.tailoredResume}`)
      if (j.coverLetter) console.log(`\n${c.bold('── Cover letter ──')}\n${j.coverLetter}`)
      if (j.answers?.length) { console.log(`\n${c.bold('── Form answers ──')}`); j.answers.forEach(a => console.log(`  ${a.label.padEnd(26)} ${a.value}`)) }
      console.log(`\n${c.bold('── Activity ──')}`)
      j.log.slice(-8).forEach(l => console.log(c.dim(`  ${l.at.slice(0, 16).replace('T', ' ')}  ${l.msg}`)))
      return
    }
    case 'prepare': {
      console.log(c.dim('Tailoring CV and writing cover letter…'))
      const j = await jh.prepareJob(user, rest[0] || '')
      console.log(`${c.green('✓')} Ready for approval: ${j.title} @ ${j.company}\n${c.dim(`Review: ghostforge jobs show ${j.id}`)}`)
      return
    }
    case 'approve': {
      const j = await jh.getJob(user, rest[0] || '')
      if (!j) throw new Error('Job not found')
      if (!flags.yes && !(await confirm(`Apply to ${j.title} at ${j.company} now?`))) { console.log('Cancelled.'); return }
      console.log(c.dim('Opening the form in your browser and filling it…'))
      const r = await jh.approveJob(user, j.id)
      const color = r.job.status === 'submitted' ? c.green : r.job.status === 'needs_user' ? c.yellow : c.red
      console.log(color(r.message))
      if (r.missing.length) console.log(c.yellow(`Still needed: ${r.missing.join(', ')}`))
      return
    }
    case 'dismiss': {
      const j = await jh.dismissJob(user, rest[0] || '')
      console.log(j ? 'Dismissed.' : 'Job not found')
      return
    }
    default:
      console.log(c.red(`Unknown command "${cmd}"`))
      help()
      process.exitCode = 1
  }
}

main().catch(err => {
  console.error(c.red(err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
