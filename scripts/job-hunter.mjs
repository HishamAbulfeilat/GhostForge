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

${c.bold('Automate')}
  jobs model [provider/model | default] Show or set the AI model (e.g. groq/llama-3.3-70b-versatile,
                                       ollama/qwen3:8b, custom/<id>); "default" follows Settings
  jobs autopilot status                Show autopilot settings and the last run
  jobs autopilot on [--every 12] [--limit 5] [--min-score 75]
                                       Search + apply on a schedule while the web UI server runs
  jobs autopilot off
  jobs autopilot run                   One full autopilot pass now (searches and submits)

${c.bold('CV & GitHub')}
  jobs improve [--adopt | --restore]   Review + rewrite your CV (never invents facts); --adopt uses it
                                       for applications (.docx), --restore goes back to your original
  jobs github <username> [--creative] [--style minimal|badges|terminal|visual|story|creative]
             [--show] [--publish] [--no-profile]
                                       Design your GitHub profile README from your CV (several designs,
                                       the best fit recommended); --publish creates <username>/<username>
                                       and pushes it using your gh login

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
      const { profile, insights } = await jh.importCv(user, basename(file), readFileSync(file), generate)
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
    case 'model': {
      const arg = rest[0]
      if (arg) {
        let model = null
        if (arg !== 'default') {
          const i = arg.indexOf('/')
          if (i < 1) throw new Error('Use provider/model, e.g. groq/llama-3.3-70b-versatile, or "default"')
          model = { provider: arg.slice(0, i), model: arg.slice(i + 1) }
        }
        await jh.saveProfile(user, { model })
      }
      const { model } = await jh.getProfile(user)
      console.log(model ? `Job Hunter model: ${c.bold(`${model.provider}/${model.model}`)}` : 'Job Hunter model: default (the model selected in Settings)')
      return
    }
    case 'autopilot': {
      const ap = await import(pathToFileURL(join(WEB, 'lib', 'job-hunter', 'autopilot.ts')).href)
      const sub = rest[0] || 'status'
      const profile = await jh.getProfile(user)
      const clampInt = (v, min, max, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d }
      if (sub === 'on' || sub === 'off') {
        const cur = profile.autopilot
        const next = {
          ...cur,
          enabled: sub === 'on',
          intervalHours: flags.every !== undefined ? clampInt(flags.every, 1, 168, cur.intervalHours) : cur.intervalHours,
          dailyLimit: flags.limit !== undefined ? clampInt(flags.limit, 1, 25, cur.dailyLimit) : cur.dailyLimit,
          minScore: flags['min-score'] !== undefined ? clampInt(flags['min-score'], 50, 100, cur.minScore) : cur.minScore,
        }
        if (sub === 'on' && !flags.yes && !(await confirm(
          `Autopilot will search every ${next.intervalHours}h and SUBMIT up to ${next.dailyLimit} applications/day ` +
          `(High fit, score ${next.minScore}+, Lever/Greenhouse/Ashby) using your CV and details. Turn it on?`))) { console.log('Cancelled.'); return }
        await jh.saveProfile(user, { autopilot: next })
        console.log(sub === 'on' ? c.green('Autopilot on.') + c.dim(' It runs while the GhostForge web UI server is running (or use: jobs autopilot run).') : 'Autopilot off.')
        return
      }
      if (sub === 'run') {
        console.log(c.dim('Autopilot: searching, preparing and submitting…'))
        const r = await ap.runAutopilot(user, { force: true, generate })
        console.log(r.ran
          ? `Found ${r.found} · ${r.matched} in your locations · prepared ${r.prepared} · ${c.green(`submitted ${r.submitted}`)}${r.needsUser ? c.yellow(` · ${r.needsUser} need you`) : ''}${r.failed ? c.red(` · ${r.failed} failed`) : ''}`
          : c.yellow(r.reason))
        return
      }
      const a = profile.autopilot
      console.log(`Autopilot: ${a.enabled ? c.green('on') : 'off'} · every ${a.intervalHours}h · max ${a.dailyLimit}/day (${ap.submittedToday(a)} today) · min score ${a.minScore}`)
      if (a.lastRunAt) console.log(c.dim(`Last run ${a.lastRunAt.slice(0, 16).replace('T', ' ')}: ${a.lastResult}`))
      return
    }
    case 'improve': {
      const im = await import(pathToFileURL(join(WEB, 'lib', 'job-hunter', 'improve.ts')).href)
      if (flags.restore) { const cv = await im.restoreOriginalCv(user); console.log(c.green(`Using your original CV again (${cv.fileName}).`)); return }
      if (!flags.adopt || !(await jh.getProfile(user)).improvedCv) {
        console.log(c.dim('Reviewing and rewriting your CV…'))
        const { model } = await jh.getProfile(user)
        const r = await im.improveCv(user, jh.generatorFor(model))
        const tone = r.review.score >= 80 ? c.green : r.review.score >= 60 ? c.yellow : c.red
        console.log(`\n${c.bold('Score')} ${tone(`${r.review.score}/100`)}  ${r.review.summary}`)
        for (const [title, items, col] of [['Strengths', r.review.strengths, c.green], ['Issues', r.review.issues, c.yellow], ['Improvements', r.review.suggestions, c.cyan]]) {
          if (items.length) { console.log(`\n${col(title)}`); items.forEach(i => console.log(`  • ${i}`)) }
        }
        console.log(`\n${c.bold('── Improved CV ──')}\n${r.text}`)
      }
      if (flags.adopt) {
        const cv = await im.adoptImprovedCv(user)
        console.log(c.green(`\nJob Hunter now uses the improved CV (${cv.filePath}).`))
      } else {
        console.log(c.dim('\nUse it for applications: ghostforge jobs improve --adopt'))
      }
      return
    }
    case 'github': {
      const gd = await import(pathToFileURL(join(WEB, 'lib', 'job-hunter', 'github-designs.ts')).href)
      const gp = await import(pathToFileURL(join(WEB, 'lib', 'job-hunter', 'github-profile.ts')).href)
      const ghUser = String(rest[0] || '').replace(/^@/, '')
      if (!gp.validGithubUsername(ghUser)) throw new Error('Usage: jobs github <your-github-username> [--creative] [--style …] [--publish]')
      console.log(c.dim('Reading your CV and GitHub, designing profiles…'))
      const { model } = await jh.getProfile(user)
      const set = await gd.generateGithubDesigns(user, ghUser, { notes: typeof flags.notes === 'string' ? flags.notes : '', creative: Boolean(flags.creative) || flags.style === 'creative' }, jh.generatorFor(model))
      set.designs.forEach(d => console.log(`${d.recommended ? c.green('★ recommended') : '             '}  ${c.bold(d.style.padEnd(9))} ${d.name} ${c.dim('— ' + d.why)}`))
      const style = typeof flags.style === 'string' ? flags.style : set.designs[0].style
      const draft = await gd.selectGithubDesign(user, style)
      if (flags.show || !flags.publish) console.log(`\n${c.bold(`── README.md (${style}) ──`)}\n${draft.readme}`)
      if (!flags.publish) { console.log(c.dim(`Publish it: ghostforge jobs github ${ghUser} --style ${style} --publish`)); return }
      const { execFileSync } = await import('node:child_process')
      let token = ''
      try { token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true }).trim() } catch { /* not logged in */ }
      if (!token) throw new Error('Log in to GitHub CLI first: gh auth login')
      if (!flags.yes && !(await confirm(`Publish the "${style}" design to github.com/${draft.username}?`))) { console.log('Cancelled.'); return }
      const r = await gp.publishGithubProfile(user, token, draft, { updateProfile: !flags['no-profile'] })
      console.log(c.green(`${r.createdRepo ? 'Created' : 'Updated'} ${r.repoUrl}`) + (r.profileUpdated ? c.green(' · profile details updated') : ''))
      r.notes.forEach(n => console.log(c.yellow(n)))
      console.log(`View it: ${r.profileUrl}`)
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
