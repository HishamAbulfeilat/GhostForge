# /perf Command

## Purpose
Run Lighthouse performance audits on your web app and get a score report.

## Usage
```bash
/perf                           # Audit http://localhost:3000
/perf https://example.com      # Audit a specific URL
/perf --mobile                  # Run mobile audit
/perf --categories all          # Include SEO, A11y, Best Practices
```

## What It Audits
- Performance (LCP, FID, CLS, TTFB)
- Accessibility
- Best Practices
- SEO
- PWA

## Requirements
```bash
npm install -g lighthouse        # Install once
```
Or uses `npx lighthouse` automatically.

## Output
- Scores per category (0–100)
- JSON report saved to `lighthouse-report.json`
- Opens HTML report in browser optionally
