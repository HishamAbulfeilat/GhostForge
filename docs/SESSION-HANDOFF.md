# GhostForge — Session Handoff (read this first)

**Any AI, any provider, any new session: this is the one file that tells you
what is going on.** The top half is written by humans/lead agents; the
`LIVE STATUS` block at the bottom is rewritten automatically by the boss every
couple of minutes while the agent team runs.

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

- `main` — protected; changes arrive only via the agent-team PR.
- `feat/agent-boss` — this checkout; agent framework + everything integrated so far.
- `agent/integration` — the boss's merge branch (worktree `../gf-integration`), PR → `main`.
- `agent/<provider>/…` — per-worker branches, reset onto integration before each task.

## History

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

## Environment gotchas

- Windows host, no tmux; Git Bash + PowerShell. Node v23 (odd release — some
  native modules have no prebuilds, e.g. the `omc` CLI's better-sqlite3).
- `gh` must be logged in as **HishamAbulfeilat** (a second account,
  `habulfeilat_ejadasa`, caused 403 push failures before 2026-10-01).
- Worker worktrees live next to the repo: `C:\Users\User\Desktop\gf-*`.

## LIVE STATUS

<!-- LIVE-STATUS:START -->
_Auto-updated by the boss (pid 28660) at 2026-10-01T08:11:48.015Z._

**Phase 4:** Production-perfect on every surface: every GhostForge feature works end to end and is reachable from the web UI, the TUI, the terminal CLI and JARVIS (feature parity — record gaps in docs/FEATURE-MATRIX.md and close them); the Electron desktop app builds and runs on Windows, macOS and Linux and the Android (Capacitor) app builds, with CI proving it; security hardened (fix every real finding from CodeQL, npm audit, secret/dependency scanners and security reviews); the Agentic OS dashboard (/agents) shows each agent's progress, the todo/in-progress/review/done/blocked board, messages, health and history; accessible, RTL-safe, polished UI. Keep going until every check is green, then keep improving.

**Health:** ?/100 · **merges this run:** 0 · **PR:** none yet · **boss:** claude (fallback copilot)

**Board:** todo 2 · in-progress 5 · review 0 · done 76 · blocked 5

**Agents**
- **claude** (claude): working on T-090
- **copilot-tui** (copilot): working on T-089
- **copilot-desktop** (copilot): working on T-091
- **copilot-web** (copilot): working on T-093
- **copilot-integration** (copilot): idle
- **copilot-quality** (copilot): working on T-092

**In progress / review**
- T-089 [feature] Wire existing users, collab, device-status and awesome-llm-apps scripts into the ghostforge CLI dispatcher — copilot-tui
- T-090 [bugfix] Redo T-086: add a bounded packaged-app build script using the real electron-app npm script names — claude
- T-091 [chore] Consolidate Android CI into a single workflow (resolve T-043) — copilot-desktop
- T-092 [docs] Refresh FEATURE-MATRIX n8n, collaboration, users and device rows from current code — copilot-quality
- T-093 [feature] Add an authenticated web page for snippets, changelog and README — copilot-web

**Next up (todo)**
- T-094 [feature] Add a read-only JARVIS bridge contract for listing users and access profiles
- T-095 [test] Fix Desktop (linux) CI: Electron headless smoke aborts with 'SUID sandbox helper binary ... not configured correctly' (Ubuntu 24.04 restricts unprivileged user namespaces). In the Linux job add a step before the smoke test: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 (keeps Chromium sandbox ON — do NOT add --no-sandbox to the app). Verify on PR #11 that Desktop (linux) passes

**Blocked (needs a human or a fresh approach)**
- T-041 [feature] Agentic OS dashboard: add a kanban board (todo/in-progress/review/done/blocked) with per-agent progress, current task, model/provider, elapsed time and recent history to /agents, backed by the existing /api/agents snapshot: …e, hiding the snapshot's explicit current task. - Elapsed time is only measured since the dashboard first observed a task; it resets on page load and does not represent time already spent on the task.
- T-043 [bugfix] Android: make the Capacitor Android app build in CI (debug APK artifact) and document how to run it: …desktop job that is no longer there after b5d12c7 on agent/integration) and will conflict; rebase and keep one Android workflow (rename/replace electron-android-validation.yml instead of keeping both)
- T-055 [feature] Add TUI and CLI surfaces for workflow runs, n8n, and webhook triggers: …n in the review are absent from the current checkout: the n8n scripts/tests do not exist, scripts/test.js does not run the new regression tests, and tui/index.js has no n8n menu or screen integration.
- T-081 [feature] Test task: …pts as the file area; it contains no requested behavior, acceptance criteria, or test target to implement. Please reassign T-081 with a concrete objective. Current agent status reports health 100/100.
- T-086 [feature] Expose packaged app builds in the terminal CLI: …oss review rejected the change: - Electron macOS and Windows builds invoke nonexistent npm scripts: the CLI uses build:macos/build:windows, while electron-app/package.json defines build:mac/build:win.

**Recently done**
- T-075 [feature] Add workflow execution to the terminal CLI — copilot-integration
- T-076 [feature] Add workflow controls to the TUI — copilot-tui
- T-077 [docs] Refresh feature parity matrix after completed workflow surfaces — copilot-quality
- T-078 [feature] Add TUI webhook management controls — copilot-tui
- T-079 [feature] Replace bridge job search and autopilot stubs — copilot-integration
- T-080 [test] Add Electron headless launch smoke validation — copilot-desktop
- T-082 [feature] Complete Agentic OS kanban dashboard — copilot-web
- T-083 [feature] Expose live device status and remote setup through JARVIS — copilot-integration
- T-084 [feature] Add terminal n8n automation controls — copilot-integration
- T-085 [feature] Add TUI n8n automation screen — copilot-tui
- T-087 [feature] Add JARVIS n8n bridge contract — claude
- T-088 [docs] Refresh phase-four feature matrix after surface work — copilot-quality

**Latest messages**
- 2026-10-01T03:43 boss → all: …mote setup through JARVIS. Added authenticated live device status and bounded remote setup; websockify is loopback-only and unverified listeners are refused. Files: mark-l-bridge/server.py, mark-l-bridge/test_contract.py
- 2026-10-01T03:43 boss → copilot-tui: … after 3 attempts: Boss review rejected the change: - Electron macOS and Windows builds invoke nonexistent npm scripts: the CLI uses build:macos/build:windows, while electron-app/package.json defines build:mac/build:win.
- 2026-10-01T03:46 boss → all: …and wired ghostforge/cli dispatch and help. Focused tests 6/6, npm test, health 100/100, syntax and diff checks pass. Commit 531b600. Files: cli/index.js, ghostforge, scripts/n8n.mjs, scripts/n8n.sh, scripts/n8n.test.mjs
- 2026-10-01T03:46 boss → all: PR to main updated with 75 task(s): https://github.com/HishamAbulfeilat/GhostForge/pull/11
- 2026-10-01T08:04 boss → all: …no API key sent; 502 on n8n failure. 5 new contract tests; bridge suite 22/22, health 100/100. Files: mark-l-bridge/server.py, mark-l-bridge/test_contract.py Files: mark-l-bridge/server.py, mark-l-bridge/test_contract.py
- 2026-10-01T08:08 boss → all: Health 100/100. Planned 6 new task(s) for phase 4.
- 2026-10-01T08:09 boss → all: Boss online. Template: null. Agents: claude, copilot-tui, copilot-desktop, copilot-web, copilot-integration, copilot-quality. Phase 4.
- 2026-10-01T08:11 boss → human: …ob add a step before the smoke test: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 (keeps Chromium sandbox ON — do NOT add --no-sandbox to the app). Verify on PR #11 that Desktop (linux) passes" as T-095.
<!-- LIVE-STATUS:END -->
