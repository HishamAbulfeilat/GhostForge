# /explain-error Command

## Description
Paste any error, stack trace, crash log, or cryptic message — the AI explains exactly what went wrong and how to fix it. Works for TypeScript errors, React Native red screens, build failures, API errors, and more.

## Usage
```
/explain-error [paste error here]
/explain-error            → AI prompts you to paste the error
```

## Examples
```
/explain-error TypeError: Cannot read properties of undefined (reading 'map')

/explain-error
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory

/explain-error
Error: Unable to resolve module `@react-navigation/native` from `App.tsx`
```

## Output Format

```
🔍 Error Analysis
═════════════════════════════════════════════════

Error Type   : TypeError
Message      : Cannot read properties of undefined (reading 'map')
Severity     : 🟡 Medium — runtime crash

📋 What went wrong:
  You're calling .map() on a value that is undefined instead of an array.
  This usually means an API response hasn't loaded yet, or the data
  shape is different from what you expected.

📁 Likely location in your code:
  Look for any .map() call on state that could be null/undefined before data loads.
  Common pattern: products.map(...) where products starts as undefined.

💡 Root cause (most likely):
  Missing loading/default state — the component renders before data arrives.

🔧 Fix:
  Option 1 — Add default empty array:
  const [products, setProducts] = useState<Product[]>([]);  // ← not undefined

  Option 2 — Optional chaining (quick fix):
  products?.map(p => ...)

  Option 3 — Conditional render:
  if (!products) return <LoadingSpinner />;
  return products.map(p => ...)

  Option 4 — Nullish coalescing:
  (products ?? []).map(p => ...)

✅ Recommended fix:
  Use Option 1 — always initialize array state with empty array, not undefined.

🔗 Related:
  TypeScript would have caught this with strict null checks enabled.
  Add "strictNullChecks": true to tsconfig.json

═════════════════════════════════════════════════
Want me to apply the fix? [Y] Yes  [N] No
```

## Error Categories Handled

| Category | Examples |
|----------|---------|
| TypeScript | Type errors, import errors, strict mode violations |
| React/React Native | Hook violations, red screen crashes, render errors |
| Build errors | Metro bundler, Webpack, Next.js build failures |
| Network/API | 401, 403, 404, 500 errors, CORS, timeout |
| Dependency | Module not found, peer dependency conflicts |
| Git | Merge conflicts, rebase errors, push rejections |
| Node.js | Heap overflow, uncaught promise rejections |
| iOS/Android | Native build errors, pod install failures, Gradle errors |
| Azure/CI | Pipeline failures, deployment errors |

## See Also
- `commands/fix.md` — Fix bugs in code
- `commands/security.md` — Security-related errors
