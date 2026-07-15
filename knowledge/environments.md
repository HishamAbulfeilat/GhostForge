# Environments and Deployment Notes

## Environments

| Environment | Typical URL | Notes |
|---|---|---|
| Local | `http://localhost:3000` / `http://localhost:5173` | Developer machine; uses `.env.local` |
| Staging | `https://staging.example.ghostforge.app` | Pre-release validation, QA, stakeholder demos |
| Production | `https://app.example.ghostforge.com` | Customer-facing environment; restricted changes |

## Environment variable guide

- Keep secrets in `.env.local`, GitHub Actions secrets, Azure Key Vault, or the target platform secret store.
- Commit `.env.example` with placeholder keys only.
- Document all required variables with a short description and whether they are frontend-safe or server-only.

## Deployment notes

- Validate staging before production for auth, caching, analytics, and API connectivity.
- Run `npm audit` before release candidates.
- Record unusual deployment steps or rollback commands here when a project needs them.
