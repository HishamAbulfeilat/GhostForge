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
