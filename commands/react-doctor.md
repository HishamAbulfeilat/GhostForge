# /doctor Command

## Purpose
Run **React Doctor** — a zero-config static analyser that scores your React codebase from **0-100** across security, performance, correctness, accessibility, bundle size, and architecture.

## Usage
```bash
/doctor                        # Scan full codebase
/doctor --scope changed        # Only issues introduced on this branch (recommended before commit)
/doctor --scope lines          # Only issues on changed lines
/doctor --verbose              # Show affected files and line numbers
/doctor --category Performance # Single-category deep dive
/doctor --json                 # Machine-readable output
```

## Quick Start (one-time install in a project)
```bash
# Full local triage
npx react-doctor@latest --verbose

# Before committing — regression check only
npx react-doctor@latest --verbose --scope changed

# Install as dev dependency + CI workflow
npx react-doctor@latest ci install
```

## What It Checks

| Category | Examples |
|---|---|
| 🔒 Security | dangerouslySetInnerHTML, eval, unescaped user input |
| ⚡ Performance | Missing memo/useCallback, large imports, render bottlenecks |
| ✅ Correctness | Stale closures, bad effect deps, missing keys |
| ♿ Accessibility | Missing ARIA, tab order, alt text, color contrast |
| 📦 Bundle Size | Heavy dependencies, unoptimised images, dead code |
| 🏛️ Architecture | Component coupling, prop drilling, circular imports |

## Score Thresholds
| Score | Status |
|---|---|
| 90–100 | 🟢 Excellent |
| 70–89 | 🟡 Good |
| 50–69 | 🟠 Needs attention |
| 0–49 | 🔴 At risk |

## Full Triage Mode
When you say `/doctor` Copilot will fetch and follow the canonical agent playbook:
```bash
curl --fail --silent https://www.react.doctor/prompts/react-doctor-agent.md
```
This runs a **scan → filter → triage → fix → validate** loop that edits code directly and never commits.

## CI (GitHub Actions)
React Doctor CI is pre-configured at `.github/workflows/react-doctor.yml` — it:
- Runs on every PR, comparing against the merge base (only new issues)
- Posts a sticky summary comment with the health score
- Adds inline review comments on changed lines
- Creates a commit status badge with the score

To block PRs that introduce errors, uncomment in the workflow:
```yaml
# with:
#   blocking: error
```

## Configuring / Disabling Rules
```bash
# Explain a rule
npx react-doctor@latest rules explain react/no-dangerouslysetinnerhtml

# Disable a rule project-wide
npx react-doctor@latest rules disable react/no-dangerouslysetinnerhtml

# Tune severity
npx react-doctor@latest rules set react/missing-key warning

# Ignore a file/folder
npx react-doctor@latest rules ignore-tag src/legacy
```

## Integration with /health
The `/health` command automatically includes the React Doctor score when `react-doctor` is available in the project.

## Links
- Docs: https://www.react.doctor
- Agent playbook: https://www.react.doctor/prompts/react-doctor-agent.md
- CI setup: https://www.react.doctor/docs/ci-and-prs/github-actions-setup
