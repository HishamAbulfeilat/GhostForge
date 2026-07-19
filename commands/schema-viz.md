# /schema-viz

> Detect Prisma or Drizzle schemas and render a terminal or HTML ER diagram.

## Usage
```bash
bash scripts/schema-viz.sh <command> [schema-file]
```

## Commands
| Command | Description |
|---|---|
| `viz [schema-file]` | Render an ASCII ERD in the terminal |
| `html [schema-file]` | Generate `schema-diagram.html` and open it |
| `list` | List detected schema files |
| `help` | Show help |

## Example
```bash
bash scripts/schema-viz.sh viz prisma/schema.prisma
```
