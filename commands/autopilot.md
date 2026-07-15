# /autopilot Mode

## Description
Switches the AI into **Autopilot Mode** — all commands run automatically without asking for confirmation. The AI makes decisions, applies changes, runs tests, and commits without pausing. Use when you trust the AI to work independently.

## Usage
```
/autopilot on          → Enable autopilot for this session
/autopilot off         → Return to normal (confirmation required)
/autopilot             → Toggle current mode
```

## Behavior in Autopilot Mode

When autopilot is ON, the AI will:
- ✅ Auto-approve all file changes without asking
- ✅ Auto-run all commands (npm install, tests, builds, lints)
- ✅ Auto-commit changes with descriptive messages
- ✅ Auto-install missing packages needed for a task
- ✅ Auto-generate missing tests without asking
- ✅ Auto-fix lint and type errors found during execution
- ✅ Auto-select the best option when multiple choices exist
- ✅ Continue to the next step without waiting for input
- ✅ Auto-push branches and open PRs when deployment is requested

## Decisions Made Automatically in Autopilot

| Decision | Auto-choice |
|----------|------------|
| TypeScript vs JS | TypeScript (always) |
| Test runner | Keep existing or use Jest |
| Package manager | Keep existing or use npm |
| Styling | Keep existing or use Tailwind |
| Commit message format | Conventional commits |
| Branch naming | `feat/`, `fix/`, `chore/` prefix |
| PR target branch | `develop` (if exists) else `main` |

## Status Indicator
The AI prefixes every action with `⚡ [AUTOPILOT]` so you can track what it's doing:
```
⚡ [AUTOPILOT] Installing missing dependency: msw
⚡ [AUTOPILOT] Fixing lint error in LoginScreen.tsx
⚡ [AUTOPILOT] Running tests — 14/14 passed
⚡ [AUTOPILOT] Committing: fix(auth): handle token expiry
⚡ [AUTOPILOT] Pushing branch fix/auto-tickets-2025-07-15
⚡ [AUTOPILOT] Opening PR: "🤖 Auto-fix: 6 bugs resolved"
```

## Session Summary
At the end of an autopilot session, a full summary is shown:
```
⚡ Autopilot Session Summary
════════════════════════════
Files changed   : 14
Tests written   : 8
Tests passed    : 47/47
Bugs fixed      : 6
Commits made    : 6
Branch pushed   : fix/auto-tickets-2025-07-15
PR opened       : #23
Duration        : 4m 32s
════════════════════════════
Type /autopilot off to return to safe mode.
```

## Disable Autopilot
```
/autopilot off
→ Returning to normal mode. AI will ask before every change.
```

> ⚠️ Autopilot is powerful — use it when you're confident in the task scope. For sensitive changes (production deploys, auth changes, DB migrations), consider using /safe mode instead.
