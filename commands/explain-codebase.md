# /explain-codebase Command

## Purpose
Explain a project clearly for new developers, reviewers, or teammates joining mid-stream.

## Usage
| Command | Description |
|---|---|
| `/explain-codebase` | Generate a full project explanation |
| `/explain-codebase --file [path]` | Explain one specific file in context |
| `/explain-codebase --onboard` | Generate a personalized onboarding checklist |

## Examples
```bash
/explain-codebase
/explain-codebase --file src/app/layout.tsx
/explain-codebase --onboard
```

## Output sections
- Project overview (what it does)
- Tech stack with versions
- Folder structure explained
- Key concepts and patterns used
- How to run locally
- Important files to know
- Common gotchas
- First tasks for a new developer

## What AI does
1. Inspects the repo structure, package manager, build config, and key entry points.
2. Explains architecture in plain language without losing technical accuracy.
3. Maps major folders, data flow, state patterns, auth flow, and deployment assumptions.
4. Highlights the most important files for a new developer to read first.
5. When `--onboard` is used, turns the explanation into a practical first-week checklist.
