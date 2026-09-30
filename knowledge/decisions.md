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
