# Team Patterns and Conventions

## React and Next.js
- Prefer server-first data loading where it simplifies auth and caching.
- Keep route-specific UI inside feature folders close to its page or layout.
- Use typed server actions or service functions instead of inline fetch logic in many components.

## State management
- Use Zustand for local/UI state.
- Use React Query for server state, caching, retries, and invalidation.
- Avoid duplicating server state in local stores unless there is a strong UX reason.

## API layer
- Centralize HTTP clients, interceptors, and auth token refresh logic.
- Validate request/response payloads at boundaries using typed schemas where possible.
- Normalize backend errors into user-friendly messages before surfacing them to the UI.

## Testing
- Add focused tests for changed behavior before broadening to larger suites.
- Keep component tests close to the component or feature they cover.
- For regressions, write a failing test first when the project test setup makes that practical.

## Accessibility and i18n
- WCAG 2.1 AA is the minimum baseline.
- All new UI must account for keyboard access, screen readers, and Arabic RTL support.
- Prefer semantic HTML and avoid clickable `div`/`span` patterns.

## Architecture
- Use a hybrid of Atomic Design and Domain-Driven Design.
- Structure UI into atoms, molecules, and organisms while keeping domain services, models, and workflows grouped by business capability.
- Keep presentational components separate from domain service and data access layers.

## Barrel Exports
- Every shared folder should expose an `index.ts` file.
- Prefer importing from the folder root instead of deep internal paths when a barrel exists.

## Azure AD SSO
- Use `@azure/msal-react` with `MsalProvider` at the application boundary.
- Use hooks like `useAccount` and `useIsAuthenticated` in client components that need auth state.
- Centralize token acquisition and refresh behavior in shared auth services.
