# /safe Mode

## Description
Switches the AI into **Safe Mode** — every single change, command, or action is shown to the user for explicit approval before it runs. Nothing happens without your confirmation.

## Usage
```
/safe on           → Enable safe mode
/safe off          → Disable safe mode (return to normal)
/safe              → Toggle current mode
```

## Behavior in Safe Mode

For every action, the AI will pause and show:

```
🔒 [SAFE MODE] — Action Required

Action    : Install package
Command   : npm install msw --save-dev
Reason    : MSW is needed for API mocking in tests
Risk      : Low — dev dependency only

Proceed? [Y] Yes  [N] No  [S] Skip this step  [E] Edit command
> 
```

### Safe Mode Prompts Per Action Type

**File Change:**
```
🔒 [SAFE MODE] — File Change

File    : src/services/authService.ts
Action  : Modify (add timeout to Axios instance)
Lines   : +3 added, -1 removed

Show diff? [D] Yes  [Y] Apply  [N] Skip  [E] Edit
> 
```

**Command Execution:**
```
🔒 [SAFE MODE] — Command Execution

Command : npm run build
Reason  : Verify build passes before committing
Risk    : Low — read-only operation

Run? [Y] Yes  [N] Skip
> 
```

**Git Commit:**
```
🔒 [SAFE MODE] — Git Commit

Message : fix(auth): handle network timeout on login #142
Files   : src/services/api.ts, src/screens/LoginScreen.tsx
Branch  : fix/auto-tickets-2025-07-15

Commit? [Y] Yes  [N] Skip  [E] Edit message
> 
```

**Package Install:**
```
🔒 [SAFE MODE] — Package Installation

Package : @testing-library/react-native
Version : latest (^12.4.0)
Type    : devDependency
Size    : ~2.1MB

Install? [Y] Yes  [N] No
> 
```

**Deployment:**
```
🔒 [SAFE MODE] — Deployment

Target      : Azure Static Web Apps — PRODUCTION
Build cmd   : npm run build
Deploy cmd  : Azure/static-web-apps-deploy@v1
Rollback    : Previous slot retained for 24h

⚠️  This will affect PRODUCTION. Are you sure?
[Y] Yes, deploy  [S] Deploy to STAGING instead  [N] Cancel
> 
```

## Safe Mode + /fix-tickets
```
🔒 [SAFE MODE] Running /fix-tickets

Found 6 bugs to fix. Processing one at a time...

[1/6] 🔴 #142 — App crashes on login
  Proposed changes:
    → src/services/api.ts: add timeout
    → src/screens/LoginScreen.tsx: add error handling

  Apply this fix? [Y] Yes  [N] Skip  [D] Show diff  [A] Analyze more
> 
```

## Status Indicator
Every prompt is prefixed with `🔒 [SAFE MODE]` so you always know you're protected.

## Disable Safe Mode
```
/safe off
→ Safe mode disabled. Returning to normal mode.
```

> 💡 Tip: Use /safe for production deployments, auth changes, database migrations, or any task where you want full visibility and control.
