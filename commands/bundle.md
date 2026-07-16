# /bundle Command

## Purpose
Analyze frontend bundle size, identify the heaviest dependencies, and suggest practical optimizations.

## Usage
```bash
/bundle
```

## What AI should do
1. Detect the bundler and available analysis tool.
2. Run bundle analysis with one of these commands:
   - `npx vite-bundle-visualizer`
   - `npx source-map-explorer`
3. Identify the top 5 largest dependencies or chunks.
4. Report total bundle size and compare it with a recommended budget.
5. Suggest improvements such as:
   - lazy loading and route-level code splitting
   - replacing heavy libraries with lighter alternatives
   - improving tree-shaking and import paths
   - removing dead code or duplicate packages
6. Check for common bundle bloat patterns, especially:
   - `moment` → prefer `date-fns` or `dayjs`
   - `lodash` → prefer `lodash-es` or native APIs

## Output format
- **Tool used**
- **Total bundle size**
- **Top 5 largest dependencies**
- **Budget status**: within budget or above budget
- **Optimization opportunities**
- **Recommended next actions**

## Recommended budgets
- Initial JavaScript: under 250 KB gzipped for a typical app shell
- Route chunks: keep major routes as small as practical and lazy-load infrequent flows
