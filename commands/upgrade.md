# /upgrade Command

## Purpose
Interactively review and upgrade outdated npm packages in your project.

## Usage
```bash
/upgrade                        # Interactive upgrade wizard
/upgrade --minor                # Only minor + patch updates
/upgrade --patch                # Patch updates only (safest)
/upgrade --latest               # All packages to latest (risky)
```

## How It Works
1. Runs `npm-check-updates` to find outdated packages
2. Shows current vs latest versions with changelogs
3. Lets you select which packages to upgrade
4. Writes new versions to `package.json`
5. Runs `npm install` to apply

## Requirements
Uses `npx npm-check-updates` — no global install needed.
