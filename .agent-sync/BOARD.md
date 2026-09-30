# Agent Board

Shared task board for the multi-agent workflow. Protocol:
`docs/MULTI-AGENT-WORKFLOW.md`. Claim a task by setting `owner` +
`in-progress` and pushing **this file** first (first-writer-wins lock).

Legend — status: `todo` · `in-progress` · `review` · `blocked` · `done`.
Tag `[claude]` / `[copilot]` restricts an owner; `[ ]` = anyone.
New role tags (multi-agent parallel run, 2024): `[dev]` `[qa]` `[security]`
`[perf]` `[design]` — each is a **dedicated Copilot CLI instance in its own
worktree/branch**. **Do not claim a task tagged for another role** — even if
it looks `todo` and you finish your own queue. Stick to your lane's `area`
column to avoid merge conflicts; if you must touch a shared file, `git pull
--rebase` before pushing and never drop another agent's changes.

| id | tag | task | area | owner | status | notes |
|----|-----|------|------|-------|--------|-------|
| T-01 | [ ] | Deeper OpenJarvis bridge: expose `/api/openjarvis/*` endpoints in `mark-l-bridge/server.py` that call the installed OpenJarvis package | `mark-l-bridge/` | copilot | done | health/doctor/ask endpoints, shells out to `jarvis` CLI with fixed argv, 503 stub when not installed |
| T-02 | [copilot] | Web UI: add an "OpenJarvis" panel + `web-ui/lib/openjarvis.ts` client hitting the new endpoints | `web-ui/` | copilot | done | lib client + `/api/openjarvis` proxy route + `OpenJarvisPanel.tsx` wired into `app/jarvis/page.tsx`; 67/67 web-ui tests pass |
| T-03 | [claude] | Marketplace: verify every catalog `install_command` works cross-platform; fix any macOS-only ones | `marketplace/`, `tui/` | copilot | done | No catalog entry was macOS-only-with-no-fallback (all already had brew\|\|apt-get/go-install/pip fallbacks). Added verified `install_command_windows` (winget) for nmap, gitleaks, lazygit, k9s, act, trivy, osv-scanner; TUI picks it on win32. Documented convention in marketplace/README.md. |
| T-04 | [ ] | Add `web-ui` ESLint config (PR quality check reports "no eslint config") | `web-ui/` | copilot | done | `eslint.config.mjs` already present and working (verified via `npx eslint`) — closing as already resolved |
| T-05 | [ ] | Knip: resolve the 10 unused-file warnings from PR quality check | `web-ui/` | copilot | done | Deleted 8 dead, never-imported components; added `web-ui/knip.jsonc` ignoring 2 legit false positives (`public/sw.js` string-path SW registration, `lib/quick-actions.ts` intentional dual .js/.ts resolution split). `npx knip` now reports 0 unused files. |
| T-06 | [dev] | Tests: add root unit tests under `tests/*.test.js` so `scripts/test.js` runs them | `tests/` | copilot | done | Added `tests/marketplace.test.js` (5 node:test cases covering the effective-installed-set formula); `scripts/test.js` now discovers + runs `tests/*.test.js` as a 6th smoke-test check |
| T-07 | [dev] | Docs: refresh `README.md` feature list + bridge section to match current code | root | copilot | done | Added Mark-LV/OpenJarvis/Marketplace to Integrations + architecture tree + tech stack; fixed the Keyboard Shortcuts table to match actually-wired shortcuts (Ctrl/Cmd+K, Ctrl+Alt+V, Ctrl/Cmd+S) |
| T-08 | [qa] | QA: audit test coverage across `web-ui/test`, `tui/`, and root `tests/`; add missing unit/integration tests for untested components, API routes, and utils. Run full suites (`npm test` root, `cd web-ui && npm test`) and fix any flaky/broken tests you find | `web-ui/test`, `web-ui/**/__tests__`, `tests/` | copilot-qa | in-progress | do not touch non-test source files unless a test reveals a real bug — then fix minimally and note it |
| T-09 | [security] | Security: run `npx react-doctor@latest --category Security` and a manual OWASP-style pass over `web-ui/app/api/*`, `mark-l-bridge/server.py`, and `mcp/` (input validation, auth checks, secrets, injection, XSS via `dompurify` usage). `npm audit` at root and in `web-ui`. Fix real findings with minimal patches; document anything you can't safely auto-fix in `SECURITY-REVIEW.md` | `web-ui/app/api`, `mark-l-bridge/`, `mcp/`, `SECURITY-REVIEW.md` | copilot-security | in-progress | starting OWASP pass + npm audit |
| T-10 | [perf] | Performance: audit `web-ui` bundle size and Lighthouse-style metrics (`npx react-doctor@latest --category Performance`). Apply top wins — dynamic imports for heavy client components, `next/image` usage, avoiding unnecessary re-renders, memoization — with minimal, additive changes. Re-run `npm test`/`npm run build` after each change | `web-ui/app`, `web-ui/components`, `web-ui/next.config.*` | copilot-perf | in-progress | starting audit |
| T-11 | [design] | Design/UX/UI: run `npx react-doctor@latest --category Accessibility` and fix WCAG 2.1 AA issues (contrast, ARIA, keyboard nav), plus any physical-direction Tailwind classes (`ml-`/`mr-`/`text-left`/`text-right`) that should be logical (`ms-`/`me-`/`text-start`/`text-end`) per `AGENTS.md` RTL rules. Verify `mos-design-system` components are used before custom UI | `web-ui/components`, `web-ui/app` | copilot-design | in-progress | claimed by design agent, starting a11y + RTL audit |
| T-12 | [qa] | Cross-device QA: verify responsive layout + RTL (Arabic) rendering across mobile/tablet/desktop breakpoints in `web-ui`; add/extend Playwright or RTL viewport tests if the harness supports it, otherwise document manual verification steps | `web-ui/test` | – | todo | depends on T-08 test harness groundwork; pick up after or in parallel if disjoint |

## Human notes

- Branch cleanup (`mark-l`, `openjarvis`, `ultimate`, merged `ccr-*`) must be
  done by a human — org policy blocks branch deletion from the cloud session.
- Keep this board current; add rows as work is discovered.
- **2024 multi-agent parallel run**: dev (`gf-copilot`, branch
  `agent/copilot/main`), qa (`gf-copilot-qa`, `agent/copilot/qa`), security
  (`gf-copilot-security`, `agent/copilot/security`), perf
  (`gf-copilot-perf`, `agent/copilot/perf`), design
  (`gf-copilot-design`, `agent/copilot/design`) are all running as separate
  detached Copilot CLI processes pushing straight to `main`. Claude is
  rate-limited and not running. If you are `[dev]`/`copilot`: only claim
  `[ ]`/`[copilot]`/`[claude]`/`[dev]` tasks, leave `[qa]`/`[security]`/
  `[perf]`/`[design]` tasks alone even when idle.
