# /career-gap

> Compare your CV against a job description, extract skill keywords, and identify gaps.

## Usage
```bash
ghostforge career-gap <command> [options]
```

## Commands
| Command | Description |
|---|---|
| `score <cv-file> <jd-file>` | Compute a keyword fit score, plus matching and missing skills |
| `keywords <file>` | Extract recognised tech and skill keywords from a file |
| `suggest <cv-file> <jd-file>` | Print a prompt for Claude/Copilot to tailor your CV |
| `version` | Print the script version |

## Examples
```bash
ghostforge career-gap keywords ./cv.md
ghostforge career-gap score ./cv.md ./job-description.md
ghostforge career-gap suggest ./cv.md ./job-description.md
```
