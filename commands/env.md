# /env Command

## Description
Manage and validate environment variables. Checks `.env.local` against `.env.example`, finds missing variables, and helps set them up.

## Usage
```
/env validate               → Check .env.local has all vars from .env.example
/env list                   → List all env vars and their status
/env add [KEY] [description] → Add a new env var to .env.example (without value)
/env missing                → Show only missing/empty required vars
/env sync                   → Sync .env.example with all vars used in code
```

## Output
```
🔍 Environment Variable Check
═══════════════════════════════════════

✅ Set   : NEXT_PUBLIC_API_URL
✅ Set   : NEXTAUTH_SECRET
❌ Missing: AZURE_AD_CLIENT_ID       ← REQUIRED — Azure AD login won't work
❌ Missing: AZURE_AD_TENANT_ID       ← REQUIRED
⚠️  Empty : SENTRY_DSN               ← Optional but recommended
✅ Set   : DATABASE_URL
✅ Set   : REDIS_URL

Status: 2 missing required variables

📋 Get these values from:
  AZURE_AD_CLIENT_ID  → Azure Portal → App Registrations → [app] → Application (client) ID
  AZURE_AD_TENANT_ID  → Azure Portal → Azure Active Directory → Tenant ID
═══════════════════════════════════════
```

## Env Sync (scan code for process.env usage)
```
/env sync

Scanning codebase for process.env / EXPO_PUBLIC_ usage...
Found in code but missing from .env.example:
  process.env.STRIPE_SECRET_KEY  (src/services/paymentService.ts:12)
  process.env.FCM_SERVER_KEY     (src/services/notificationService.ts:8)

Adding to .env.example with placeholder values...
✅ 2 variables added to .env.example
```
