# /add-feature Command

## Description
Adds a new feature to an existing project with full implementation, tests, and documentation.

## Usage
```
/add-feature [description of the feature]
```

## Examples
```
/add-feature add dark mode toggle to the app
/add-feature add push notifications for order updates
/add-feature add infinite scroll to the product list
/add-feature add user profile editing with image upload
/add-feature add offline mode support
```

## Workflow

1. **Analyze** the existing codebase to understand patterns and conventions
2. **Plan** the implementation (components, state, API calls needed)
3. **Implement** following existing conventions:
   - Use existing design system/components where possible
   - Match existing TypeScript patterns
   - Use the same state management approach
   - Follow existing folder structure
4. **Test** the feature:
   - Unit tests for logic
   - Component tests for UI
   - E2E test scenario (optional)
5. **Document** changes in relevant files

## Output
- All code files created/modified
- Test files
- Any required environment variable additions to .env.example
- Brief summary of changes made
