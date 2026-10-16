# GhostForge — Session Handoff (read this first)

**Any AI, any provider, any new session: this is the one file that tells you
what is going on.** The top half is written by humans/lead agents; the
`LIVE STATUS` block at the bottom is rewritten automatically by the boss every
couple of minutes while the agent team runs.

## ▶ START HERE — state at 2026-10-07 (Asia/Amman) — main includes PRs #13–#20, agent team stopped, Job Hunter preparation/approval repaired

**Current release work:** v5.3.2 adds a shared desktop/Android Studio
connection screen, cross-platform startup/script fixes and stronger release
validation. Full studio features require a running authenticated server;
Android opens its browser and application automation runs on the server.
Job Hunter refreshes status/progress, rejects overlapping operations on the
same job, keeps partial answers in Needs you, and sends prompt-based CV/job
requests correctly to Ollama. macOS test failures noted below are now fixed.
Only `main` remains; do not recreate deleted agent branches without approval.
See `CHANGELOG.md` and the GitHub release/build run for publication status.
Local verification: root smoke passed, web 515 passed/one Windows-only skip,
desktop 34 passed, MCP eight passed; React Doctor remains 81. Production
high/critical audit gates passed (moderate mammoth-chain advisories remain).
The first v5.3.2 build passed web production, macOS, Linux and Android; Windows
revealed a lazy Electron-download assumption in its smoke test, now corrected
by resolving the executable through Electron's own package API.

**Follow-up Job Hunter fixes (on main, after v5.3.2):** job review now
shows description, salary, dates, location, source, match reasons and posting/
application links; source descriptions no longer truncate at 8,000 characters,
and Lever's requirements lists are retained. Pollinations was incorrectly using
the key-required `gen` gateway twice; it now uses the verified anonymous
`text.pollinations.ai/openai` endpoint with private POSTs and 15-second pacing.
Configured/local models remain available; local models precede anonymous
fallback. Synthetic live CV and cover-letter writing both succeeded without
an account/key; no real CV was sent and no application was submitted. Anonymous
availability/length limits remain, so honest manually-approved fallback drafts
are still necessary. These follow-up edits are not in the published v5.3.2
installers. Full web regression: 524 passed, one Windows-only skip; typecheck
and changed-file lint passed, React Doctor 81 with no changed findings.

**Browser/batch follow-up:** application shutdown is now awaited inside the
profile lock; retained windows/locks survive Next development module reloads.
Profile-in-use errors no longer masquerade as missing Chrome/Edge. Lever/Ashby
paths preserve query/hash, missing apply links fall back to the posting, and
navigation failures are explicit. Real Chromium fixtures verified target
navigation and retained-window reuse without real applications. The jobs page
adds selected-job preparation and explicit batch review/confirmation followed
by sequential single-job requests with per-job results. Keep the page open;
this is not a durable queue. AI writing adds a third, smaller prompt attempt;
unavailable models still generate labelled drafts, not false AI success.

**Application monitor:** jobs now persist structured opening/filling/AI wait/
submitting/login/captcha/question/blocker/result states. Review includes an
opt-in, read-only three-second screenshot preview of the actual Playwright
page, following popups. Preview is authenticated, owner-scoped, masked on input/
editable fields and no-store; it is not saved to disk or interactive remote
control. Sessions are process-local. Request-only account assistance now
supports explicitly approved, origin-bound login forms and opening/filling
same-origin signup forms. Passwords are not persisted or sent to AI; HTTPS/
localhost transport, owner checks, rate limits and credential-safe errors are
enforced. Signup submission/terms/MFA/captcha and LinkedIn remain manual.
Cookies persist for later attempts; use Open & fill again after authenticating.
Automatic registration is now an explicit per-origin option: open/fill/submit
once on supported standard forms, pause for terms (including implicit consent),
captcha/MFA/verification, unknown fields and unsupported flows. LinkedIn and
Workday signup remain manual. Durable blockers show in-app and trigger phone
push when configured; unavailable/failed delivery is reported, not hidden.
The application agent no longer accepts legal/consent checkboxes. Confirmed
account creation never marks a job Applied. No password vault was added.
Verification: root smoke passed; web 551 passed with one Windows-only skip;
isolated production build, typecheck and changed-file lint passed. React Doctor
changed scope 81, with no introduced findings; same-tool full-snapshot
baseline/current comparison showed no score regression. Browser fixtures used fictional credentials;
no real website account was created and no real application was submitted.

**Location:** the project is being moved to `C:\Users\User\Desktop\GhostForge\`
(main repo `GhostForge\GhostForge-public`, worker worktrees `GhostForge\gf-*`,
Copilot worktree under `GhostForge\copilot-worktrees\`). If the main repo is
still at `Desktop\GhostForge-public`, run
`powershell -ExecutionPolicy Bypass -File C:\Users\User\Desktop\GhostForge\finish-move.ps1`
from a terminal that is NOT inside the repo (Claude Code and the Copilot app
closed) — it moves the repo, repairs git worktrees, reinstalls the watchdog
(allowed on battery) and restarts the boss.

**Team now:** boss = Claude (Opus plans/security/large diffs, Sonnet routine
reviews) with Copilot fallback; workers = 5 Copilot CLI agents (model `auto`).
Claude workers are disabled to save Claude tokens. Interactive Copilot is
co-lead (`prompts/copilot-colead.md`).

**Done (merged / on main):** PR #11 merged to `main` (ccc4c29, all 14 checks
green). Since then on `agent/integration` (PR to main opens every 5 merges):
`/agents` command center + kanban + workflow graph + team/workflow builder
(T-135), Agent World switcher + Forge World (T-133), standalone Dev Monitor
(T-136 → `npm run monitor`, http://127.0.0.1:4177), OpenRouter/OmniRoute model
gateways in GhostForge routing (T-137), marketplace entries for gstack, ruflo,
ponytail, agentic-os, hermes-workspace (T-138, catalog only), docs aligned to
the boss model (T-139), BA analysis `docs/PRODUCT-ANALYSIS.md` (T-140), Claude
Design reference for all screens in `docs/design/agent-worlds/`
(canvas https://claude.ai/artifact/6bSqAGRGFDSHJemEVfdbeC).

**In flight:** T-143 AI Town run as its README (finished in `c18ef40`, pinned as
`wip/T-143-done` — merge it, don't redo); T-141 AI Town front-end with our
agents, T-142 Agent Office front-end (redo), T-144 Agent Office run as its README
(`wip/T-144-agent-office-runtime`); T-132 Agent World branch integration is
blocked — redo from `wip/T-132-agent-world` WITHOUT the stray gitlink
`apps/worlds/agent-office/checkout` (checkouts must stay gitignored).

**Open items for the human:**
1. OmniRoute for Claude Code: installed + `scripts/claude-free.ps1` ready, but
   it needs an OpenRouter key and an OmniRoute API key (dashboard at
   http://127.0.0.1:20128). Its old DB `~/.omniroute/storage.sqlite` can't be
   decrypted (missing STORAGE_ENCRYPTION_KEY) — restore the key or move the DB.
2. `/doctor` findings awaiting a yes/no: disable 10 unused plugins (frontend-
   design, skill-creator, code-simplifier, claude-md-management,
   claude-code-setup, figma, huggingface-skills, feature-dev, commit-commands,
   firecrawl); set auto mode as default; quiet ECC GateGuard's routine fact
   prompts (env `GATEGUARD_BASH_ROUTINE_DISABLED=1`,
   `ECC_DISABLED_HOOKS=pre:edit-write:gateguard-fact-force`).
3. Install gstack/ruflo/ponytail into Claude Code itself? (currently catalog only)
4. Restart Claude Code to load the downloaded update (2.1.287).
5. Run `/claude-security` last, after the above.
6. A Copilot prototype of the agents kanban/page is preserved in `git stash`
   ("copilot prototype: agents kanban/page") — apply or drop.

**Lessons (don't repeat):** narrow task areas made workers block — workers may
now edit shared files (package.json, mounting page, tests, notices); orphaned
`next dev` previews lock node_modules — the boss now kills strays; the
watchdog task must be allowed to run on battery.

## Mission

Make GhostForge production-perfect: every feature works end to end and is
reachable from the **web UI, TUI, terminal CLI and JARVIS**; the Electron app
runs on **Windows, macOS and Linux** and the **Android** app builds; security
is hardened; the **Agentic OS dashboard** (`/agents`) shows every agent's
progress. Keep going until every check is green, then keep improving.

## How the work runs (autonomous agent team)

- **Boss** — `scripts/agents/boss.mjs` (Node, detached). The only writer of the
  board and the only one that merges/pushes. Loop: assign tasks → worker
  commits in its own worktree → boss **reviews** (read-only model run) →
  merges into `agent/integration` → health check (rolls back regressions) →
  every 5 merges pushes `agent/integration` and updates **one PR to `main`**
  (never auto-merges). When the board is empty it runs the full health score;
  failing checks become tasks, and at 100/100 it plans the next tasks toward
  the current phase goal (phase 4 = the mission above).
- **Boss model** — `claude` / `opus`, **fallback `copilot`**: when Claude is out
  of quota the boss cools Claude down and reviews/plans with Copilot, then
  retries Claude later. (`.agent-sync/team.json` → `boss`.)
- **Workers** — `claude` (worktree `../gf-claude`) plus five Copilot CLI
  workers: `copilot-tui`, `copilot-desktop`, `copilot-web`,
  `copilot-integration`, `copilot-quality` (`../gf-boss-*`). A rate-limited
  worker cools down 20 min and its task goes back to the queue, so Copilot
  keeps going when Claude hits its limit and vice versa.
- **Skills for workers** — ECC v2.2.2 (pinned, `.agent-sync/ecc.json`) is
  staged per task into `.agent-sync/state/ecc-context.md` for every worker
  (Copilot included). The Claude worker also loads the native Claude plugins
  on this machine (ECC, oh-my-claudecode, superpowers).
- **Watchdog** — `scripts/agents/watchdog.mjs`, run every 5 min by the Windows
  scheduled task **"GhostForge Boss Watchdog"**; restarts the boss if it died.
  An explicit `team.mjs stop` (STOP file) is respected.

## Claude ⇄ Copilot leadership

Claude Code leads (boss reviewer/planner = Claude Opus, hourly lead check-ins). When Claude is rate-limited the boss falls back to Copilot automatically and the **interactive Copilot CLI session is acting lead** — its rules and handover steps are in **`prompts/copilot-colead.md`** (paste it into Copilot). Copilot steers via `team.mjs add/say`, never edits this checkout while the boss runs, and logs what it did in History (signed — copilot). When Claude's quota resets, Claude reads History + boss.log and resumes command.

## Operate it

| Want to… | Command |
|---|---|
| See status | `npm run agents:status` · dashboard `http://localhost:3000/agents` (admin login) |
| Add a task | `node scripts/agents/team.mjs add "title" --area path/` |
| Message the team / boss | `node scripts/agents/team.mjs say boss "…"` |
| Stop (stays stopped) | `npm run agents:stop` |
| Start / resume | `npm run agents:watchdog` (starts the boss if down) |
| Remove the scheduler | `node scripts/agents/watchdog.mjs --uninstall` |
| Logs | `.agent-sync/state/boss.log`, `.agent-sync/state/logs/<agent>.log` |
| Board / messages (raw) | `.agent-sync/state/board.json`, `.agent-sync/state/messages.jsonl` |

## Taking over as a new lead (Claude, Copilot, or any other model)

1. `git status` on `feat/agent-boss` in `GhostForge-public`; read `AGENTS.md`.
2. Read the LIVE STATUS block below and `.agent-sync/state/boss.log` tail.
3. Review what merged since you last looked:
   `git log --oneline feat/agent-boss..agent/integration`.
4. Unblock **blocked** tasks (they failed 3 attempts): fix directly, or re-queue
   with better notes via `team.mjs add`.
5. Don't run a second boss — `boss.pid` is a lock; the watchdog restarts it.

## Branches

- `main` — the only current local and remote branch, per the user's request.
- `agent/integration` and `fix/job-hunter-free-models` were deleted on
  2026-10-07 after verifying both were ancestors of `main` (no unmerged commits).
- The team is stopped. Restarting its workflow can recreate integration and
  worker branches; the historical workflow instructions above describe that setup.

## History

- **2026-10-07** — Verified `main` contains both remaining branch tips, deleted
  the merged remote branches at the user's request, and repaired Job Hunter:
  compact AI-writing retry, clearly labelled original-CV/basic-letter drafts
  when AI is unavailable (manual approval only), automatic review opening,
  accurate application-result notices, and prepared-CV DOCX uploads. Added
  outage, approval-queue, UI, and real-browser upload/submission regressions.
  The full web suite has three pre-existing macOS failures (temporary-path
  canonicalization in agent/bridge tests and Bash 3.2 in the project wizard);
  Job Hunter regressions, root smoke, typecheck and changed-file lint pass.
  React Doctor changed-scope score is 81 with no new findings. — copilot

- **2026-09-30** — PRs #6–#10 merged (marketplace source of truth, Mark-LV +
  OpenJarvis bridge, Job Hunter autopilot, workflows engine). Built the
  boss/worker framework; Copilot ran it: 76 commits (agent-team API +
  `/agents` dashboard, TUI/JARVIS agent-team controls, templates,
  OpenAI-compatible provider, security fixes, Playwright/TUI/Electron tests).
- **2026-10-01 ~01:30** — Claude took over as boss: merged `agent/integration`
  into `feat/agent-boss` (ECC context layer + hardened prompt staging), added
  phase 4 (the mission), Claude boss with Copilot fallback, Claude worker,
  watchdog + scheduled task, and this auto-updated handoff.
- **2026-10-01 01:40–05:40 (overnight)** — 32 merges, health 100/100, PR #11
  updated: CLI/TUI/web parity (workflows, webhooks, collab, users, push,
  maintenance), bridge workflow/jobs APIs + contract tests, Electron headless
  smoke + Electron/Android CI, security sweep, `/agents` login redirect.
  Copilot boss fallback worked while Claude was out of quota.
- **2026-10-01 05:45 check-in** — Bug: Claude's "You've hit your session limit"
  wasn't recognised as a rate limit, so the Claude worker burned 3 instant
  attempts and blocked 13 tasks. Fixed `RATE_LIMIT_RE` (+ test), requeued the
  13, closed 4 superseded blocked tasks, restarted the boss.
- **2026-10-01 morning (11:10)** — ~55 tasks merged overnight; health 100/100.
  PR #11: 100 commits, 160 files, mergeable; CI 8 pass / 4 pending / 1 fail
  (Desktop linux — Electron SUID sandbox on Ubuntu 24.04; fix queued). Local
  verification on `agent/integration`: root `npm test` ✓, web-ui `tsc` ✓,
  web-ui tests 177/177 ✓. Bug fixed: a task pinned to rate-limited `claude`
  kept the board "active" ~4h (03:47–08:04 UTC) so planning stopped and all
  Copilot workers idled — pinned tasks now fall back to `any`.
- **2026-10-01 11:15–16:20** — User asked for a Claude-only team. Claude fixed
  the Linux Electron sandbox CI and 4 high CodeQL alerts, then hit its session
  limit (reset 16:00); Copilot took over meanwhile (T-094/096/097/098: token-
  bearing outbound URL validation, desktop smoke exits, React Doctor) and
  stopped the boss. **All 14 PR #11 checks green → PR #11 merged to `main`
  (`ccc4c29`).** Team restarted Claude-only (boss opus + claude, claude-2,
  claude-3) on top of the new `main`.

## Environment gotchas

- Windows host, no tmux; Git Bash + PowerShell. Node v23 (odd release — some
  native modules have no prebuilds, e.g. the `omc` CLI's better-sqlite3).
- `gh` must be logged in as **HishamAbulfeilat** (a second, old work account
  caused 403 push failures before 2026-10-01).
- Worker worktrees live next to the repo: `C:\Users\User\Desktop\gf-*`.

## LIVE STATUS

<!-- LIVE-STATUS:START -->
_Auto-updated by the boss (pid 28632) at 2026-10-16T00:40:17.799Z._

**Phase 4:** Production-perfect on every surface: every GhostForge feature works end to end and is reachable from the web UI, the TUI, the terminal CLI and JARVIS (feature parity — record gaps in docs/FEATURE-MATRIX.md and close them); the Electron desktop app builds and runs on Windows, macOS and Linux and the Android (Capacitor) app builds, with CI proving it; security hardened (fix every real finding from CodeQL, npm audit, secret/dependency scanners and security reviews); the Agentic OS dashboard (/agents) shows each agent's progress, the todo/in-progress/review/done/blocked board, messages, health and history; accessible, RTL-safe, polished UI. Keep going until every check is green, then keep improving.

**Health:** 67/100 · **merges this run:** 1 · **PR:** none yet · **boss:** claude

**Board:** todo 20 · in-progress 1 · review 0 · done 217 · blocked 26

**Agents**
- **claude** (claude): working on T-253

**In progress / review**
- T-253 [feature] Job Hunter: filter out jobs below the configured minimum salary before scoring them, and report how many were filtered — claude

**Next up (todo)**
- T-200 [docs] Docs: close the JARVIS/bridge gaps in docs/FEATURE-MATRIX.md — 18 rows where the bridge is the only ❌
- T-237 [docs] Document mark-l-bridge server endpoints in README
- T-254 [feature] Job Hunter: add a 'jobs stats' command showing applications submitted this week and month, response rate, and top companies
- T-255 [feature] Job Hunter: track interview stages per job (interviewing/offered/rejected with dates) and show them on the job card and CLI
- T-256 [feature] Job Hunter: pick a cover letter template by job type (engineering, design, product) and use it as the structure for the AI-written letter
- T-257 [performance] Job Hunter: run every job source query in parallel with a per-source timeout so one slow source cannot stall the search
- T-258 [performance] Agent World: poll every 30s while the tab is visible and 60s while hidden, using the visibilitychange event
- T-259 [feature] Agent World: focus-agent mode — selecting an agent card filters the world view and lists to that agent only, with a clear control to exit
- T-260 [feature] Agent World: per-agent activity timeline showing the tasks that agent started, completed or failed in the last hour, from the snapshot history
- T-261 [feature] Agent World: show cumulative API cost per agent for today and this week, derived from the boss token records, next to each agent card
- T-262 [feature] Agent World: keyboard shortcuts — 1/2/3 to switch worlds, / to focus the agent search, Escape to close the session drawer
- T-263 [feature] Agent World: export the current snapshot as a downloadable JSON file for debugging

**Blocked (needs a human or a fresh approach)**
- T-173 [chore] Untrack stale tui/node_modules from git (gitignored but 4221 files still tracked): 
- T-175 [chore] Untrack stale tui/node_modules from git (retry T-173): 
- T-182 [chore] Untrack stale tui/node_modules from git (retry T-173/T-175 now that maxBuffer is 256 MiB): 
- T-195 [chore] CI: run the four unrun electron-app test suites (outbound-url SSRF/credential-in-URL/CRLF, app-lifecycle shutdown cleanup, bridge-contract, headless-smoke) so they gate PRs: 
- T-196 [chore] CI: build web-ui, run the mcp and tui suites, add a commit status, and audit middleware PROTECTED_PREFIXES: 
- T-197 [bugfix] Give every git spawn an explicit maxBuffer so a 1 MiB default cannot silently ENOBUFS: 
- T-198 [bugfix] Boss: find and fix the real ENOBUFS, then land the tui/node_modules untracking that has failed 3x: 
- T-201 [feature] Web: add a baseline accessibility check and fix the violations it finds: Boss review rejected the change: - HALLUCINATION: imports undeclared package: @axe-core/playwright (not in package.json and not installed)
- T-208 [chore] Untrack stale tui/node_modules from git (retry after T-190/T-202 ENOBUFS fixes) and make root tests reject tracked node_modules: 
- T-217 [chore] Untrack stale tui/node_modules from git (retry T-208 now that the boss self-restarts with maxBuffer'd git) and make root tests reject tracked node_modules: 
- T-227 [feature] JARVIS bridge: read-only awesome-llm-apps and LLMFit model-fit catalog endpoints; close those FEATURE-MATRIX rows: Finished without committing anything. The tool expects json. We earlier used it with path and pattern. Let's do:  
- T-228 [feature] TUI: voicebox / voice-clone screen so the TUI cell for Voice clone goes from partial to full: …e and returns the contents as a string. I can then use this output to understand the current implementation of the voicebox feature and make the necessary changes to implement the voice-clone screen. 
- T-230 [security] Security: triage npm audit in electron-app and mcp and fix every high/critical advisory with non-breaking upgrades: …ened by 'git commit'. Please make sure all processes are terminated then try again. If it still fails, a git process may have crashed in this repository earlier: remove the file manually to continue. 
- T-233 [test] electron-app: headless-launch-smoke ENOENT on fresh npm ci on Windows (Electron 44 lazy binary download; test spawns dist/electron.exe directly): …ubtests (node:internal/test_runner/test:744:7) {     generatedMessage: true,     code: 'ERR_ASSERTION',     actual: 'Error: spawn echo ENOENT',     expected: 'aliased',     operator: 'strictEqual'   }
- T-234 [chore] Fix tui/node_modules git tracking issue to prevent ENOBUFS errors: 
- T-235 [feature] Implement voice input and output for JARVIS: Finished without committing anything. I keep getting validation errors because my JSON strings not properly escaped. I need to produce exact JSON with no escapes needed? Let's just try simple:  
- T-236 [feature] Implement push notifications for JARVIS: …ubtests (node:internal/test_runner/test:744:7) {     generatedMessage: true,     code: 'ERR_ASSERTION',     actual: 'Error: spawn echo ENOENT',     expected: 'aliased',     operator: 'strictEqual'   }
- T-238 [docs] Correct stale CHANGELOG claims: …ubtests (node:internal/test_runner/test:744:7) {     generatedMessage: true,     code: 'ERR_ASSERTION',     actual: 'Error: spawn echo ENOENT',     expected: 'aliased',     operator: 'strictEqual'   }
- T-241 [bugfix] Fix failing health check: web-ui unit tests (JARVIS tools, job hunter…): …inimal, stays within the `web-ui` area, and follows all conventions: No new packages are added, no logic is introduced outside the hook, and the patch keeps the test harness working on all platforms. 
- T-245 [test] Cross-platform Electron build: verify electron-builder.yml covers all 5 platforms (win/mac/linux/android/ios), fix platform-specific build issues, ensure native deps (sharp, playwright) work cross-platform, and add headless smoke test: …22m  context.getAncestors is not a function Occurred while linting C:\Users\User\Desktop\GhostForge\gf-integration\web-ui\app\agent-world\AgentWorldSwitcher.tsx:17 Rule: "@next/next/no-duplicate-head"
- T-246 [feature] Job Hunter: add job deduplication (merge same job from multiple sources), salary filter before scoring, and 'jobs stats' command (applications/response rate/top companies): 
- T-247 [feature] Job Hunter: add interview tracking (interviewing/offered/rejected with dates), cover letter templates per job type, and parallel source queries with timeout: 
- T-248 [feature] Agent World: adaptive refresh (30s visible/60s hidden), focus agent mode, agent activity timeline, agent cost tracking, and diff-based Pixi re-rendering: 
- T-249 [feature] Agent World: keyboard shortcuts (1/2/3 worlds, / search, Esc), export snapshot as JSON, and React.memo to prevent unnecessary re-renders: 
- T-250 [feature] Agents dashboard: add real-time progress bars, ETA per task, completion forecast, per-agent activity stream, and resource usage to /agents: 
- T-251 [feature] Web UI: virtualize job list (react-window) for >50 jobs, React.memo on JobHunterWidget, and API request deduplication (1s window): 

**Recently done**
- T-224 [fix] Bridge server: reject a null JSON body on /copilot and /execute (uncaught TypeError kills the process) — claude
- T-225 [fix] Bridge server: cap readJsonBody by bytes, not characters (a multi-byte body can exceed MAX_BODY_BYTES by 4x and also grows a string unbounded before the check) — claude
- T-226 [feature] JARVIS bridge: token-auth read-only tickets, Azure DevOps and estimate endpoints; close that FEATURE-MATRIX row — claude
- T-229 [feature] Web: admin-only projects page to list, open and scaffold projects, closing the partial Web cell — claude-3
- T-231 [test] Bridge tests: pytest coverage for the read-only snippets, changelog, setup-status, code-health and resource-catalog endpoints — claude-3
- T-232 [security] Bridge: separate review of readJsonBody drain-past-cap change (MAX_DRAIN_BYTES) that landed inside T-230 commit 5d32cd6 — claude
- T-239 [bugfix] Fix failing health check: Root smoke test (TUI parse, marketplace JSON) — claude
- T-240 [bugfix] Fix failing health check: web-ui unit tests (JARVIS tools, job hunter…) — claude-2
- T-242 [bugfix] Fix failing health check: web-ui npm audit (no high/critical) — claude
- T-243 [bugfix] Fix failing health check: Electron desktop app tests (incl. headless launch) — claude
- T-244 [bugfix] Fix failing health check: web-ui production build — claude
- T-252 [feature] Job Hunter: deduplicate jobs found from multiple sources, merging them into the highest-scoring existing job instead of adding duplicates — claude

**Latest messages**
- 2026-10-15T23:24 boss → all: …he current implementation of the voicebox feature and make the necessary changes to implement the voice-clone screen.  To unblock: review the last failure and decide whether it is code, config, or needs a human decision.
- 2026-10-15T23:34 boss → claude: … or missing dependencies), no additional code changes are needed. The feature matrix can now be updated to reflect the “✅” status for *Voice input (STT)* and *Voice output (TTS)* in the Web UI and Terminal CLI surfaces. 
- 2026-10-15T23:41 boss → claude: …mary for the boss**   `node scripts/agents/team.mjs done T-235 --agent claude "Voice input (STT) and voice output (TTS) are already fully implemented across the web UI and API endpoints. No code changes are necessary."` 
- 2026-10-15T23:49 boss → claude: …3 attempts (attempt 3/3): Finished without committing anything. I keep getting validation errors because my JSON strings not properly escaped. I need to produce exact JSON with no escapes needed? Let's just try simple:  
- 2026-10-15T23:49 boss → all: …se my JSON strings not properly escaped. I need to produce exact JSON with no escapes needed? Let's just try simple:   To unblock: review the last failure and decide whether it is code, config, or needs a human decision.
- 2026-10-15T23:59 boss → all: … T-252 merged from claude (health 67/100): Job Hunter: deduplicate jobs found from multiple sources, merging them into the highest-scoring existing job instead of adding duplicates.  Files: web-ui/lib/job-hunter/store.ts
- 2026-10-16T00:17 boss → claude: T-253 bounced (attempt 1/3): Health regressed 67 → 44. Broken checks: ### web-ui TypeScript typecheck lib/job-hunter/index.ts(146,3): error TS1005: ',' expected.
- 2026-10-16T00:19 boss → claude: …ommitting anything. (no final answer; model's reasoning follows) We need to filter out jobs below minimum salary for scoring. Need to read min salary config; probably in profile preferences or store. Search for setting. 
<!-- LIVE-STATUS:END -->
