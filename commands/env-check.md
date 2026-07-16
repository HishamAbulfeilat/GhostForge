# /env-check Command

## Purpose
Compare `.env` against `.env.example`, flag missing keys, secrets accidentally committed, undocumented variables, and stale entries.

## Usage
```bash
/env-check
/env-check /path/to/project
/env-check --fix
```

## Options
| Option | Description |
|---|---|
| `[path]` | Target project directory (default: current directory) |
| `--fix` | Auto-fix safe issues: add missing keys to `.env.example`, remove stale entries |
| `--strict` | Fail if any issue found (useful in CI) |

## Checks Performed
| Check | Description |
|---|---|
| Missing in `.env` | Keys in `.env.example` not present in `.env` |
| Missing in `.env.example` | Keys in `.env` not documented in `.env.example` |
| Exposed secrets | Real values (not placeholders) found in `.env.example` |
| Empty required vars | Keys with no value in `.env` |
| Stale vars | Keys in `.env` not used in source code (`src/`) |

## Examples
```bash
/env-check
/env-check --strict   # Use in CI pre-deploy hook
/env-check --fix      # Add undocumented keys to .env.example
```

## Output Example
```
🔍 Scanning environment variables...

❌ Missing in .env (3):
   DATABASE_URL   — defined in .env.example
   REDIS_HOST     — defined in .env.example
   API_TIMEOUT    — defined in .env.example

⚠️  Undocumented in .env.example (1):
   FEATURE_FLAG_DARK_MODE

🔴 Secret exposed in .env.example (1):
   STRIPE_SECRET_KEY=sk_live_... ← replace with placeholder

✅ No stale variables found.

Score: 6/10 — 4 issues found
```
