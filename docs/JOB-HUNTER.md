# Job Hunter

Web: `/jobs` · CLI: `ghostforge jobs` · slash command: `/job-hunter`

Upload your CV and GhostForge does the rest:

1. It finds jobs on several boards and scores them against your CV.
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

It **never** solves captchas, signs in for you or invents answers. Those come
back to you as "needs you".

## Autopilot

Turn on the switch in **Find jobs → Autopilot & AI model** and choose:

| Setting | Meaning |
|---|---|
| **Safe sites** (default) | Auto-submits on Lever, Greenhouse and Ashby, which have predictable forms. Other jobs are prepared and wait for one tap. |
| **Any site** | Also auto-submits on company career sites and Workday. Anything it can't finish safely comes back to you. |
| **Apply on LinkedIn (Easy Apply)** | Opt-in. Needs *Any site* and **Connect LinkedIn**: you sign in once in the GhostForge browser, on the laptop or from your phone through Remote → Control this computer. It has its own daily cap (default 5, max 15) and waits 30 s between LinkedIn applications. ⚠️ Automated applying can break LinkedIn's User Agreement and can get the account restricted. Use it at your own risk. |
| **Allow control of this computer when stuck** | Off: everything runs headless in the background, and no screen is needed. On: applications run in a visible browser, and a vision model (computer use: screenshot → click/type) tries to get past layouts the agent doesn't understand. Still never for captchas or passwords. |
| Interval / daily limit / minimum score | How often it runs (1–168 h), how many it submits per day (1–25), and the lowest match score it applies to (50–100). |

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

Sign in or create the account **yourself in the Job Hunter browser**, complete
MFA/email verification/captcha and accept terms yourself. Then use **Open &
fill again**; the persistent profile reuses that session. A normal browser tab
is a separate session. GhostForge does not store website passwords, create
accounts automatically or bypass authentication. A credential vault with
origin-specific consent would be required before adding password autofill.

Live preview is process-local and unavailable after the application browser
closes or when requests are served by a different server process. Persisted
status still appears. Headless autopilot blockers may require retrying visibly
from the review to complete sign-in.
