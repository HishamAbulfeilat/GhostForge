# /job-hunter

> Find jobs that match your CV in your preferred locations, tailor your CV and cover letter for each, and apply with one approval.

Merged from the [Proficiently](https://github.com/proficientlyjobs/proficiently-claude-skills) job skills and the [Claude Office](https://github.com/claude-office-skills/skills) CV skills (both MIT). Also available in the web UI at `/jobs` and to JARVIS ("find me jobs").

## Usage
```bash
ghostforge jobs <command> [options]
```

## Commands
| Command | Description |
|---|---|
| `cv <file>` | Read your CV (PDF, DOCX or TXT); fills contact details and suggests target roles |
| `prefs [--roles --locations --remote --min-salary --dealbreakers --companies]` | Show or set what to look for |
| `me [field value]` | Show or set application details (name, email, phone, links, work authorization) |
| `search [role] [--prepare N] [--no-ai]` | Search all sources, keep jobs in your locations, score fit, auto-prepare the top N |
| `list [--status ready\|found\|needs_user\|submitted]` | List jobs |
| `show <id>` | Tailored CV, cover letter and form answers for one job |
| `prepare <id>` | Tailor CV + cover letter for one job |
| `approve <id> [--yes]` | Fill the application form (submits on Lever, Greenhouse and Ashby when everything is answered) |
| `dismiss <id>` | Hide a job |
| `model [provider/model \| default]` | Use any AI model you have (e.g. `groq/llama-3.3-70b-versatile`, `ollama/qwen3:8b`, `custom/<id>`); `default` follows Settings |
| `autopilot on [--every H] [--limit N] [--min-score S]` | Fully automated: search, prepare and submit on a schedule |
| `autopilot off \| run \| status` | Stop, run one pass now, or show the last run |

## Improve your CV
`ghostforge jobs improve` gives an honest review (score, strengths, issues) and a rewritten CV that reorganizes and sharpens what your CV already says - it never invents employers, dates or numbers. `--adopt` makes it the CV used for tailoring and uploads (as .docx); `--restore` switches back. Also in the web UI under Jobs, Improve CV.

## GitHub profile
`ghostforge jobs github <username>` writes your profile README (the `<username>/<username>` repository GitHub shows on your profile) from your CV and your real public repos, in five designs: Clean & minimal, Badge wall, Terminal, Visual showcase and Storyteller. The one that best fits your skills and personality is marked recommended; `--creative` adds a free-form design written by the AI. `--style <name> --publish` creates the repository and publishes it with your `gh` login (and updates your bio/location/website when the login allows). In the web UI: Jobs, GitHub profile - with live previews rendered by GitHub.

Widgets used (all verified to render on GitHub): skillicons.dev, shields.io, github-profile-summary-cards, streak-stats, readme-typing-svg, capsule-render, ghchart.

## Autopilot
Off until you turn it on. Every run searches, prepares the best matches and **submits** High-fit applications scoring at or above your minimum, up to your daily limit, on Lever, Greenhouse and Ashby. LinkedIn, Workday and other sites need a login or captcha, so they stay prepared in your queue. It runs while the GhostForge web UI server is running (set `GF_JOB_AUTOPILOT=0` to disable the scheduler).

## Sources
Remotive, RemoteOK, The Muse, Arbeitnow and Greenhouse/Lever company boards need no key.
LinkedIn, Indeed and Glassdoor listings come through the JSearch API: add `JSEARCH_API_KEY` to `web-ui/.env.local`.

## Examples
```bash
ghostforge jobs cv ~/Documents/cv.pdf
ghostforge jobs prefs --roles "Frontend Engineer, React Developer" --locations "Tokyo, Japan, Remote"
ghostforge jobs search
ghostforge jobs list --status ready
ghostforge jobs show 3f9a12bc
ghostforge jobs approve 3f9a12bc
```

Without autopilot, nothing is submitted until you approve that specific job. LinkedIn and Workday applications are always opened for you to finish.
