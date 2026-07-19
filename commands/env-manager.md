# /env-manager

Validate, compare, sanitize, sync, and audit environment files.

## Usage
```bash
bash scripts/env-manager.sh validate .env.local
bash scripts/env-manager.sh diff .env.example .env.local
bash scripts/env-manager.sh example .env.local
bash scripts/env-manager.sh sync .env.example .env.local
bash scripts/env-manager.sh audit
```
