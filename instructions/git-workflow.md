# Git Workflow

Branching strategy, PR rules, and commit standards for GhostForge projects.

---

## Branch Strategy (GitFlow)

```text
main           → Production. Protected. Requires approved PR.
develop        → Integration. All features merge here first.
feature/*      → New features. Branch from develop.
fix/*          → Bug fixes. Branch from develop.
hotfix/*       → Emergency production fixes. Branch from main.
release/*      → Release preparation. Branch from develop.
chore/*        → Maintenance, deps, config. Branch from develop.
```

### Branch Naming
```bash
feature/EJ-142-add-azure-ad-login
feature/product-search-filters
fix/EJ-155-cart-total-calculation
fix/login-crash-on-slow-network
hotfix/payment-double-charge
release/v1.3.0
chore/upgrade-expo-sdk-51
docs/update-api-documentation
```

---

## Commit Convention (Conventional Commits)

### Format
```text
type(scope): short description

[optional body]

[optional footer: Closes #ticket]
```

### Types
| Type | Use |
|------|-----|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, deps, tooling |
| `docs` | Documentation |
| `style` | Formatting only (no logic) |
| `refactor` | Refactor (no feature/fix) |
| `test` | Add/update tests |
| `perf` | Performance improvement |
| `ci` | CI/CD pipeline |
| `revert` | Revert previous commit |

### Examples
```text
feat(auth): add Azure AD SSO with MSAL integration
fix(cart): prevent duplicate item on rapid tap #EJ-142
chore(deps): upgrade expo-router to 3.5.0
test(auth): add unit tests for token refresh logic
perf(list): virtualize product list with FlashList
ci(pipeline): add Lighthouse performance check
```

---

## PR Rules

### Before Opening PR
- [ ] All tests pass locally (`npm test`)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] No lint errors (`npm run lint`)
- [ ] Tested on both iOS and Android (mobile)
- [ ] Tested in Chrome, Firefox (web)
- [ ] No new `any` types
- [ ] No hardcoded secrets
- [ ] `.env.example` updated if new env vars added
- [ ] PR description filled out (use `/pr-description`)

### PR Size Guidelines
| Size | Lines changed | Guidance |
|------|-------------|---------|
| XS | < 50 | Ideal — fast review |
| S | 50–200 | Good |
| M | 200–500 | Acceptable |
| L | 500–1000 | Split if possible |
| XL | > 1000 | Must split |

### PR Labels
```text
feat        → New feature
fix         → Bug fix
breaking    → Breaking change (requires major version bump)
security    → Security-related change
performance → Performance improvement
deps        → Dependency update
```

---

## Protected Branch Rules (GitHub)

Configure these in repo Settings → Branches:

```text
Branch: main
  ✅ Require pull request (2 approvals)
  ✅ Require status checks: CI (lint + test + build)
  ✅ Require branches to be up to date
  ✅ Restrict pushes (no direct push)
  ✅ Require signed commits

Branch: develop
  ✅ Require pull request (1 approval)
  ✅ Require status checks: CI
```

---

## Git Hooks (Husky)

```bash
# Pre-commit: lint + type check
# .husky/pre-commit
npx lint-staged

# Commit-msg: validate conventional commits
# .husky/commit-msg
npx --no -- commitlint --edit $1
```

### lint-staged config
```json
// package.json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml}": ["prettier --write"]
}
```

### commitlint config
```javascript
// commitlint.config.js
module.exports = { extends: ['@commitlint/config-conventional'] };
```

---

## Useful Git Aliases
```bash
# Add to ~/.gitconfig
[alias]
  co = checkout
  br = branch
  st = status
  lg = log --oneline --graph --decorate --all
  recent = branch --sort=-committerdate
  undo = reset HEAD~1 --soft
  aliases = config --get-regexp alias
```
