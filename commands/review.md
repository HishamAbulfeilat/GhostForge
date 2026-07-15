# /review Command

## Purpose
Review the **staged diff** before pushing and highlight blockers, warnings, and suggestions for code quality, security, tests, and release safety.

## Usage
```bash
/review
/review --fix
/review --pr
```

## Options
| Option | Description |
|---|---|
| `--fix` | Auto-fix safe issues such as lint fixes, obvious formatting, and removable debug statements when possible |
| `--pr` | Generate a PR description from the staged review findings and summary |

## Examples
```bash
/review
/review --fix
/review --pr
```

## What AI checks
- Code quality and maintainability
- Security issues and unsafe patterns
- Breaking changes or migration risk
- Missing tests for changed behavior
- `console.log` statements left in code
- `TODO` / `FIXME` comments in staged files
- TypeScript errors or type-risky changes

## Output Format
```text
🔴 Blockers
- [issue] → [required fix]

🟡 Warnings
- [risk] → [recommended action]

🟢 Suggestions
- [nice-to-have improvement]
```

## What AI does step by step
1. Reads `git diff --staged`.
2. Classifies findings into 🔴 Blockers, 🟡 Warnings, and 🟢 Suggestions.
3. Verifies whether changed files include tests or require them.
4. Scans staged changes for debug logs, TODO markers, and risky TypeScript usage.
5. Notes security concerns and possible breaking changes.
6. If `--fix` is used, applies only safe automated fixes.
7. If `--pr` is used, converts the review into a polished PR description.
