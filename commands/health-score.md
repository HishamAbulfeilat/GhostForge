# /health-score

> Codebase health grade across tech debt, coverage, bundle size, Lighthouse, and accessibility.

## Usage
```bash
bash scripts/health-score.sh <command> [options]
```

## Commands
| Command | Description |
|---|---|
| `score [dir]` | Compute the latest A–F health grade for a project directory |
| `breakdown` | Show the latest saved component breakdown |
| `history` | Print the last 10 recorded health scores and grade trend |
| `badge` | Generate a Shields.io health badge from the latest saved grade |
| `help` | Show help |

## Example
```bash
bash scripts/health-score.sh score .
```
