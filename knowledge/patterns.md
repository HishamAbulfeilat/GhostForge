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
