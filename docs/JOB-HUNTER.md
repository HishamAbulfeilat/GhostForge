# Job Hunter

Web: `/jobs` · CLI: `ghostforge jobs` · slash command: `/job-hunter`

Upload your CV and GhostForge does the rest:

1. It finds jobs on several boards and scores them against your CV.
2. It writes a tailored CV and cover letter.
3. It fills in the application and submits it, or sends it to you for one
   approval.

## Prepare, approve and track

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
Job Hunter autopilot. Add a provider key in **Settings → AI Models** or run
Ollama, then use **Retry AI tailoring** to replace the basic draft.
AI-tailored CVs are uploaded as DOCX; basic drafts upload the original CV file.

## Ways in

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
