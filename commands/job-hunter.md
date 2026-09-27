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

Nothing is submitted without your approval of that specific job. LinkedIn and Workday applications are opened for you to finish.
