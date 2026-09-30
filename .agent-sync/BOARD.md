# Agent Board

Shared task board for the multi-agent workflow. Protocol:
`docs/MULTI-AGENT-WORKFLOW.md`. Claim a task by setting `owner` +
`in-progress` and pushing **this file** first (first-writer-wins lock).

Legend — status: `todo` · `in-progress` · `review` · `blocked` · `done`.
Tag `[claude]` / `[copilot]` restricts an owner; `[ ]` = anyone.

| id | tag | task | area | owner | status | notes |
|----|-----|------|------|-------|--------|-------|
| T-01 | [ ] | Deeper OpenJarvis bridge: expose `/api/openjarvis/*` endpoints in `mark-l-bridge/server.py` that call the installed OpenJarvis package | `mark-l-bridge/` | copilot | done | health/doctor/ask endpoints, shells out to `jarvis` CLI with fixed argv, 503 stub when not installed |
| T-02 | [copilot] | Web UI: add an "OpenJarvis" panel + `web-ui/lib/openjarvis.ts` client hitting the new endpoints | `web-ui/` | copilot | done | lib client + `/api/openjarvis` proxy route + `OpenJarvisPanel.tsx` wired into `app/jarvis/page.tsx`; 67/67 web-ui tests pass |
| T-03 | [claude] | Marketplace: verify every catalog `install_command` works cross-platform; fix any macOS-only ones | `marketplace/`, `tui/` | copilot | in-progress | Claude unavailable this cycle; copilot claiming per solo-session rules — flagged in MESSAGES.md. run `npm test` after |
| T-04 | [ ] | Add `web-ui` ESLint config (PR quality check reports "no eslint config") | `web-ui/` | copilot | done | `eslint.config.mjs` already present and working (verified via `npx eslint`) — closing as already resolved |
| T-05 | [ ] | Knip: resolve the 10 unused-file warnings from PR quality check | `web-ui/` | copilot | done | Deleted 8 dead, never-imported components; added `web-ui/knip.jsonc` ignoring 2 legit false positives (`public/sw.js` string-path SW registration, `lib/quick-actions.ts` intentional dual .js/.ts resolution split). `npx knip` now reports 0 unused files. |
| T-06 | [ ] | Tests: add root unit tests under `tests/*.test.js` so `scripts/test.js` runs them | `tests/` | copilot | done | Added `tests/marketplace.test.js` (5 node:test cases covering the effective-installed-set formula); `scripts/test.js` now discovers + runs `tests/*.test.js` as a 6th smoke-test check |
| T-07 | [ ] | Docs: refresh `README.md` feature list + bridge section to match current code | root | copilot | done | Added Mark-LV/OpenJarvis/Marketplace to Integrations + architecture tree + tech stack; fixed the Keyboard Shortcuts table to match actually-wired shortcuts (Ctrl/Cmd+K, Ctrl+Alt+V, Ctrl/Cmd+S) |

## Human notes

- Branch cleanup (`mark-l`, `openjarvis`, `ultimate`, merged `ccr-*`) must be
  done by a human — org policy blocks branch deletion from the cloud session.
- Keep this board current; add rows as work is discovered.
