# GhostForge core: recommendations

Follow-up work found during a performance and bug pass over GhostForge core
(web-ui, `web-ui/server.js`, `tui/index.js`). Job Hunter and Agent World are
out of scope here.

## Already done on this branch

| Commit | Change |
|---|---|
| `fix(web-ui)` | A WebSocket upgrade with a malformed `Host` header no longer throws inside `server.js` (it was an uncaught exception and left the socket open). |
| `perf(dashboard)` | `/api/dashboard` runs its three `gh` calls alongside the other probes instead of one after another (worst case was about 36 s extra), and reads only the last 64 KB of `audit.log`, skipping malformed lines. |
| `perf(system-info)` | Disk and battery readings are cached for 30 s, and the Linux battery is read from `/sys` without spawning `cat`. Before this, the metrics SSE stream ran blocking `df` and battery commands every 4 s for each open tab. |
| `fix(web-ui)` | `Permissions-Policy` now allows the mic and camera for the app's own origin. Before, `microphone=()` blocked JARVIS voice input in the browser. |
| `perf(tui)` | The TUI no longer runs `officecli --version` at startup, and no longer pipes a remote install script to bash, in the background and without asking, when the binary is missing. |
| `fix(dashboard)` | The dashboard no longer fetches its own home page to decide whether the web UI is up. In HTTPS mode that check always reported it as offline. |
| `perf(jarvis)` | The JARVIS HUD polls `/api/dashboard?scope=system` (metrics only). Before, it polled the full payload every 5 s, which spawned about 10 git and gh processes each time. |

## Ranked recommendations

Effort: **S** = hours, **M** = 1–3 days, **L** = a week or more.

### 1. Cache the dashboard's GitHub and git panels (stale-while-revalidate): S

- **What:** Keep the `gh issue/run/pr list` and git tag/log results in a module-level cache for about 60 s. Serve the cached copy right away and refresh it in the background. Add a "refresh" button that skips the cache.
- **Why:** Even with the calls now running in parallel, every dashboard load and every 60 s auto-refresh starts about 9 processes and makes 3 GitHub API calls. The tag-date pipeline also runs one `git log` per tag. A cache makes repeat loads close to instant and keeps you within GitHub rate limits.
- **Files:** `web-ui/app/api/dashboard/route.ts`, `web-ui/app/dashboard/page.tsx`.

### 2. One shared metrics sampler for every SSE client: S

- **What:** `/api/metrics` starts a separate 4 s loop for each connected tab. Use a single module-level sampler that sends to a set of subscribers, starts when the first one connects, and stops when the last one leaves. Add a `cancel()` handler so a closed stream stops right away.
- **Why:** With N tabs open, the work is N times higher than needed. Sampling CPU from several loops also skews the CPU delta that `getCPU()` relies on.
- **Files:** `web-ui/app/api/metrics/route.ts`, `web-ui/lib/system-info.ts`, `web-ui/components/MacMetricsWidget.tsx`.

### 3. Make `server.js` boot non-blocking: S

- **What:** In dev mode, `ensureOmniRouteRunning()` calls `execSync('which omniroute')` at boot. That blocks startup, and `which` does not exist on Windows. Replace it with an async PATH lookup, or just the existing health probe. `getBridgeToken()` also reads the token file synchronously on every WebSocket upgrade; cache it and use `fs.watch` or a short TTL to pick up changes.
- **Why:** Faster cold start, and correct behaviour on Windows, where the watchdog runs the boss.
- **Files:** `web-ui/server.js`.

### 4. Split `app/api/jarvis/route.ts` (4,064 lines) into a tool registry: M

- **What:** Move each tool handler into its own module under `lib/jarvis/tools/` and load it lazily. Switch the sync `readFileSync`/`writeFileSync` calls on vault, goals and notes to `fs/promises`.
- **Why:** Every JARVIS request currently compiles and loads the whole file, which slows cold starts and dev rebuilds. The sync file I/O (19 call sites) blocks the event loop under load. Smaller modules are also much easier to review for security, which matters because this route runs host tools.
- **Files:** `web-ui/app/api/jarvis/route.ts`, `web-ui/lib/` (new `jarvis/tools/*`), `web-ui/test/jarvis-tool-registry.test.js`.

### 5. Break up the JARVIS page client component (3,646 lines): M/L

- **What:** Split `app/jarvis/page.tsx` into a server shell plus client islands (voice, chat, HUD/metrics, inbox, clipboard watcher). Load the voice, camera and screen-capture parts with `next/dynamic`. While doing this, fix the existing `react-hooks/exhaustive-deps` warnings and unused state, which ESLint flags 11 times.
- **Why:** This is the main page and it ships a very large client bundle on first load. Its many timers (1 s, 3 s, 5 s, 15 s, 20 s) all re-render the same giant component, and the stale-closure hook warnings are a likely source of bugs.
- **Files:** `web-ui/app/jarvis/page.tsx`, new `web-ui/app/jarvis/_components/*`.

### 6. Rotate and index the audit log: S

- **What:** `~/.ghostforge/audit.log` is append-only and is never rotated. Rotate it at about 5 MB (keep 3 files) in `lib/audit.ts`, and give the TUI and security pages a shared tail reader.
- **Why:** The log grows without limit on a long-running host. Readers other than the dashboard still read the whole file.
- **Files:** `web-ui/lib/audit.ts`, `tui/index.js` (`screenAuditLog`), `web-ui/app/security/`.

### 7. Lazy-load the TUI and replace its open-URL shell strings: M

- **What:** `tui/index.js` (about 8,000 lines) imports every dependency at startup and contains more than 40 copies of `execSync('open X || xdg-open X')`. Replace those with the existing `crossPlatformOpen()` helper from `tui/lib/platform-utils.js`, then move screens into `tui/screens/*.js` and load each with `await import()` when it is selected.
- **Why:** Faster startup. Opening links would also work on Windows, where `open`/`xdg-open` do nothing. Moving to argv-based spawning removes the shell-interpolation risk in the `open "${url}"` variants.
- **Files:** `tui/index.js`, `tui/lib/platform-utils.js`, new `tui/screens/`.

### 8. Dead code and dependency cleanup from knip: S

- **What:** `npx knip` (config already in `web-ui/knip.jsonc`) reports 4 unused files (`lib/cli-sessions.d.mts`, `scripts/hosted-user.mjs`, two Agent World `.d.mts`), an unused dependency (`screenshot-desktop`), an unlisted one (`@next/env`, used by `server.js`), and 177 unused exports. Delete what is truly unused, add `@next/env` to `package.json`, and run knip in CI.
- **Why:** Smaller installs and less code to review. `@next/env` currently works only because `next` happens to bring it in.
- **Files:** `web-ui/package.json`, `web-ui/knip.jsonc`, `.github/workflows/pr-check.yml`, the files knip lists.

### 9. Remove the duplicate `.js`/`.ts` library pairs: S/M

- **What:** `lib/agent-team-api.{js,ts}` and `lib/agent-workflow-templates.{js,ts}` exist as hand-maintained pairs. Keep the TypeScript version, and if Node tests need JS, have them load it with the `ts.transpileModule` pattern the route tests already use.
- **Why:** Two copies drift apart. A security fix applied to only one of them is a real risk.
- **Files:** `web-ui/lib/agent-team-api.*`, `web-ui/lib/agent-workflow-templates.*`, their tests.

### 10. Marketplace API: mtime cache and ETag: S

- **What:** `GET /api/marketplace` reads and parses about 76 KB of JSON (`catalog.json`, `sources.json`) on every call. Cache the parsed files by `mtimeMs` and return an `ETag` so the page can get a `304 Not Modified` back.
- **Why:** The page loads faster on repeat visits, and the response stays correct: the effective install set is still computed from `registry.json` on every request, as `CLAUDE.md` requires.
- **Files:** `web-ui/app/api/marketplace/route.ts`.

## Feature recommendations

### F1. "Health at a glance" status contract: M

One `/api/health` that reports each dependency (bridge, voice pipeline, OmniRoute, Ollama, gh auth, mkcert/HTTPS, push keys) as `ready / missing / offline / error`, each with a fix-it step. The dashboard, JARVIS HUD, TUI `doctor` and setup checklist would all read from it. Today each surface probes on its own and shows a different answer. This matches backlog item B2 in `docs/PRODUCT-ANALYSIS.md`.
**Files:** `web-ui/app/api/doctor/route.ts`, `web-ui/app/api/setup/route.ts`, `web-ui/app/api/dashboard/route.ts`, `tui/index.js`.

### F2. Voice permission onboarding: S

Now that the mic is no longer blocked by headers, add a first-use permission card on `/jarvis`. It would explain HTTPS, the mic prompt and how to recover from a denied permission (including Electron and Android). Use `navigator.permissions.query({ name: 'microphone' })` to show the current state.
**Files:** `web-ui/app/jarvis/page.tsx`, `web-ui/lib/voice-runtime.*`.

### F3. Opt-in, consented installer queue for marketplace tools: M

Replace scattered "install now?" prompts (OfficeCLI, career-ops, herdr, repowise and others) with one queue. It would show the exact command and its source, and record each consent in the audit log. It would work the same way in the TUI and the web marketplace and follow the security tooling policy in `CLAUDE.md`.
**Files:** `marketplace/install-commands.mjs`, `tui/index.js`, `web-ui/app/marketplace/page.tsx`, `web-ui/app/api/marketplace/route.ts`.

### F4. Dashboard "since you were away" digest: S/M

Use the cached GitHub panel (recommendation 1) to show new failing runs, PRs awaiting review and new tags since the last visit. It would be stored per user, and push notifications could alert on CI failures.
**Files:** `web-ui/app/dashboard/page.tsx`, `web-ui/app/api/dashboard/route.ts`, `web-ui/app/api/push/route.ts`.

### F5. Performance budget in CI: S

Run `next build`, record each route's first-load JS, and fail the PR when `/jarvis` or `/dashboard` grows by more than a set threshold. Add a startup timing check for `node tui/index.js --version`.
**Files:** `.github/workflows/pr-check.yml`, `scripts/test.js`.
