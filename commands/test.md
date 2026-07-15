# /test Command — Automated Testing Agent

## Description
Full automation testing suite. Runs unit tests, component tests, E2E tests, accessibility audits, performance checks, and API tests. Generates missing tests for uncovered code. Works for both React web and React Native mobile apps.

## Usage
```
/test
/test unit                → Run unit tests only
/test e2e                 → Run E2E tests only
/test coverage            → Run all tests + coverage report
/test [filename]          → Test a specific file or component
/test generate            → Generate missing tests for the whole codebase
/test generate [file]     → Generate tests for a specific file
/test a11y                → Run accessibility audit only
/test performance         → Run Lighthouse / React Profiler
/test api                 → Test all API endpoints with MSW
/test mobile              → Run Detox / Maestro mobile E2E
/test ci                  → Full CI suite (what runs in pipeline)
```

---

## Test Execution Flow

### Step 1 — Auto-Detect Project Setup

When `/test` is triggered, the AI **automatically scans the project** before doing anything:

**Files scanned:**
- `package.json` → test runner, scripts, installed packages
- `jest.config.*` → Jest config
- `playwright.config.*` → Playwright E2E
- `detox.config.*` / `.detoxrc.*` → Detox mobile E2E
- `.maestro/` → Maestro flows
- `vitest.config.*` → Vitest config
- `cypress.config.*` → Cypress config
- `tsconfig.json` → TypeScript setup
- `app.json` / `expo` field → Expo/React Native detection
- `next.config.*` → Next.js detection
- All `**/*.test.*` / `**/*.spec.*` files → what's already tested

---

### Step 2 — Show Detected Setup & Ask User to Verify

After scanning, the AI displays what it found and **asks for confirmation before running anything**:

```
🧪 GhostForge Test Setup — Auto-Detected
════════════════════════════════════════

📦 Project type      : React Native (Expo SDK 51)
🧪 Test runner       : Jest (v29) + @testing-library/react-native
📱 E2E (mobile)      : Detox (config found at .detoxrc.js)
🌊 E2E flows         : Maestro — ⚠️  no flows found yet
🌐 E2E (web)         : ❌ Playwright not installed
♿ Accessibility      : ⚠️  axe not installed — will use manual checks
⚡ Performance        : React Native Profiler
📊 Coverage tool     : Jest --coverage (lcov)
🔧 Test scripts found:
     npm test        → jest
     npm run test:e2e → detox test

📁 Existing test files : 6 files
     src/screens/__tests__/LoginScreen.test.tsx
     src/services/__tests__/authService.test.ts
     src/components/__tests__/Button.test.tsx
     ... (3 more)

📁 Untested files : 14 files with no tests
     src/services/paymentService.ts
     src/screens/CheckoutScreen.tsx
     src/components/ProductCard.tsx
     ... (11 more)

════════════════════════════════════════
🔧 Planned test run:
  ✅ [1/5] Unit tests      → jest --testPathPattern="*.test.ts(x)?"
  ✅ [2/5] Component tests → jest --testPathPattern="*.test.tsx"
  ✅ [3/5] Coverage report → jest --coverage
  ✅ [4/5] E2E mobile      → detox test --configuration ios.sim.debug
  ⚠️  [5/5] Maestro flows  → none found, will auto-generate

Missing tools (will install if you confirm):
  📦 msw      → ❌ not installed (needed for API mock tests)
  📦 maestro  → ⚠️  not in package.json (CLI tool)

════════════════════════════════════════

✅ Does this setup look correct?

  [1] ✅ Yes — run tests now
  [2] ✏️  Edit setup — change runner or tools
  [3] ➕ Install missing tools first, then run
  [4] 🔬 Run unit tests only (skip E2E)
  [5] 📝 Generate missing tests first, then run
  [6] ❌ Cancel

> Choose [1-6]:
```

---

### Step 3a — If User Confirms (Option 1)
Runs the full detected suite immediately.

### Step 3b — If User Edits (Option 2)
```
✏️  Edit Test Setup — what would you like to change?
  [1] Change test runner        (current: Jest)
  [2] Add/remove E2E tool       (current: Detox)
  [3] Change coverage target    (current: 80%)
  [4] Add accessibility tool    (current: none)
  [5] Done → show updated plan & confirm again
```

### Step 3c — If User Installs Missing Tools (Option 3)
```
📦 Installing missing tools...
  npx expo install msw     → ✅ installed
  brew install maestro     → ✅ installed
Re-scanning... ✅ All tools ready.
```

### Step 4 — Run Tests (after confirmation)

---

## Stage 1 — Unit Tests (Jest)

```
🔬 Unit Tests
─────────────────────────────────────
Running: npx jest --testPathPattern="*.test.ts" --passWithNoTests

  ✅ authService.test.ts          6/6 passed
  ✅ cartSlice.test.ts            4/4 passed
  ✅ formatDate.test.ts           8/8 passed
  ❌ productService.test.ts       2/5 FAILED
     └─ FAIL: getProductById returns null for missing ID
     └─ FAIL: fetchProducts handles 500 error

Coverage:
  Statements : 78% (target: 80%) ⚠️
  Branches   : 71% (target: 75%) ⚠️
  Functions  : 85% ✅
  Lines      : 79% ⚠️

Low coverage files:
  src/services/paymentService.ts  → 32% covered
  src/utils/validation.ts         → 45% covered

→ Run /test generate to create missing tests
```

---

## Stage 2 — Component Tests (React Testing Library)

```
🧩 Component Tests
─────────────────────────────────────
  ✅ LoginScreen.test.tsx         5/5 passed
  ✅ Button.test.tsx              3/3 passed
  ✅ ProductCard.test.tsx         4/4 passed
  ❌ CheckoutForm.test.tsx        1/3 FAILED
     └─ FAIL: Form does not show error for invalid card number
     └─ (Snapshot mismatch on line 45)

→ Showing diff and suggested fix...
```

---

## Stage 3 — API / Service Tests (MSW)

```
🌐 API Tests (Mock Service Worker)
─────────────────────────────────────
  ✅ GET  /api/products           200 — response shape valid
  ✅ POST /api/auth/login         200 — token returned
  ✅ POST /api/auth/refresh       200 — new token returned
  ❌ GET  /api/orders/:id         FAILED
     └─ Expected: { id, status, items[] }
     └─ Received: { id, status } — missing items array
  ⚠️  DELETE /api/cart/:id       No test found — generating...
```

### MSW Handler Example (auto-generated)
```typescript
// src/mocks/handlers/orders.ts
import { http, HttpResponse } from 'msw';

export const orderHandlers = [
  http.get('/api/orders/:id', ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      status: 'pending',
      items: [{ productId: '1', quantity: 2 }],
    });
  }),
];
```

---

## Stage 4 — Accessibility Audit (axe-core / WCAG 2.1)

```
♿ Accessibility Audit
─────────────────────────────────────
Running axe-core on all rendered components...

  ❌ ProductCard        — Image missing alt text
  ❌ LoginScreen        — Input has no associated label
  ⚠️  Button            — Color contrast ratio 3.8:1 (min: 4.5:1)
  ✅ HomeScreen         — No issues
  ✅ ProfileScreen      — No issues

Issues: 2 errors, 1 warning

Fixes generated:
  // Add alt to Image
  <Image source={...} accessibilityLabel={product.name} />

  // Associate label with input
  <TextInput accessibilityLabel="Email address" ... />
```

---

## Stage 5 — Performance Checks

### Web (Lighthouse)
```
⚡ Lighthouse Performance Audit
─────────────────────────────────────
  Performance    : 87/100  ⚠️  (target: 90+)
  Accessibility  : 94/100  ✅
  Best Practices : 100/100 ✅
  SEO            : 95/100  ✅

Opportunities:
  🔴 Reduce unused JavaScript  →  Save ~180KB
     → Dynamic import HeavyComponent
  🟡 Optimize images           →  Save ~45KB
     → Use next/image or WebP format
  🟢 Enable text compression   →  Save ~12KB
     → Add gzip/brotli in Nginx config
```

### Mobile (React Native Profiler)
```
⚡ React Native Performance
─────────────────────────────────────
  JS Thread    : avg 12ms/frame  ✅  (target: <16ms)
  UI Thread    : avg 14ms/frame  ✅
  Memory usage : 128MB           ⚠️  (above 100MB warning)

  Re-render issues:
  ❌ ProductList     — Re-renders on every parent state change
     → Wrap with React.memo()
  ❌ CartIcon        — Re-renders 12x per scroll
     → Move outside FlatList, use selector
```

---

## Stage 6 — E2E Tests

### Web (Playwright)
```typescript
// Auto-generated E2E test
// tests/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('user can login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'test@ghostforge.com');
    await page.fill('[data-testid="password"]', 'Password123!');
    await page.click('[data-testid="login-btn"]');
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('[data-testid="user-name"]')).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'wrong@email.com');
    await page.fill('[data-testid="password"]', 'wrongpass');
    await page.click('[data-testid="login-btn"]');
    await expect(page.locator('[data-testid="error-msg"]')).toBeVisible();
  });
});
```

### Mobile (Maestro)
```yaml
# auto-generated: .maestro/flows/login.yml
appId: com.ghostforge.app
---
- launchApp
- tapOn: "Email"
- inputText: "test@ghostforge.com"
- tapOn: "Password"
- inputText: "Password123!"
- tapOn: "Login"
- assertVisible: "Welcome"
- assertNotVisible: "Login"
```

### Mobile (Detox)
```typescript
// auto-generated: e2e/login.test.ts
describe('Login Flow', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  it('should login successfully', async () => {
    await element(by.id('email-input')).typeText('test@ghostforge.com');
    await element(by.id('password-input')).typeText('Password123!');
    await element(by.id('login-button')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();
  });
});
```

---

## Test Generation (`/test generate`)

When run on a file with no tests:

```
🤖 Generating tests for: src/services/paymentService.ts

Analyzing exported functions:
  → processPayment(cardData, amount)
  → validateCard(cardNumber)
  → getPaymentHistory(userId)

Generating: src/services/__tests__/paymentService.test.ts

  ✅ processPayment — 5 test cases
       (success, invalid card, network error, timeout, insufficient funds)
  ✅ validateCard   — 6 test cases
       (valid Visa, valid Mastercard, expired, wrong length, empty, non-numeric)
  ✅ getPaymentHistory — 3 test cases
       (returns list, empty list, API error)

Total: 14 new test cases written
```

---

## Final Report

```
════════════════════════════════════════
📊 Test Report — GhostForge App
Generated: 2025-07-15 11:30
════════════════════════════════════════

Summary:
  ✅ Passed    : 47
  ❌ Failed    : 4
  ⚠️  Warnings  : 3
  📝 Generated : 14 new tests

Coverage:
  Statements : 82% ✅
  Branches   : 76% ✅
  Functions  : 89% ✅
  Lines      : 83% ✅

Failed Tests (action required):
  ❌ productService.test.ts → getProductById null case
  ❌ CheckoutForm.test.tsx  → Invalid card error message
  ❌ orders API             → Missing items[] in response
  ❌ ProductCard a11y       → Missing image alt text

🔧 Run /fix-tickets to auto-fix bugs found in tests
🔍 Run /security for security-specific test analysis

════════════════════════════════════════
```

---

## CI Integration

The `/test ci` command runs the same suite used in pipelines:

```bash
# Equivalent shell commands
npm run lint              # ESLint
npx tsc --noEmit          # TypeScript type check
npm test -- --coverage    # Jest unit + component
npx playwright test       # E2E (web)
npx maestro test .maestro # E2E (mobile)
```

### Add to GitHub Actions
```yaml
- name: Run full test suite
  run: |
    npm run lint
    npx tsc --noEmit
    npm test -- --coverage --passWithNoTests
    npx playwright test
```

---

## Quick Reference

| Command | What it runs |
|---------|-------------|
| `/test` | Full suite: unit + component + API + a11y + perf + E2E |
| `/test unit` | Jest unit tests only |
| `/test e2e` | Playwright (web) or Detox/Maestro (mobile) |
| `/test coverage` | Full suite with HTML coverage report |
| `/test generate` | Auto-write missing tests for all files |
| `/test a11y` | Accessibility audit (axe-core / WCAG 2.1) |
| `/test performance` | Lighthouse (web) or RN Profiler (mobile) |
| `/test api` | MSW mock API tests |
| `/test mobile` | Detox + Maestro device tests |
| `/test ci` | Full CI pipeline suite |

## See Also
- `agents/qa.md` — Full QA agent documentation
- `commands/qa.md` — QA command overview
- `commands/fix-tickets.md` — Auto-fix issues found in tests
- `commands/security.md` — Security-focused testing
