# /lint Command

## Description
Run ESLint and Prettier across the project, auto-fix what can be fixed automatically, and report what needs manual attention.

## Usage
```text
/lint                   → Run lint + format check, report issues
/lint --fix             → Auto-fix all fixable issues
/lint --fix [file]      → Fix a specific file
/lint --check           → Check only (no changes, for CI)
/lint ts                → TypeScript type check only (tsc --noEmit)
/lint all               → ESLint + Prettier + TypeScript check
```

## Examples
```text
/lint
→ Runs eslint and prettier check, lists all issues

/lint --fix
→ Auto-fixes: unused imports, missing semicolons, quote style,
  trailing commas, import order

/lint all
→ Full check: ESLint + Prettier + tsc --noEmit
```

## Output
```text
🔍 Running lint checks...
════════════════════════════════════

ESLint:
  ❌ src/screens/LoginScreen.tsx:45  @typescript-eslint/no-explicit-any
  ❌ src/services/api.ts:12          no-unused-vars ('ApiError' is defined but never used)
  ⚠️  src/components/Button.tsx:8   react/display-name

Prettier:
  ❌ src/utils/formatDate.ts         needs formatting

TypeScript:
  ❌ src/store/authSlice.ts:23       Type 'string | undefined' not assignable to type 'string'

════════════════════════════════════
Total: 3 errors, 1 warning

🔧 Auto-fixable: 2 (run /lint --fix)
✋ Needs manual fix: 2
```

## CI Mode
```bash
# Used in GitHub Actions / Azure Pipelines
npm run lint              # ESLint
npx prettier --check .    # Prettier
npx tsc --noEmit          # TypeScript
```
