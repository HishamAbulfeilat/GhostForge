# Job Hunter: recommendations

Ranked follow-ups found while reviewing `web-ui/lib/job-hunter/**`, `app/jobs`
and `app/api/jobs`. Not implemented yet. Effort: S = under a day, M = a few days,
L = a week or more. Every item keeps the product rules in
[JOB-HUNTER.md](JOB-HUNTER.md): no captcha or sign-in bypass, no invented
answers, no automatic consent, LinkedIn opt-in, no resubmission after Submit,
hosted mode fail-closed.

Already done on this branch: no second Submit press without a corrected field,
pinned boards clear the unconfirmed mark, de-duplication keeps the missing
salary, date and description, AI scores are reused and dealbreaker or scam
listings skip the model, applying again after Submit needs an explicit check,
and monthly or weekly salaries are annualized for the salary floor.

| # | What | User value | Effort | Files |
|---|---|---|---|---|
| 1 | **Score from the requirements, not the first 1,200 characters.** Build each listing's scoring excerpt from its requirements, qualifications and "you have" sections, plus title, level and location. Today `scoreJobs` sends `description.slice(0, 1200)`, which is often company boilerplate. | Better fit scores, fewer wrong High matches. Autopilot depends on these scores. | S | `lib/job-hunter/match.ts` |
| 2 | **Bigger scoring batches on the anonymous tier.** Anonymous calls are spaced 15 s apart, so 60 listings in batches of 8 take about 2 minutes. Use batches of 15 to 20 compact excerpts when the provider is anonymous or local, and keep 8 for keyed models. | Searches finish 2 to 3 times faster without an API key. | S | `lib/job-hunter/match.ts`, `lib/ai.ts` |
| 3 | **Short-lived negative cache and per-host concurrency for sources.** Remember a failing feed (429 or 5xx) for 10 to 15 minutes, so five search terms don't each wait out the 15 s timeout. Cap requests in flight per host (for example 2) instead of one global pool of 8. | Faster, steadier searches. Feeds are rate-limited less often. | S | `lib/job-hunter/sources.ts` |
| 4 | **Word-level term matching in feed filters.** Arbeitnow, RemoteOK, The Muse and WWR keep a listing only when the whole term appears (`includes(term)`), so "senior frontend engineer" misses "Frontend Engineer (Senior)". Reuse `relevantTo`'s word matching. | More relevant results from the free feeds. | S | `lib/job-hunter/sources.ts`, `match.ts` |
| 5 | **Durable server-side batch queue.** Batch "Confirm & apply" runs in the browser tab and stops when the tab closes. Persist the confirmed job ids, with the user's per-job confirmation, and let the server work through them one at a time. Show progress through the existing 10 s poll. | Approve 10 applications from a phone and close the app. | M | `lib/job-hunter/index.ts`, `store.ts`, `app/api/jobs/route.ts`, `app/jobs/page.tsx` |
| 6 | **Sticky action bar on mobile review.** On phones, Approve, Dismiss and Retry sit at the top of a long review, and warnings (fallback draft, Submit already pressed, questions) appear far below them. Add a bottom-fixed bar on narrow screens with the primary action and a short form of any blocking warning. | Less scrolling. Warnings sit next to the button they affect. | S | `app/jobs/page.tsx` |
| 7 | **Computer-use steps count as a possible Submit.** After a vision step the agent sets `beforeSubmit` but not `pressedSubmit`, so a later Submit press is still allowed. Ask the vision model to report whether it pressed a submit-like control, or compare the URL and page text before and after. If it might have, treat it like a pressed Submit. | Closes the last duplicate-submission path. | S | `lib/job-hunter/agent.ts` |
| 8 | **Cross-board identity for stored jobs.** `runSearch` reuses a stored score only through the exact source key. The same job from another board (a loose `dedupeKey` match) is AI-scored again on every run, then dropped by `upsertJobs`. Also look up stored jobs by `dedupeKey`. | Fewer model calls, steadier scores. | S | `lib/job-hunter/index.ts`, `store.ts` |
| 9 | **Saved searches and digests.** Save several searches (role, location, remote, companies) and get one push or email digest of new High-fit jobs, without turning on autopilot. | People who never auto-apply still get value every day. | M | `lib/job-hunter/autopilot.ts` (scheduler), `notifications.ts`, `app/jobs/page.tsx` |
| 10 | **Application pipeline after Applied.** Add stages (applied, screening, interview, offer, rejected), follow-up dates and notes, and a "follow up in 7 days" reminder. Manual input only; no mailbox reading. | Job Hunter also tracks what happens after applying. | M | `store.ts` (JobStatus or a stage field), `app/jobs/page.tsx` |
| 11 | **Seniority and must-have gaps in the heuristic.** The offline score ignores level ("Staff" vs "Junior") and counts must-haves as plain substrings. Add a level ladder and word-boundary must-have matching, and show the gaps in `reasons`. | Better ranking with no model, and a better order for the 60-listing AI budget. | S | `lib/job-hunter/match.ts` |
| 12 | **Move storage from whole-file JSON to SQLite.** Every `updateJob` rewrites `jobs.json` under a process-local lock. Heavy users with thousands of jobs pay O(n) per log line, and `withJobOperation` doesn't cover two server processes. | Scales, and is safe with several processes. | L | `lib/job-hunter/store.ts` and its callers |
| 13 | **Currency-aware salary floor.** The floor now handles pay periods but compares raw numbers across currencies (JPY vs USD). Store the floor's currency and convert with a static monthly rate table, or skip the floor when currencies differ. | No false Skips or passes on foreign-currency listings. | S | `lib/job-hunter/match.ts`, `store.ts` (preferences) |
| 14 | **Interview prep from a prepared application.** Generate likely questions and STAR-style talking points from the tailored CV and the job description. Grounded in the CV, with the same no-invention rule. | Turns an application into interview readiness. | M | new `lib/job-hunter/interview.ts`, review panel in `app/jobs/page.tsx` |
| 15 | **Source health in the Sources card.** Show last success, error rate and average latency per source over the last runs, and suggest pinning boards that keep matching. | Users see why results are thin and what to fix. | S | `lib/job-hunter/sources.ts`, `app/jobs/page.tsx` |

## Smaller notes

- `parseHnComment` takes the first part after the company that contains any
  search word as the title, so a location or perk containing the word can win.
  Prefer parts that look like a role (the existing role regex) first.
- `theMuse` reads only page 0 for all locations together. A second page, or
  one request per location, would help non-remote users.
- `recoverInterrupted` runs only from the scheduler and autopilot. Calling it
  when `/jobs` loads would release a stuck "submitting" job sooner after a crash.
