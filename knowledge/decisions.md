# Architecture Decision Records

## ADR-001: State Management — Zustand + React Query
**Date**: 2025-01-15
**Decision**: Use Zustand for UI state, React Query for server state
**Reason**: Lighter than Redux, React Query handles caching/refetch automatically
**Status**: Accepted

## ADR-002: Authentication Standard — Azure AD / Entra ID
**Date**: 2025-02-10
**Decision**: Standardize on Azure AD for enterprise-facing apps unless a project has an approved exception
**Reason**: Aligns with client SSO expectations, conditional access, and centralized identity governance
**Status**: Accepted

## ADR-003: Frontend Default — Next.js + TypeScript + Tailwind
**Date**: 2025-03-05
**Decision**: Default new web apps to Next.js, strict TypeScript, and Tailwind CSS
**Reason**: Strong DX, scalable patterns, SSR/App Router support, and fast UI delivery with design-system consistency
**Status**: Accepted

## ADR-004: Marketplace install state — registry.json is source of truth
**Date**: 2026-09-30
**Decision**: `marketplace/registry.json` (`installed[]` + `removed[]`) is the
single source of truth for install state, seeded by `catalog.json` items marked
`installed: true`. Both the web API and the TUI compute the effective set the
same way; neither writes install flags back into `catalog.json`.
**Reason**: The TUI previously wrote `installed:true` into `catalog.json` while
the web UI read/wrote `registry.json`, so the two surfaces disagreed about what
was installed.
**Status**: Accepted

## ADR-005: Security tooling — defensive/dual-use installable, offensive suites are pointers
**Date**: 2026-09-30
**Decision**: Defensive scanners and standard dual-use recon/scanning tools ship
with real install commands under an "authorized testing only" framing. Offensive
suites that bundle DDoS or phishing/credential-harvesting (HackingTool,
AllHackingTools, Strix) are listed as review-first pointers to upstream, never a
one-click "install everything" wiring. The `security-scan` skill is defensive
(scan/report/fix), not offensive.
**Reason**: Keep the marketplace useful for authorized security work without
packaging attack-third-parties tooling for point-and-click use.
**Status**: Accepted

## ADR-006: Accepted risk — TUI dashboard dependency chain remains vulnerable upstream
**Date**: 2026-10-01
**Decision**: Keep the TUI dashboard on `blessed-contrib@^4.11.0` and accept the
remaining `lodash`/`marked`/`xml2js` advisories until a non-vulnerable
replacement for the dashboard library is adopted. We upgraded the direct leaf
packages we could to their latest secure versions, but the upstream dashboard
library still bundles the vulnerable transitive copies.
**Reason**: `npm audit` shows the remaining high-severity issues are nested inside
`blessed-contrib` itself (`lodash@4.17.23`, `marked@4.3.0`, `xml2js@0.4.23`).
There is no patched upstream release of the library available in the current
project ecosystem, and a replacement would require a broader TUI dashboard
rewrite outside the scope of this targeted security sweep.
**Status**: Accepted

## ADR-007: electron-app — override @electron/get to 5.x to clear the http-cache-semantics advisory
**Date**: 2026-10-04
**Decision**: Add an `overrides` entry pinning `@electron/get` to `^5.1.0` in
`electron-app/package.json`, and do NOT apply the fix `npm audit` proposes.
`mcp/` needed no change (0 vulnerabilities).
**Reason**: All 8 high-severity findings in `electron-app` collapse to a single
advisory, GHSA-ch52-4w7c-c8xp in `http-cache-semantics@4.2.0`, reached only
through the build-time chain
`electron-builder -> app-builder-lib -> @electron/get@3 -> got -> cacheable-request -> http-cache-semantics`.
Two facts drove the decision:

1. **No upstream fix exists.** The advisory reports
   `vulnerable_version_range: "<= 4.2.0"` with `first_patched_version: null`,
   and `http-cache-semantics@4.2.0` is the newest published version. npm's own
   vulnerable range for the package is `*`. There is no version to upgrade to,
   so the fix has to remove the package from the tree, not update it.
2. **The fix npm suggests makes things worse.** `npm audit fix --force` offers
   to install `electron-builder@26.5.0`, a *downgrade* from the pinned
   `^26.15.3`. Measured on a clean lockfile, that resolves to 14 vulnerabilities
   (13 high, **1 critical**) versus 8 high at the current version. Every newer
   `app-builder-lib` (26.15.7, 26.16.1, 26.17.0) still depends on
   `@electron/get@^3.0.0`, so no electron-builder upgrade escapes the chain.

`@electron/get@5.x` dropped its `got` dependency entirely, which severs the
chain at its only reachable source. The override removes `got`,
`cacheable-request` and `http-cache-semantics` from the tree (618 lines of
lockfile) and takes the audit to 0.

**Why this is safe rather than just quiet:** `@electron/get` 3→5 is a major bump,
so the override was checked against the one call site that consumes it.
`app-builder-lib/out/binDownload.js` imports `downloadArtifact` and
`ElectronDownloadCacheMode`; both exist in 5.1.0 with unchanged signatures
(`downloadArtifact(details) => Promise<string>`). v5 is ESM-only while v3 is
CJS, but app-builder-lib already reaches it through
`helpers/dynamic-import.js`, a native `import()` helper added specifically so
ESM-only packages do not get collapsed to `require()` by TypeScript's CommonJS
transform — so the ESM switch is the path it was already built to handle. The
override is verified by the electron-app suite, whose `headless-smoke` test
launches the real Electron binary rather than mocking the download.
**Reachability**: build-time only. `@electron/get` is a `devDependencies` path
used when electron-builder downloads platform binaries for packaging; it is not
in the shipped app bundle and no shipped code path reaches it.
**Status**: Accepted
