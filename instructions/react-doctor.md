# React Doctor — GhostForge React Health Standard

## What is React Doctor?
React Doctor (`npx react-doctor@latest`) is the **official React health scanner** used at GhostForge. It scores React codebases from **0-100** and flags security, performance, correctness, accessibility, bundle size, and architecture issues.

## When Copilot MUST Run React Doctor

1. **Before committing React changes** — run `npx react-doctor@latest --verbose --scope changed`
2. **After fixing a bug** — verify the score did not regress
3. **After adding a feature** — scan for new issues
4. **When asked to "scan", "triage", "clean up React", or `/doctor`** — run full playbook

## React Doctor Triage Loop

When running `/doctor` or asked to do a full triage, fetch and follow the live playbook:
```bash
curl --fail --silent https://www.react.doctor/prompts/react-doctor-agent.md
```
This provides the canonical scan → filter → triage → fix → validate workflow.

## Score Regression Rule
If a code change drops the React Doctor score, **always fix the regression** before finishing.

## Quick Commands
```bash
# Regression check (before commit)
npx react-doctor@latest --verbose --scope changed

# Full scan
npx react-doctor@latest --verbose

# Single category
npx react-doctor@latest --verbose --category Performance

# JSON output for CI/scripting
npx react-doctor@latest --json
```

## Project Setup (copy to new React projects)
```bash
# Install CI workflow
npx react-doctor@latest ci install

# Install coding agent skill (auto-detects all agents)
npx react-doctor@latest install --yes
```

## Rules Reference
| Command | Purpose |
|---|---|
| `rules explain <rule>` | Understand why a rule fires |
| `rules disable <rule>` | Disable a rule project-wide |
| `rules set <rule> warning` | Downgrade severity |
| `rules ignore-tag <path>` | Ignore a folder |

## GitHub Actions (pre-configured)
The `.github/workflows/react-doctor.yml` workflow is pre-installed in GhostForge projects. It runs on every PR, posts a health-score badge, and adds inline review comments.

## GhostForge Score Targets
| Project Phase | Minimum Score |
|---|---|
| Development | 60 |
| Code Review / PR Merge | 75 |
| Production Release | 85 |
