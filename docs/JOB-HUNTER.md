# Job Hunter

Web: `/jobs` · CLI: `ghostforge jobs` · slash command: `/job-hunter`

Upload your CV and GhostForge does the rest:

1. It finds jobs on many boards and company job sites, removes stale, broken
   and likely-scam listings, and scores the rest against your CV.
2. It writes a tailored CV and cover letter.
3. It fills in the application and submits it, or sends it to you for one
   approval.

## Prepare, approve and track

Click a job's title to read **Job details** before preparing it: company,
location/remote restrictions, salary, posting date, source, application system,
match assessment, original/application links and the source's full description.
Cards show a description preview, salary and date. Missing fields are labelled
**Not provided** rather than guessed. Lever's requirement/responsibility lists
are included; descriptions from sources and pasted JobPosting links are no
longer cut off at 8,000 characters. Existing saved jobs gain fuller source text
after another search.

Click **Prepare** on a match to open its application review in **Waiting for
approval**. Review the CV, cover letter and form answers, then click
**Approve & apply**. A confirmed submission appears in **Applied**; captchas,
logins and unanswered questions appear in **Needs you**. Browser errors are
shown as failures, not successful applications. GhostForge needs Chrome,
Edge or Playwright Chromium on the server machine to fill forms.

AI writing retries with a shorter prompt if a provider rejects the full CV
and job text. If no model answers, preparation still creates a clearly
labelled draft using your **unchanged original CV** and a neutral, basic
cover letter. It does not infer qualifications from your search preferences.
These drafts require manual approval and are never auto-submitted by
Job Hunter autopilot. Use **Retry AI tailoring** to replace the basic draft
when a model becomes available.
AI-tailored CVs are uploaded as DOCX; basic drafts upload the original CV file.

### AI without an account or API key

Automatic mode keeps configured free-tier providers and gateways, then tries
installed Ollama/llama.cpp models and Pollinations' anonymous
`https://text.pollinations.ai/openai` POST endpoint. The separate
`gen.pollinations.ai` gateway requires a key and is not used for anonymous
writing. Pollinations' GPT-OSS aliases remain selectable; all existing keyed,
custom and local models remain available, with an explicitly selected model
tried first. Paid models are never silently selected in automatic free mode.

Anonymous calls use POST with `private: true`, not prompts in URLs, but CV
text still goes to the provider. Requests are spaced at least 15 seconds apart
per server process to respect the anonymous tier's limit, including CV and
cover-letter calls. Rate-limit failures get one paced retry. Select a local
model to keep it on your server:
install Ollama, run `ollama pull qwen2.5:7b` (or a model your machine supports),
start `ollama serve`, and select it in Job Hunter. No account/key is required,
but the model must be downloaded and the runtime running.

The anonymous service is best-effort: rate/length limits and outages can still
produce a labelled original-CV draft. Preparation retries with compact and then
smaller CV/job prompts while retaining strict no-invention instructions.
It never disguises a template as an AI answer or auto-submits the
fallback. Existing provider keys remain optional alternatives, not required
for the anonymous or local paths.

The page refreshes application status and progress every ten seconds while
visible, including work running on the server from another device. A single
server process rejects overlapping prepare/apply/answer/dismiss operations
on the same job, preventing duplicate clicks from launching two submissions.
Answering only some questions keeps the job in **Needs you** until all
remaining questions are answered; it does not prematurely return to approval.

Desktop and Android clients can open **Job Hunter** from the Studio connection
screen. Connect to your running GhostForge server and sign in or pair the
device. CV storage, model requests and browser automation run on that server,
not inside the Android APK.

## Ways in

**Multiple jobs:** use the checkboxes in a job list, then **Prepare / retry AI
for selected**. This only prepares; it never submits. After preparation, choose
**Review selected applications**, inspect every CV/letter/answer and any
non-AI warnings, then **Confirm & apply** to authorize those exact jobs.
Applications run sequentially with individual submitted/needs-you/failed
results, and one failure does not hide the others. Keep the page open until
the batch finishes; it is not a durable background queue. No jobs are selected
or approved automatically.

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
| Company boards: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee | the company's board name | Add them under **More filters → Company boards to watch**. A plain name such as `stripe` is tried on every ATS, and matches are shown, but another company may use the same board name. Autopilot therefore applies only to **pinned** boards such as `ashby:openai` or `workable:acme`. The Sources card tells you which ATS matched, so you can pin it. Pinned boards are the most trusted. |
| LinkedIn, Indeed, Glassdoor, ZipRecruiter (via JSearch) | `JSEARCH_API_KEY` (free RapidAPI key) | A licensed aggregator. |
| Adzuna | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` (free) | About 20 countries. The country comes from your locations, or set `ADZUNA_COUNTRY` (e.g. `de`). |
| USAJobs | `USAJOBS_API_KEY` + `USAJOBS_EMAIL` (free) | US federal jobs. |
| Reed | `REED_API_KEY` (free) | UK jobs. |

Put keys in `web-ui/.env.local`, never in code. The Sources card on `/jobs`
shows which keyed sources are connected. Feed responses are cached for an hour,
so several search terms or runs don't hit a feed repeatedly. A source that is
down is skipped and named under Sources. A listing the AI already scored keeps
its score until your CV, preferences, model or the listing itself changes, so
repeated searches and autopilot runs don't re-score it. Scam-flagged and
dealbreaker listings are marked Skip without asking the AI. Up to 60 new
listings are AI-scored per run, best keyword matches first.

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
  30) are removed when the source gives a date. Jobs read from a company's
  own ATS board are exempt: they are open by definition, and evergreen roles
  stay listed.
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
a time, and at most once a day per job. A **Closed** reading is checked again
after a day, because a page can read as closed by mistake or only for a while.
Only a page's title, headings and first lines are read for "no longer
accepting applications"-style wording. Greenhouse and Lever answers come
from their APIs, and job descriptions are never searched for this wording. It never runs over whole search results.
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
| Workable, BambooHR | "Apply for This Job", native selects, cover letter box. Consent checkboxes are left for you. |
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
  attempt (site error, timeout) is retried once, **unless Submit had already
  been pressed**. In that case the application may have gone through, so it is
  handed to you to check and never submitted again automatically. Only one
  autopilot pass runs per user at a time, and two approvals of the same job
  can't both start.
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

If the browser reports **profile already open**, close the older **Job Hunter**
window and retry; do not delete its profile or cookies. Run only one server per
user profile. Browser shutdown completes before the next application launches,
and windows retained for captchas/questions are reused in new tabs (including
development reloads). A profile conflict is reported separately from a missing
browser. With no installed browser, run `npx playwright install chromium` in
`web-ui`, or set `JOB_HUNTER_BROWSER` to a Chrome/Edge executable.

Approval opens the application URL (or original posting when it is missing).
Lever/Ashby application paths preserve tracking queries and fragments, and
job-board redirect URLs are not modified into invalid ATS paths. Navigation
failures are reported, never left as a successful application on `about:blank`.
Visible application tabs are explicitly brought to the front before and after
navigation. Extra startup blank tabs are closed after successful navigation;
existing nonblank application tabs are preserved.

## Live application monitor and sign-in

Open a job's review to see **Application monitor**: opening, filling,
waiting for AI answers, submitting, waiting for login/account verification, captcha, unanswered
questions, other blockers, failure or confirmed submission. Status refreshes
while the application is running and blockers persist with the job.

**Show browser preview** enables a read-only screenshot of the actual server
browser, refreshed every three seconds while visible. It follows application
popups/new tabs; the real browser stays open separately when you need to act.
This is not an iframe or interactive remote-control window. Third-party sites
often prohibit embedding, so screenshots provide a reliable quick view.
Inputs/textareas/editable fields are masked, but page text may still contain
personal information. Enable only on a trusted screen. Screenshots are never
saved to disk, are served without caching, and require the signed-in user's
Job Hunter permission and ownership of the job.

For a waiting application, **Account sign-in / signup assistance** can use
your existing website email/password to fill and submit an ordinary login
form. Approve the exact HTTPS website origin each time. Alternatively, open
its same-origin signup link and fill name/email/password/confirmation fields
from your confirmed profile and supplied credentials. **Fill signup details**
does not submit. **Automatically create account** opens a same-origin signup
link when needed, fills recognizable fields and submits registration **once**
after your explicit website approval, only when there are no blockers.
Save the chosen password in your own password manager before proceeding.
LinkedIn/Workday registration, SSO, embedded forms, email-first flows and unusual layouts
remain manual. Cross-site form targets and GET submissions are refused.

Automatic registration stops for explicit or implicit terms/privacy consent,
captcha, MFA/verification, unknown required fields, invalid passwords,
disabled buttons and unsupported navigation/forms. It does not accept
terms, read your mailbox or bypass verification. Review and complete these
steps in the real browser. Account creation is confirmed only when a new
website success message appears; a click alone is not success, and unknown
outcomes must be checked before retrying to avoid duplicate registration.

Blockers persist in job status and appear as in-app alerts. Phone push is
attempted through your configured GhostForge push subscriptions; the account
panel reports when delivery is unavailable or failed. Keep the app open when
push is not configured. Application-form terms now also pause the form agent;
GhostForge no longer automatically checks legal/consent checkboxes.

Credentials are request-only: GhostForge never saves them, writes them to job
logs, or sends them to AI. The app clears the password field when an action
starts. Use an HTTPS connection to GhostForge (or this computer's localhost);
account assistance rejects plain HTTP on LAN/public addresses. This is not a
password vault; a website's own scripts still handle its login form.

Complete MFA/email verification/captcha yourself. Then use **Open & fill
again**; the persistent browser profile reuses that session. A normal browser
tab is a separate session. An attempted login is never reported as verified,
and an account action never marks the job Applied or approves another job.
GhostForge does not bypass authentication. Registration authorization is
per-request and per-origin; it is not blanket signup permission for autopilot.

Live preview is process-local and unavailable after the application browser
closes or when requests are served by a different server process. Persisted
status still appears. Headless autopilot blockers may require retrying visibly
from the review to complete sign-in.
