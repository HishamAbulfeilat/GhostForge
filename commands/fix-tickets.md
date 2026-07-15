# /fix-tickets Command

## Description
Automatically fetches ALL assigned open bug tickets, orders them by severity (Critical → High → Medium → Low), then analyzes and fixes each one sequentially with full code changes, tests, and commit per fix.

## Usage
```
/fix-tickets
/fix-tickets critical        → Fix only critical tickets
/fix-tickets high medium     → Fix high + medium tickets
/fix-tickets #142 #155       → Fix specific ticket numbers
/fix-tickets dry-run         → Show plan without applying changes
```

---

## Execution Flow

### Phase 1 — Fetch & Triage
```
🎫 Fetching your assigned bug tickets...

Found 8 open bugs:

  🔴 Critical (2)  →  #142, #138
  🟠 High     (1)  →  #155
  🟡 Medium   (3)  →  #130, #127, #125
  🟢 Low      (2)  →  #119, #112

Processing order: #142 → #138 → #155 → #130 → #127 → #125 → #119 → #112
```

---

### Phase 2 — Fix Loop (per ticket)

For each ticket in priority order:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 [1/8] Fixing #142 — "App crashes on login when network is slow"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Description:
  When login is attempted on a slow network, the app crashes
  instead of showing a timeout error to the user.

🔍 Analyzing...
  → Scanning: src/services/authService.ts
  → Scanning: src/screens/LoginScreen.tsx
  → Scanning: src/store/authSlice.ts

🧠 Root Cause:
  Missing error handling on loginUser() API call.
  Axios has no timeout configured — the Promise hangs
  indefinitely then rejects unhandled, crashing the app.

🔧 Fix Plan:
  1. Add timeout: 10000ms to Axios instance
  2. Wrap loginUser() in try/catch
  3. Dispatch error action to show user-friendly message
  4. Add network connectivity check before call

✏️  Applying changes to 2 files...
  ✅ src/services/api.ts          — added timeout config
  ✅ src/screens/LoginScreen.tsx  — added error handling + UI message

🧪 Running tests for changed files...
  ✅ LoginScreen.test.tsx         — 3/3 tests passed

📝 Committing fix...
  ✅ git commit: "fix(auth): handle network timeout on login #142"

✅ #142 FIXED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Repeats for every ticket in order.

---

### Phase 3 — Summary Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 /fix-tickets — Final Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Fixed   : 6 tickets
⚠️  Partial : 1 ticket (#130 — needs backend change, frontend fixed)
❌ Skipped : 1 ticket (#127 — requires designer input for UI)

Fixed tickets:
  ✅ #142  fix(auth): handle network timeout on login
  ✅ #138  fix(payments): prevent freeze after OTP entry
  ✅ #155  fix(images): add retry logic and fallback for slow connections
  ✅ #125  fix(filters): persist filter state across navigation
  ✅ #119  fix(ui): correct typo in notifications empty state
  ✅ #112  fix(android): correct date picker month display

⚠️  Partial:
  #130 — Filter dropdown reset: frontend fixed (store slice updated).
          Backend needs to return persistent filter state in /user/preferences.
          → Created follow-up issue: #156

❌ Skipped:
  #127 — Date picker UI redesign required. Flagged for designer.

📁 Files changed  : 14
🧪 Tests written  : 8 new test cases
🔗 Branch         : fix/auto-tickets-2025-07-15
💡 Next step      : Review changes, then run /deploy to push to staging

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Fix Strategy Per Bug Type

### 🔴 Crash / Unhandled Exception
```typescript
// Pattern: wrap in try/catch, add fallback UI
try {
  const result = await riskyOperation();
  dispatch(success(result));
} catch (error) {
  dispatch(setError(getErrorMessage(error)));
  // Never let the app crash — always catch
}
```

### 🟠 API / Network Error
```typescript
// Pattern: timeout + retry + user message
const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL,
  timeout: 10_000,
});
// Add retry interceptor for 5xx errors
```

### 🟡 UI / Layout Bug
```typescript
// Pattern: fix styles, add conditional rendering, guard null values
const title = item?.title ?? 'Untitled'; // guard undefined
<View style={[styles.container, Platform.OS === 'android' && styles.androidFix]}>
```

### 🟢 Typo / Copy
```typescript
// Pattern: update string literal or i18n key
// Before: 'No notifcations yet'
// After:  'No notifications yet'
```

---

## Git Strategy

Each fix gets its own atomic commit:
```bash
git commit -m "fix(scope): description #ticketNumber"
```

All fixes go on a dedicated branch:
```bash
git checkout -b fix/auto-tickets-YYYY-MM-DD
```

After all fixes:
```bash
# Option 1: Push branch and open PR
git push origin fix/auto-tickets-2025-07-15
gh pr create --title "🤖 Auto fix: 6 tickets resolved" --body "..."

# Option 2: Merge directly to develop (if configured)
git checkout develop && git merge fix/auto-tickets-2025-07-15
```

---

## Dry Run Mode

`/fix-tickets dry-run` shows the full plan without touching any file:
```
📋 DRY RUN — No files will be changed

Processing order:
  🔴 #142 → will modify: authService.ts, LoginScreen.tsx
  🔴 #138 → will modify: PaymentScreen.tsx, otpSlice.ts
  🟠 #155 → will modify: ProductCard.tsx (add image fallback)
  ...

Run /fix-tickets to apply all fixes.
```

---

## Environment Variables Required
```bash
# Same as /tickets command
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
# or
AZURE_DEVOPS_PAT=xxxxxxxxxxxx
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/your-org
AZURE_DEVOPS_PROJECT=your-project
```

## See Also
- `commands/tickets.md` — View tickets without fixing
- `agents/ticket-checker.md` — Ticket checker agent
- `commands/qa.md` — Run QA after fixing
