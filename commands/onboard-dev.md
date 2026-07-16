# /onboard-dev Command

## Purpose
Automated setup for a new developer joining the project — installs tools, sets up environment, and verifies everything works.

## Usage
```bash
/onboard-dev                    # Full onboarding wizard
/onboard-dev --check            # Verify existing setup only
/onboard-dev --tools-only       # Install tools, skip project setup
```

## What It Does
1. Checks system prerequisites (Node, Git, VS Code)
2. Installs global dev tools (eslint, typescript, etc.)
3. Runs `npm install` for project dependencies
4. Copies `.env.example` → `.env.local`
5. Installs VS Code extension from VSIX
6. Runs health check to verify setup
7. Opens welcome message with next steps

## Perfect For
New team member onboarding, fresh machine setup, CI environment bootstrap.
