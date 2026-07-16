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

## Tailwind Dark Mode
**Issue**: UI work can drift into unsupported dark mode variants
**Fix**: Dark mode is disabled (`darkMode: ['false']`), so do not add `dark:` classes or dark-mode toggles
**Files**: `tailwind.config.js`, `src/components/**`

## next-intl Routing
**Issue**: Locale-aware navigation breaks when importing router utilities from the wrong module
**Fix**: Always import `Link` and `useRouter` from `@/i18n/navigation`, not `next/navigation`; Arabic is the default locale, so do not force `/ar/` prefixes
**Files**: `src/i18n/navigation.ts`, `src/app/[locale]/**`

## Hijri Calendar
**Issue**: Hijri dates become inconsistent when formatted with Gregorian helpers
**Fix**: Use `moment-hijri` and format values as `iYYYY/iMM/iDD`
**Files**: `src/utils/date.ts`, `src/components/**`

## DOMPurify
**Issue**: Rendering HTML from APIs without sanitization creates XSS risk
**Fix**: Always sanitize incoming HTML with `dompurify` before using `dangerouslySetInnerHTML`
**Files**: `src/components/**`, `src/utils/sanitizeHtml.ts`

## MSAL Token Refresh
**Issue**: Interactive auth prompts appear too early when silent refresh paths are skipped
**Fix**: Call `acquireTokenSilent` first and fall back to `acquireTokenPopup` only when required
**Files**: `src/services/auth.ts`, `src/providers/**`
