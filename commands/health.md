# /health Command

## Purpose
Assess the overall health of a project with a weighted score from **0-100** across dependencies, security, tests, bundle output, tickets, and lint quality.

## Usage
```bash
/health
/health --fix
/health /path/to/project
```

## Options
| Option | Description |
|---|---|
| `--fix` | Auto-fix safe items such as `npm audit fix` and lint autofixes when available |
| `[path]` | Run the health check against a specific project directory |

## Examples
```bash
/health
/health --fix
/health /Users/me/my-app
```

## Scoring Breakdown
| Category | Weight | What AI checks |
|---|---:|---|
| npm audit | 25 pts | Critical/high/moderate vulnerabilities and release risk |
| Outdated dependencies | 20 pts | `npm outdated` count and upgrade pressure |
| Test coverage | 20 pts | Coverage artifact presence and percentage |
| Bundle size | 15 pts | Build artifact size and budget health |
| Open critical tickets | 10 pts | Blocking GitHub issues / tracker items |
| Lint errors | 10 pts | Lint command status and code hygiene |

## Output Format
The AI returns a breakdown table like this:

| Category | Score | Status | Notes |
|---|---:|---|---|
| npm audit | 25/25 | ✅ | No critical vulnerabilities |
| Outdated deps | 12/20 | ⚠️ | 2 packages outdated |
| Test coverage | 18/20 | ✅ | 89% lines coverage |
| Bundle size | 8/15 | ⚠️ | Bundle exceeds target |
| Critical tickets | 10/10 | ✅ | No blockers open |
| Lint errors | 6/10 | ❌ | Lint failures found |

Final score emoji:
- **90-100** → 🟢 Excellent
- **70-89** → 🟡 Good
- **50-69** → 🟠 Needs attention
- **0-49** → 🔴 At risk

## What AI does step by step
1. Detects whether the project is an npm-based app.
2. Runs `npm audit` and scores security findings.
3. Runs `npm outdated` and counts dependency drift.
4. Looks for coverage reports such as `coverage-summary.json`, `lcov.info`, or other coverage artifacts.
5. Inspects build output folders to estimate bundle size health.
6. Checks open critical tickets from GitHub Issues when available.
7. Runs the lint command and records failures.
8. Calculates the final score and prints the weighted breakdown.
9. If `--fix` is used, applies safe fixes first, then re-runs the checks it can validate.
