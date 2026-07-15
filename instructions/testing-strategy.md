# Testing Strategy

When to write which type of test, coverage targets, and TDD approach.

---

## Testing Pyramid

```text
         /\
        /E2E\        ← Few, slow, high confidence (10%)
       /──────\
      / Integ  \     ← Some, medium speed (20%)
     /──────────\
    /    Unit    \   ← Many, fast, isolated (70%)
   ──────────────
```

**Rule of thumb**: Write many unit tests, some integration tests, few E2E tests.

---

## What to Test at Each Level

### Unit Tests (Jest)
Test pure functions, hooks, utilities, store slices — **in isolation**.
```typescript
// ✅ Good unit test targets
- Utility functions (formatDate, calculateTotal, validateEmail)
- Custom hooks (useAuth, useCart, useInfiniteScroll)
- Store reducers/actions (cartSlice.add, cartSlice.remove)
- Service functions (with mocked HTTP calls)
- Zod schemas (validation logic)
```

### Component Tests (React Testing Library)
Test component behavior from the **user's perspective**.
```typescript
// ✅ Good component test targets
- Form submission and validation errors
- Conditional rendering (loading, error, empty, populated states)
- User interactions (click, type, select)
- Accessibility (ARIA, keyboard navigation)

// ❌ Don't test
- Implementation details (internal state, private methods)
- Exact CSS classes
- Component structure (avoid snapshot tests unless intentional)
```

### E2E Tests (Playwright / Detox / Maestro)
Test **complete user flows** through the real app.
```typescript
// ✅ Good E2E test targets
- Critical paths: login → dashboard → key feature → logout
- Checkout flow
- Registration and email verification
- Core CRUD operations

// ❌ Don't E2E test
- Everything — it's too slow and brittle
- Edge cases — handle those in unit/component tests
```

---

## Coverage Targets

| Metric | Minimum | Target |
|--------|---------|--------|
| Statements | 70% | 85% |
| Branches | 65% | 80% |
| Functions | 75% | 90% |
| Lines | 70% | 85% |

**Never chase 100% coverage** — it leads to testing implementation details.
Focus coverage on: services, hooks, utilities, store logic.
Don't require coverage on: UI-only components, config files, type definitions.

---

## TDD Approach (When to Use)

Use TDD for:
- Bug fixes (write failing test reproducing the bug first, then fix)
- Complex business logic (cart calculations, validation rules)
- API service methods

Don't force TDD for:
- UI components (design-first is faster)
- Exploratory code (write tests after you know the shape)

---

## Jest Configuration
```typescript
// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  coverageThreshold: {
    global: { branches: 65, functions: 75, lines: 70, statements: 70 },
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.stories.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/types/**',
  ],
};

export default config;
```

## Test File Naming
```text
ComponentName.tsx          → ComponentName.test.tsx     (same folder)
useHookName.ts             → useHookName.test.ts
serviceName.ts             → __tests__/serviceName.test.ts
utils/formatDate.ts        → utils/__tests__/formatDate.test.ts
```

---

## Mock Patterns

### Mock API calls
```typescript
// Use MSW for component/integration tests
import { server } from '@/mocks/node';
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### Mock modules
```typescript
jest.mock('@/services/authService', () => ({
  login: jest.fn().mockResolvedValue({ accessToken: 'mock-token' }),
  logout: jest.fn().mockResolvedValue(undefined),
}));
```

### Mock React Navigation (React Native)
```typescript
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));
```
