---
name: job-hunter
description: Find jobs that match the user's CV in their preferred locations (LinkedIn, Indeed and Glassdoor via JSearch, plus Remotive, RemoteOK, The Muse, Arbeitnow, Greenhouse and Lever boards), score fit, tailor the CV and cover letter, and fill applications that the user approves with one click. Use when the user wants to find jobs, apply for jobs, tailor a CV or cover letter to a posting, or check application status.
argument-hint: "cv <file> | search [role] | status | apply <job id>"
---

# Job Hunter

One pipeline merged from the **Proficiently** job skills (setup → job-search →
tailor-resume → cover-letter → apply) and the **Claude Office** CV skills
(cv-builder, resume-tailor, cover-letter, job-description). Both are MIT
licensed; see Credits.

GhostForge already implements the pipeline. **Drive it through the CLI — do
not re-implement searching, scoring or form filling by hand.** The web UI at
`/jobs` shows the same data.

```bash
ghostforge jobs cv ~/Documents/cv.pdf                 # read CV → contact details + suggested roles
ghostforge jobs prefs --roles "Frontend Engineer" --locations "Tokyo, Japan, Remote" --remote any
ghostforge jobs me                                     # check application details (email, phone…)
ghostforge jobs search                                 # search → location filter → fit score → auto-prepare top 3
ghostforge jobs list --status ready                    # applications waiting for approval
ghostforge jobs show <id>                              # tailored CV, cover letter, form answers
ghostforge jobs approve <id>                           # fills the form — ONLY after the user says yes
ghostforge jobs model groq/llama-3.3-70b-versatile     # any model the user has (provider/model), or "default"
ghostforge jobs autopilot on --every 12 --limit 5 --min-score 75   # fully automated (user must ask for this)
ghostforge jobs autopilot status | run | off
```

## CV improvement and GitHub profile

```bash
ghostforge jobs improve              # review + rewrite (never invents facts); --adopt to use it, --restore to undo
ghostforge jobs github <username>    # 5 profile README designs from the CV, best fit recommended
ghostforge jobs github <username> --creative            # add a free-form AI design
ghostforge jobs github <username> --style terminal --publish   # create <username>/<username> and push (gh login)
```

When the user asks for a GitHub profile, generate the designs, tell them which is recommended and why,
offer the others, and publish only the one they choose, only after they confirm.

## Model and autopilot

- **Model:** Job Hunter uses the model the user picks (`jobs model`, or the Jobs page),
  otherwise the model selected in Settings, with GhostForge's free models as fallback.
- **Autopilot** is fully automated: on a schedule it searches, prepares, and **submits**
  High-fit applications scoring at or above the minimum, up to the daily limit, on
  Lever/Greenhouse/Ashby. Turn it on **only when the user explicitly asks** for automatic
  applying, and confirm the limits with them. It runs while the web UI server runs;
  LinkedIn, Workday and other sites always stay in the queue for the user.

## Workflow

1. **CV first.** If `ghostforge jobs me` shows no CV, ask for the file path and run `jobs cv`.
   Then show the extracted name/email/phone and ask the user to fix anything wrong
   (`jobs me <field> <value>`). Ask once for work authorization and visa sponsorship.
2. **Preferences.** Target roles (use the CV's suggested roles if the user has none),
   preferred locations, work style, and optionally a minimum salary, dealbreakers
   and company boards (Greenhouse/Lever slugs). Save with `jobs prefs`.
3. **Search.** `jobs search`. Report: jobs found, how many are in the user's
   locations, how many were prepared. Show the High/Medium matches with id, title,
   company, location and the one-line reason. Offer the LinkedIn search link it prints.
4. **Review.** For each prepared job the user is interested in, `jobs show <id>` and
   summarize the tailored CV changes and the cover letter's angle.
5. **Approve.** Run `jobs approve <id> --yes` **only after the user explicitly approves
   that specific job in this conversation.** One approval = one job. Never batch-approve
   on your own initiative.
6. **Report.** Submitted → confirm. `needs_user` → the form is open in the browser;
   tell the user exactly what is left (captcha, login, the listed questions).

## Fit rubric (Proficiently)

| Fit | Criteria |
|-----|----------|
| **Skip** | Any dealbreaker, or salary below the user's minimum |
| **High** | No dealbreakers, all must-haves, 2+ nice-to-haves, level fits |
| **Medium** | Most must-haves, or all must-haves but few nice-to-haves |
| **Low** | Significant gaps in skills, level or must-haves |

## Writing rules (tailored CV + cover letter)

- Only use facts the CV states. Never invent employers, dates, titles, metrics, skills or degrees.
- Never inflate scope or seniority; never call a role current unless it ends in "Present".
- Reorder and reword real experience to mirror the posting; drop irrelevant bullets.
- Summary: 2-3 sentences naming the role type, leading with the most relevant credential.
- Bullets: action verb + what + scale + real measurable result; 2 most relevant first.
- Cover letter: "Dear Hiring Manager,", 250-350 words, 2-3 concrete achievements, "Regards, <Name>".
- No em dashes, no "results-driven", no "I am excited about the opportunity".

## Applying — what is automatic and what is not

| Site | What happens after approval |
|------|------------------------------|
| Lever, Greenhouse, Ashby | Form filled, CV uploaded, submitted if every required field is answered and there is no captcha |
| Workday | Form opened; the user signs in (account creation is never automated) |
| LinkedIn | Listing opened; the user finishes (LinkedIn does not allow automated applications) |
| Anything else | Form pre-filled and left open; the user presses Submit |

EEO questions default to "Decline to self-identify". Answers the user gives for
unusual questions are cached and reused on later forms.

## Sources

No key needed: Remotive, RemoteOK, The Muse, Arbeitnow, Greenhouse and Lever
company boards. LinkedIn, Indeed, Glassdoor and ZipRecruiter listings come
through the licensed JSearch API — the user adds a free RapidAPI key as
`JSEARCH_API_KEY` in `web-ui/.env.local`. LinkedIn is never scraped.
Remotive asks that listings link back to Remotive; always show the job's URL and source.

## Credits

- Proficiently Claude Skills — https://github.com/proficientlyjobs/proficiently-claude-skills (MIT)
- Claude Office Skills — https://github.com/claude-office-skills/skills (MIT)
