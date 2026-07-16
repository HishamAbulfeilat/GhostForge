# /health-all Command

## Purpose
Scan multiple projects at once and produce a combined health report across all registered projects.

## Usage
```bash
/health-all                     # Scan all registered projects
/health-all --export csv        # Export results to CSV
/health-all --threshold 70      # Flag projects below 70
```

## What It Checks
- Runs `/health-check` on every project in `~/.ghostforge/projects.json`
- Aggregates scores into a combined report
- Highlights projects that fall below threshold (default 60)

## Output
- Per-project score table
- Overall average
- Shields.io badge for worst/best project
- Optional CSV export to `health-report.csv`

## Setup
Projects must be registered: `ghostforge-ai register /path/to/project`
