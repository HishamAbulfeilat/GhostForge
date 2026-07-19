# /api-docs

> Scan Next.js or Express routes and generate Markdown or OpenAPI documentation.

## Usage
```bash
bash scripts/api-docs.sh <command> [dir]
```

## Commands
| Command | Description |
|---|---|
| `scan [dir]` | Discover API routes and print a route summary |
| `markdown [dir]` | Generate `API_DOCS.md` from detected routes |
| `openapi [dir]` | Generate `openapi.json` (OpenAPI 3 skeleton) |
| `serve` | Preview `openapi.json` with Redocly |
| `help` | Show help |

## Example
```bash
bash scripts/api-docs.sh markdown .
```
