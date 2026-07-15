# /tech-debt Command

## Purpose
Scan the codebase for technical debt, rank it by ROI, and optionally fix a selected item.

## Usage
| Command | Description |
|---|---|
| `/tech-debt` | Scan the entire codebase and rank technical debt |
| `/tech-debt --fix [item]` | Fix a specific debt item |
| `/tech-debt --report` | Generate a Markdown technical debt report |

## Examples
```bash
/tech-debt
/tech-debt --fix remove any types from auth module
/tech-debt --report
```

## Output format
```markdown
| # | Debt Item | Effort | Impact | Priority | Files |
|---|-----------|--------|--------|----------|-------|
| 1 | Migrate to React Query v5 | M | H | 🔴 High | 12 files |
| 2 | Remove any types (47 instances) | S | M | 🟡 Medium | 8 files |
```

## Scan categories
- Type safety
- Deprecated dependencies
- Unused code
- Missing tests
- Large components (>300 lines)
- `console.log` usage
- Hardcoded values
- Missing error handling

## What AI does
1. Scans the repo for debt signals across the listed categories.
2. Groups findings into actionable debt items instead of noisy raw hits.
3. Scores each item by effort, impact, and ROI priority.
4. Generates a report sorted by best return on engineering time.
5. When `--fix` is used, focuses on one debt item, applies a targeted fix, and validates the result.
