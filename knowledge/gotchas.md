# Known Gotchas

## Azure AD token refresh
**Issue**: Token silently expires after 1h in mobile
**Fix**: Always wrap MSAL calls in try/catch and call `acquireTokenSilent` first
**Files**: `src/services/auth.ts`

## Next.js App Router caching on dashboards
**Issue**: KPI widgets can show stale data after server actions or background refreshes
**Fix**: Use explicit `revalidatePath`/`revalidateTag` and avoid relying on implicit cache invalidation
**Files**: `src/app/(dashboard)/**`, `src/lib/data/**`

## React Native Hermes Intl support
**Issue**: Arabic date formatting may differ between iOS and Android builds when Intl polyfills are missing
**Fix**: Load required Intl polyfills before rendering localization-dependent screens
**Files**: `App.tsx`, `src/i18n/index.ts`

## Azure Static Web Apps API auth headers
**Issue**: Backend auth failures can happen when assuming custom headers always survive proxy hops
**Fix**: Read bearer tokens from the standard `Authorization` header and validate fallback proxy settings in staging
**Files**: `api/**`, `src/services/http.ts`

## Sitecore Experience Editor hydration mismatch
**Issue**: Client-only components inside editable placeholders can break Experience Editor rendering
**Fix**: Guard browser-only logic and defer interactive widgets until after hydration
**Files**: `src/components/sitecore/**`, `src/lib/sitecore/**`
