# QA & Test Prompts

## Generate Unit Tests
```
Generate comprehensive unit tests for this file/function:
[paste code or file path]

Cover:
- Happy path (success case)
- Error cases (API failure, invalid input, null/undefined)
- Edge cases (empty arrays, boundary values, concurrent calls)
- Async behavior (loading states, race conditions)
Use Jest + TypeScript. Follow existing test patterns in the project.
```

## Generate Component Tests
```
Generate React Testing Library tests for this component:
[paste component or file path]

Cover:
- Renders correctly with required props
- User interactions (click, type, submit)
- Conditional rendering (loading, error, empty states)
- Accessibility (ARIA roles, keyboard navigation)
- Snapshot test (optional)
```

## Generate E2E Test (Playwright)
```
Generate Playwright E2E test for this user flow:
[describe the flow: e.g. "user registers, verifies email, logs in, sees dashboard"]

Include:
- Test setup and teardown
- data-testid selectors (add to components if missing)
- Screenshot on failure
- Retry on flaky steps
- Run on: Chromium, Firefox, Mobile Chrome
```

## Generate E2E Test (Maestro — Mobile)
```
Generate Maestro flow YAML for this mobile user flow:
[describe the flow]

Include:
- App launch and initial state
- Input actions (tap, type, scroll)
- Assertions (assertVisible, assertNotVisible)
- Handle loading states
- Take screenshot at key steps
```

## Accessibility Audit
```
Run a complete accessibility audit on this page/screen:
- All images have descriptive alt text
- All interactive elements have accessible labels
- Color contrast ratios meet WCAG 2.1 AA (4.5:1 normal, 3:1 large)
- Keyboard navigation works (tab order logical)
- Focus indicators visible
- Error messages are descriptive and announced to screen readers
- Loading states announced
- Animations respect prefers-reduced-motion
Generate fixes for all issues found.
```

## Performance Test
```
Run performance analysis on this component/screen:
- Profile re-renders with React DevTools
- Identify unnecessary renders (missing memo/useMemo/useCallback)
- Check for expensive calculations in render
- For mobile: check FlatList configuration
- For web: run Lighthouse and report Core Web Vitals
- Suggest optimizations with estimated impact
```
