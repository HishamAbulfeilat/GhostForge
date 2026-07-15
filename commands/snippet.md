# /snippet Command

## Purpose
Browse, insert, and save reusable code snippets from the GhostForge snippet library.

## Usage
```bash
/snippet list
/snippet use auth-interceptor
/snippet save my-form-hook
```

## Options
| Command | Description |
|---|---|
| `/snippet list` | Show all available snippets in the library |
| `/snippet use [name]` | Insert the named snippet into the current workflow or target file |
| `/snippet save [name]` | Save selected code as a new snippet document |

## Examples
```bash
/snippet list
/snippet use api-hook
/snippet use azure-ad-login
/snippet save secure-fetch-wrapper
```

## What AI does step by step
1. Reads the `snippets/` directory and lists snippet names.
2. Opens the selected snippet and understands its intent, dependencies, and usage notes.
3. Adapts the snippet to the current stack and project conventions before inserting it.
4. When saving a new snippet, documents purpose, code, and usage in Markdown format.
