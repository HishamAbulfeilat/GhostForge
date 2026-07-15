# /qa Command

## Description
Runs QA analysis on the codebase — finds bugs, missing tests, accessibility issues, and performance problems.

## Usage
```
/qa [optional: specific feature or file]
```

## Examples
```
/qa
/qa the authentication flow
/qa the checkout screen
/qa test coverage for the API service layer
```

## QA Checklist

### Functional Testing
- [ ] All user flows work end-to-end
- [ ] Edge cases handled (empty states, error states, loading states)
- [ ] Form validation works correctly
- [ ] Navigation flows are correct
- [ ] API error handling is correct
- [ ] Offline behavior is handled

### UI/Visual Testing
- [ ] Layout is consistent across screen sizes
- [ ] Images load correctly
- [ ] Fonts render correctly
- [ ] Dark mode works (if implemented)
- [ ] RTL layout works (if needed)
- [ ] No visual regressions

### Performance
- [ ] No unnecessary re-renders
- [ ] Lists are virtualized
- [ ] Images are optimized
- [ ] No memory leaks
- [ ] App startup time is acceptable

### Accessibility
- [ ] All images have alt text
- [ ] Color contrast is sufficient
- [ ] Keyboard navigation works
- [ ] Screen reader compatibility

### Test Coverage
- Generate missing unit tests
- Generate missing component tests
- Identify E2E test gaps

## Output
Full QA report + generated test files
