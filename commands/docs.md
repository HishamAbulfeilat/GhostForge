# /docs Command

## Purpose
Generate project documentation into Markdown files inside the `/docs` folder.

## Usage
```bash
/docs readme
/docs api
/docs components
/docs storybook
/docs changelog
/docs all
```

## Options
| Command | Description |
|---|---|
| `/docs readme` | Regenerate `README.md` from codebase analysis |
| `/docs api` | Generate API reference from JSDoc, TSDoc, or Swagger/OpenAPI sources |
| `/docs components` | Generate component docs with props tables and usage examples |
| `/docs storybook` | Alias for `/storybook generate` |
| `/docs changelog` | Generate `CHANGELOG.md` from git history |
| `/docs all` | Run all documentation generators |

## Examples
```bash
/docs readme
/docs api
/docs components
/docs changelog
/docs all
```

## Output
- Writes Markdown output into the `/docs` folder
- Updates root docs such as `README.md` or `CHANGELOG.md` when requested
- Includes usage examples, tables, and generated references where possible

## What AI does step by step
1. Scans the codebase, package scripts, routes, and exported modules.
2. Detects JSDoc, TSDoc, Swagger/OpenAPI, Storybook, and component patterns.
3. Generates the requested Markdown documents.
4. Creates `/docs` if it does not exist.
5. Links related docs together for easier navigation.
