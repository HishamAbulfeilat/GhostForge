# /perf Command

## Purpose
Measure **runtime performance**. Unlike `/optimize`, which focuses on code quality and refactoring, `/perf` focuses on real execution metrics and performance budgets.

## Usage
```bash
/perf
/perf --url https://example.com
/perf --compare
/perf --budget
```

## Options
| Option | Description |
|---|---|
| `--url <https://...>` | Run a web performance audit against a specific deployed URL |
| `--compare` | Compare the latest run against the saved baseline |
| `--budget` | Check current metrics against the configured performance budget |

## Examples
```bash
/perf
/perf --url https://staging.example.com
/perf --compare
/perf --budget
```

## What AI checks
### Web
- Runs Lighthouse via the `lighthouse` CLI
- Reports **LCP, FID/INP, CLS, TTFB, FCP**
- Flags regressions and budget violations

### React Native
- Bundle analysis
- JS thread frame drops
- Hermes build size
- Notes runtime hotspots and oversized assets

## What AI does step by step
1. Detects whether the target is web or React Native.
2. For web, runs Lighthouse locally or against `--url`.
3. For mobile, analyzes bundle and runtime indicators.
4. Loads the last baseline when `--compare` is used.
5. Applies performance budget rules when `--budget` is used.
6. Returns actionable runtime findings separate from code-quality advice.
