# Job Hunter

Web: `/jobs` · CLI: `ghostforge jobs` · slash command: `/job-hunter`

Upload your CV and GhostForge does the rest:

1. It finds jobs on many boards and company job sites, removes stale, broken
   and likely-scam listings, and scores the rest against your CV.
2. It writes a tailored CV and cover letter.
3. It fills in the application and submits it, or sends it to you for one
   approval.

## Ways in

- **Search.** Uses your target roles, locations and work style. LinkedIn
  results are included when LinkedIn is connected.
- **Add a job by link.** Paste any job URL: LinkedIn, a company careers page,
  Workday, Greenhouse and so on. The page's own `JobPosting` data is read,
  scored and queued.

## Where jobs come from

Only official public APIs and feeds are used. Nothing behind a login is
scraped, and LinkedIn is never scraped.

| Source | Needs | Notes |
|---|---|---|
| Remotive, RemoteOK, We Work Remotely, Himalayas, Jobicy | nothing | Remote jobs. Listings link back to the board. |
| Hacker News "Who is hiring?" | nothing | The current month's thread, via the Algolia HN API. User-posted, so it ranks below the others. |
| The Muse, Arbeitnow | nothing | On-site and hybrid jobs. Skipped when you want remote only. |
| Company boards: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee | the company's board name | Add them under **More filters → Company boards to watch**. A plain name such as `stripe` is tried on every ATS. Pin one ATS with `ashby:openai` or `workable:acme`. These come straight from the company, so they are the most trusted. |
| LinkedIn, Indeed, Glassdoor, ZipRecruiter (via JSearch) | `JSEARCH_API_KEY` (free RapidAPI key) | A licensed aggregator. |
| Adzuna | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` (free) | About 20 countries. The country comes from your locations, or set `ADZUNA_COUNTRY` (e.g. `de`). |
| USAJobs | `USAJOBS_API_KEY` + `USAJOBS_EMAIL` (free) | US federal jobs. |
| Reed | `REED_API_KEY` (free) | UK jobs. |

Put keys in `web-ui/.env.local`, never in code. The Sources card on `/jobs`
shows which keyed sources are connected. Feed responses are cached for an hour,
so several search terms or runs don't hit a feed repeatedly. A source that is
down is skipped and named under Sources.

"Everywhere" therefore means these boards plus any company whose ATS board you
add, plus any job you paste by link. Sites with no public API (most company
career pages, Indeed and Glassdoor directly, LinkedIn without JSearch) are
reached by pasting the link.

## Real jobs only

Every search result is screened before it is shown:

- **Duplicates.** The same job on several boards is kept once. The company's
  own ATS copy wins. Company suffixes ("Inc", "GmbH"), "Sr."/"Senior" and
  remote spellings don't count as differences.
- **Old postings.** Jobs older than **Hide jobs older than (days)** (default
  30) are removed when the source gives a date.
- **Broken links.** Jobs without a public http(s) apply link are removed.
- **Scams.** Signals include asking you for fees, deposits or equipment
  purchases, Telegram/WhatsApp-only contact, pay in crypto or gift cards,
  "no experience, $5,000 a week", an unrealistic salary, a chat app or URL
  shortener as the apply link, a personal email as the only way to apply, an
  employer that isn't named, and an ATS board that belongs to a different
  company. Disclaimers such as "we never charge a fee" don't count. Strong
  evidence removes the job. Some evidence keeps it with a red **Possible scam**
  badge, scored Skip, and autopilot never touches it.

Each job carries a badge:

| Badge | Meaning |
|---|---|
| **Verified** | Read from the company's own ATS API, or its page was checked and is live. |
| **Unverified** | Not checked yet, or the check couldn't tell (bot wall, timeout). |
| **Possible scam** | See the reasons on the job's page. |
| **Closed** | The posting returns 404/410 or says it no longer accepts applications. |

The live check runs only for a job about to be prepared or applied to, one at
a time, and at most once a day per job. It never runs over whole search results.
Greenhouse and Lever postings are checked through their public APIs. LinkedIn
pages can't be fetched without signing in, so they are checked in your browser
when the application opens. Set `JOB_HUNTER_VERIFY_LIVE=0` to turn live checks
off.

## How an application is filled

The form agent (`web-ui/lib/job-hunter/agent.ts`) drives a real browser:

1. **Opens the form.** It presses *Apply* / *Easy Apply* and follows a new tab
   if the site opens one.
2. **Answers from your profile.** Name, contact details, links, work
   authorization and sponsorship, plus every answer you've saved before.
   Saved answers are matched by label, ignoring case and punctuation.
3. **Asks the AI for the rest, grounded in your CV.** Years with a skill,
   yes/no experience questions and short "why us" texts. The AI must answer
   "ASK" when your CV doesn't show something. Legal, criminal, medical,
   identity and background questions are never answered by the AI. Demographic
   (EEO) questions get "decline to self-identify".
4. **Moves through multi-step forms.** It presses Next / Continue / Review,
   including LinkedIn's dialog and its "Select an option" placeholders.
5. **Submits only when allowed.** Otherwise it stops with everything filled in.
6. **Asks you what it couldn't answer.** These questions appear on the job card
   (and as a push notification when VAPID keys are set). Answer once: the job
   goes back in the queue for autopilot's next run, and every later
   application reuses the answer.

It **never** solves captchas, signs in for you, creates accounts or invents
answers. Those come back to you as "needs you". A posting that turns out to
be closed is marked **Closed** and not retried.

### Which forms it handles

Tested against local pages that copy each system's structure
(`web-ui/test/job-ats.test.js`):

| ATS | What the agent does |
|---|---|
| Greenhouse | Hidden resume input, react-select dropdowns, native selects. Career pages that embed the form in an iframe are followed to it. |
| Lever | Labels in sibling elements, `✱` required markers, "Full name", radio questions. |
| Ashby | Autocomplete location field, hidden upload input. |
| Workday | Multi-page (My Information → My Experience → Questions → Review), listbox dropdowns, resume step. **Account creation and sign-in always come back to you.** |
| SmartRecruiters | "I'm interested", then a form built from shadow-DOM web components. |
| Workable, BambooHR | Consent checkboxes, "Apply for This Job", native selects, cover letter box. |
| Teamtailor | Upload buttons that create their file input only when pressed. |
| iCIMS | The career page's iframe is opened as the form. |
| Taleo | Usually needs an account: comes back to you. |
| LinkedIn Easy Apply | Dialog with Next / Review / Submit (opt-in, see below). |

These are structural copies, not the live sites. Real sites change, add
captchas, or ask questions only you can answer; the agent then stops with
everything filled in.

## Autopilot

Turn on the switch in **Find jobs → Autopilot & AI model** and choose:

| Setting | Meaning |
|---|---|
| **Safe sites** (default) | Auto-submits on Lever, Greenhouse, Ashby, Workable and Recruitee, which have predictable public forms. Other jobs are prepared and wait for one tap. |
| **Any site** | Also auto-submits on company career sites and Workday. Anything it can't finish safely comes back to you. |
| **Apply on LinkedIn (Easy Apply)** | Opt-in. Needs *Any site* and **Connect LinkedIn**: you sign in once in the GhostForge browser, on the laptop or from your phone through Remote → Control this computer. It has its own daily cap (default 5, max 15) and waits 30 s between LinkedIn applications. ⚠️ Automated applying can break LinkedIn's User Agreement and can get the account restricted. Use it at your own risk. |
| **Allow control of this computer when stuck** | Off: everything runs headless in the background, and no screen is needed. On: applications run in a visible browser, and a vision model (computer use: screenshot → click/type) tries to get past layouts the agent doesn't understand. Still never for captchas or passwords. |
| Interval / daily limit / minimum score | How often it runs (1–168 h), how many it submits per day (1–25), and the lowest match score it applies to (50–100). |

What autopilot does on its own, and what it leaves to you:

- **Starts with the server.** The schedule is stored in your profile, so it
  continues after a restart. If the server's start-up hook didn't run, opening
  `/jobs` starts it.
- **Applies only to verified postings.** It never applies to anything flagged
  as a possible scam, closed, or unverifiable (for example a career site behind
  a bot wall). Those wait for you, and the run summary says how many there were.
- **Prepares enough jobs.** It prepares up to the day's remaining limit,
  checking each posting is live first.
- **Retries.** Jobs whose questions you answered go back in the queue. A failed
  attempt (site error, timeout) is retried once.
- **Interrupted applications** (GhostForge stopped mid-form) are handed to you
  after 30 minutes. They are not resubmitted, because the form may already
  have been sent.
- **Reports problems.** The last run's result on `/jobs` names what went wrong,
  for example "Problem: every job source failed" or a site error. A failed run
  or application also sends a push notification when push is set up.

Autopilot runs on the machine that hosts GhostForge. You don't have to sit at
it: pair your phone (see [Remote access](REMOTE-ACCESS.md)) to check results,
answer questions or take over a stuck application.

Browser data, including the LinkedIn and Workday sign-ins, lives per user in
`~/.ghostforge/jobs/<user>/browser`. Set `JOB_HUNTER_BROWSER` to use a
specific Chrome or Edge.
