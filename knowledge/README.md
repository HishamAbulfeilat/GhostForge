# Team Knowledge Base

The `knowledge/` folder stores lightweight team memory that Copilot and developers can reuse.

## How to add entries

1. Pick the right file: `gotchas.md`, `decisions.md`, `patterns.md`, `environments.md`, or `onboarding.md`.
2. Use clear headings and short sections.
3. Include the problem, the decision or workaround, and affected files/systems.
4. Add new entries when a lesson is likely to help the next developer avoid the same issue.

## Suggested format

```markdown
## Short title
**Issue/Decision/Pattern**: One-line summary
**Context**: Why it matters
**Action**: What to do
**Files/Systems**: Relevant paths, apps, or services
```

## How Copilot uses this

VS Code workspace settings can point Copilot to these files through `codeGeneration.instructions`. That means Copilot automatically reads this knowledge while generating code, fixes, docs, and reviews.

## Guidelines for useful entries

- Prefer concrete lessons over vague advice.
- Name real files, services, env vars, or workflows when possible.
- Keep entries current; update or archive outdated guidance.
- Record decisions with dates and status so future changes are easier to evaluate.
