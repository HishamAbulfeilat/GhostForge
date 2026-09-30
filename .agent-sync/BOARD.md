# Agent Board

Shared task board for the multi-agent workflow. Protocol:
`docs/MULTI-AGENT-WORKFLOW.md`. Claim a task by setting `owner` +
`in-progress` and pushing **this file** first (first-writer-wins lock).

Legend — status: `todo` · `in-progress` · `review` · `blocked` · `done`.
Tag `[claude]` / `[copilot]` restricts an owner; `[ ]` = anyone.

| id | tag | task | area | owner | status | notes |
|----|-----|------|------|-------|--------|-------|
| T-01 | [ ] | Deeper OpenJarvis bridge: expose `/api/openjarvis/*` endpoints in `mark-l-bridge/server.py` that call the installed OpenJarvis package | `mark-l-bridge/` | copilot | in-progress | opt-in dep already documented; add graceful stub when not installed |
| T-02 | [copilot] | Web UI: add an "OpenJarvis" panel + `web-ui/lib/openjarvis.ts` client hitting the new endpoints | `web-ui/` | – | todo | mirror `mark-liv-bridge.ts` pattern |
| T-03 | [claude] | Marketplace: verify every catalog `install_command` works cross-platform; fix any macOS-only ones | `marketplace/`, `tui/` | – | todo | run `npm test` after |
| T-04 | [ ] | Add `web-ui` ESLint config (PR quality check reports "no eslint config") | `web-ui/` | – | todo | flat config `eslint.config.mjs` |
| T-05 | [ ] | Knip: resolve the 10 unused-file warnings from PR quality check | `web-ui/` | – | todo | `cd web-ui && npx knip` |
| T-06 | [ ] | Tests: add root unit tests under `tests/*.test.js` so `scripts/test.js` runs them | `tests/` | – | todo | node:test |
| T-07 | [ ] | Docs: refresh `README.md` feature list + bridge section to match current code | root | – | todo | Mark-LV + OpenJarvis + marketplace |

## Human notes

- Branch cleanup (`mark-l`, `openjarvis`, `ultimate`, merged `ccr-*`) must be
  done by a human — org policy blocks branch deletion from the cloud session.
- Keep this board current; add rows as work is discovered.
