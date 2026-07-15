# /pr-description Command

## Description
Auto-generates a professional, detailed PR description from the git diff. Includes what changed, why, how to test, and any breaking changes.

## Usage
```
/pr-description              → Generate PR description for current branch vs main/develop
/pr-description --create     → Generate and create the PR on GitHub/Azure DevOps
/pr-description --draft      → Create as draft PR
```

## Output Format

```markdown
## 🎯 What does this PR do?
Adds Azure AD authentication to the mobile app, replacing the existing JWT-only login.
Users can now sign in with their GhostForge Microsoft account using SSO.

## 📋 Changes
- **New**: `src/services/authService.ts` — AzureAuthService with MSAL integration
- **New**: `src/screens/LoginScreen.tsx` — Updated login UI with "Sign in with Microsoft" button
- **Modified**: `src/store/authSlice.ts` — Added Azure token handling and refresh logic
- **Modified**: `src/navigation/AppNavigator.tsx` — Auth state now reads from MSAL
- **New**: `src/hooks/useAzureAuth.ts` — Custom hook for Azure AD auth state

## 🧪 How to test
1. Pull branch and run `npm install`
2. Add `AZURE_AD_CLIENT_ID` and `AZURE_AD_TENANT_ID` to `.env.local`
3. Run app: `npx expo start`
4. Tap "Sign in with Microsoft" on login screen
5. Enter GhostForge credentials (email@ghostforge.com)
6. Verify redirect back to app and home screen shown
7. Test logout — verify tokens cleared

## ⚠️ Breaking changes
- None for end users
- **Devs**: Must add `AZURE_AD_CLIENT_ID` and `AZURE_AD_TENANT_ID` to `.env.local` (see `.env.example`)

## 📸 Screenshots
<!-- Add screenshots here -->

## ✅ Checklist
- [x] Code follows project conventions
- [x] TypeScript — no new `any` types
- [x] Tests added/updated
- [x] `.env.example` updated
- [x] No hardcoded secrets
- [ ] Tested on iOS
- [ ] Tested on Android

## 🔗 Related
Closes #142
```

## Options
```
/pr-description --template minimal    → Short version (just what and why)
/pr-description --template detailed   → Full version with all sections
/pr-description --reviewers @john @sara  → Tag specific reviewers
/pr-description --label bug,enhancement  → Add labels
```
