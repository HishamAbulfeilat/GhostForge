# /upgrade Command

## Description
Safely upgrades outdated dependencies. Detects breaking changes, runs tests before and after, and generates a migration guide for major version upgrades.

## Usage
```
/upgrade                    → Show all outdated packages, interactive upgrade
/upgrade --safe             → Upgrade only patch and minor versions (safe)
/upgrade --all              → Upgrade everything including major versions
/upgrade [package]          → Upgrade a specific package
/upgrade --check            → Show what's outdated without upgrading
/upgrade --security         → Fix only security vulnerabilities (npm audit fix)
```

## Examples
```
/upgrade --check
→ Shows table of all outdated packages

/upgrade react-native
→ Upgrades react-native with migration guide

/upgrade --safe
→ Upgrades all patch/minor, skips majors

/upgrade --security
→ npm audit fix --force (security patches only)
```

## Workflow

### Step 1 — Audit Current State
```
📦 Dependency Audit
═══════════════════════════════════════════════════════
Package                     Current   Latest   Type
─────────────────────────────────────────────────────
react-native                0.73.0    0.74.2   ⚠️  Minor
expo                        50.0.14   51.0.8   🔴 Major
@tanstack/react-query        5.0.0    5.28.0   ✅ Patch
axios                        1.6.0     1.7.2   ✅ Patch
typescript                   5.3.3     5.4.5   ✅ Minor
eslint                       8.57.0    9.0.0   🔴 Major
tailwindcss                  3.4.1     3.4.4   ✅ Patch

🔴 Major (breaking changes likely): 2 packages
⚠️  Minor (possible changes): 1 package
✅ Patch (safe): 4 packages

🔒 Security vulnerabilities: 1 high, 2 moderate
═══════════════════════════════════════════════════════
```

### Step 2 — Upgrade Plan
```
Upgrade plan:
  ✅ Patch upgrades (auto-apply):
     axios: 1.6.0 → 1.7.2
     @tanstack/react-query: 5.0.0 → 5.28.0
     tailwindcss: 3.4.1 → 3.4.4

  ⚠️  Minor upgrades (verify):
     react-native: 0.73.0 → 0.74.2
     → Check: react-native upgrade guide

  🔴 Major upgrades (breaking — show migration guide):
     expo: 50 → 51 → migration guide generated
     eslint: 8 → 9 → flat config required

Proceed? [A] All  [S] Safe only  [C] Choose  [N] Cancel
```

### Step 3 — For Major Upgrades: Migration Guide
```
📋 Expo SDK 51 Migration Guide
────────────────────────────────
Breaking changes:
  1. expo-modules-core is now required — run: npx expo install expo-modules-core
  2. Metro config updated — update metro.config.js
  3. New Expo Router API — update app/_layout.tsx

Auto-fixable:
  ✅ Will run: npx expo install (updates all expo packages to matching versions)

Manual steps required:
  ⚠️  Update app.json: add "newArchEnabled": true
  ⚠️  Review: https://expo.dev/changelog/sdk-51

Apply migration? [Y] Yes  [N] Skip this package
```

### Step 4 — Run Tests After Upgrade
```
Running tests to verify upgrade didn't break anything...
  ✅ Unit tests: 47/47 passed
  ✅ Type check: no errors
  ❌ 1 test failed: LoginScreen.test.tsx
     → Expo Router API changed — auto-fixing...
     ✅ Fixed

✅ Upgrade complete. All tests pass.
```

## See Also
- `commands/security.md` — Security-focused audit
- `agents/devops.md` — Dependency management strategies
