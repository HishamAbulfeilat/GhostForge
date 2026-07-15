# /release Command

## Description
Manages the full release process — semantic versioning, CHANGELOG.md generation from git commits, git tagging, and triggering deployment pipelines.

## Usage
```
/release patch              → Bug fixes only (1.0.0 → 1.0.1)
/release minor              → New features, backward compatible (1.0.0 → 1.1.0)
/release major              → Breaking changes (1.0.0 → 2.0.0)
/release --dry-run          → Preview what the release would look like
/release --changelog-only   → Just update CHANGELOG.md, don't tag
```

## Workflow

### Step 1 — Analyze Commits Since Last Release
```
📋 Commits since v1.2.0 (23 commits):

  🚀 Features (feat):
    feat(auth): add Azure AD SSO login
    feat(products): add infinite scroll to product list
    feat(cart): add quantity selector

  🐛 Bug Fixes (fix):
    fix(auth): handle expired refresh token #142
    fix(payments): prevent double submit on checkout
    fix(ios): fix keyboard avoiding on login screen

  🔧 Other:
    chore(deps): upgrade expo to SDK 51
    docs: update README with new env vars

Suggested version bump: MINOR (new features)
Current: v1.2.0 → New: v1.3.0
```

### Step 2 — Generate CHANGELOG.md
```markdown
## [1.3.0] - 2025-07-15

### 🚀 Features
- **auth**: Add Azure AD SSO login with MSAL integration
- **products**: Add infinite scroll to product list using React Query
- **cart**: Add quantity selector with stock validation

### 🐛 Bug Fixes
- **auth**: Handle expired refresh token gracefully (#142)
- **payments**: Prevent double submit on checkout form
- **ios**: Fix keyboard avoiding view on login screen

### 🔧 Maintenance
- **deps**: Upgrade Expo SDK to 51.0.8
- **docs**: Update README with required environment variables

### 📦 Dependency Updates
- expo: 50.0.14 → 51.0.8
- @tanstack/react-query: 5.0.0 → 5.28.0
```

### Step 3 — Execute Release
```bash
# Updates package.json version
npm version minor

# Updates CHANGELOG.md
# Creates git tag
git tag -a v1.3.0 -m "Release v1.3.0"

# Pushes tag (triggers CD pipeline)
git push origin main --tags
```

### Step 4 — Trigger Deployment
```
✅ Tag v1.3.0 pushed
✅ GitHub Actions release pipeline triggered
✅ Build artifacts will be created automatically
```

## React Native Release
```
/release minor --platform mobile

→ Updates version in app.json and package.json
→ Increments EAS build number
→ Triggers: eas build --platform all --profile production
→ After build: eas submit (App Store + Play Store)
```

## See Also
- `commands/deploy.md` — Deployment targets
- `commands/commit.md` — Commit message generation
