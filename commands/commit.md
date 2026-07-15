# /commit Command

## Description
Analyzes staged git changes and generates the perfect conventional commit message. Never write a commit message manually again.

## Usage
```
/commit                    → Analyze staged changes, generate message, confirm
/commit --auto             → Generate and commit without confirmation (autopilot)
/commit --push             → Commit and push to current branch
/commit --pr               → Commit, push, and open a draft PR
```

## Examples
```
/commit
→ Analyzing staged changes...
→ feat(auth): add Azure AD login with token refresh and secure storage

/commit --push
→ ✅ Committed and pushed to feature/azure-ad-auth

/commit --pr
→ ✅ PR #24 opened: "feat(auth): add Azure AD login"
```

## Commit Message Format

Follows **Conventional Commits** specification:
```
type(scope): short description (#ticket-number if detectable)

[optional body — for complex changes]

[optional footer — breaking changes, closes #issue]
```

### Types
| Type | When to use |
|------|------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, deps, config |
| `docs` | Documentation only |
| `style` | Formatting (no logic change) |
| `refactor` | Refactor (no feature/fix) |
| `test` | Adding/updating tests |
| `perf` | Performance improvement |
| `ci` | CI/CD pipeline changes |
| `revert` | Reverting a previous commit |

## How It Works

1. Runs `git diff --staged` to read all staged changes
2. Identifies: what files changed, what was added/removed, what feature/bug it relates to
3. Detects ticket number from branch name (e.g. `fix/EJ-142-login-crash` → `#EJ-142`)
4. Generates a precise commit message
5. Shows preview and asks for confirmation (unless `--auto`)

## Output
```
🔍 Analyzing staged changes...
   Modified : src/services/authService.ts (+12, -3)
   Modified : src/screens/LoginScreen.tsx (+8, -1)
   Modified : src/store/authSlice.ts (+5, -0)

📝 Suggested commit message:
   fix(auth): handle network timeout on login screen

   Add 10s timeout to Axios instance and wrap loginUser() in
   try/catch to prevent app crash on slow network connections.
   Show user-friendly error message instead of crashing.

   Closes #142

[C] Commit  [E] Edit  [R] Regenerate  [A] Abort
> 
```

## See Also
- `commands/release.md` — Version tagging and changelog
- `commands/pr-description.md` — Auto-generate PR description
