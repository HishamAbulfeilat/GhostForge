#!/usr/bin/env bash
# /bundle — Bundle size analyzer and optimization advisor
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
BOLD='\033[1m'

echo ""
echo -e "  ${BOLD}${CYAN}╔══════════════════════════════════╗${NC}"
echo -e "  ${BOLD}${CYAN}║   GhostForge Bundle Analyzer          ║${NC}"
echo -e "  ${BOLD}${CYAN}╚══════════════════════════════════╝${NC}"
echo ""

# Detect project type
if [ -f "vite.config.ts" ] || [ -f "vite.config.js" ]; then
  TOOL="vite"
elif [ -f "next.config.ts" ] || [ -f "next.config.js" ]; then
  TOOL="next"
elif [ -f "webpack.config.js" ]; then
  TOOL="webpack"
else
  echo -e "  ${YELLOW}⚠️  Could not detect build tool. Supported: Vite, Next.js, Webpack${NC}"
  exit 1
fi
echo -e "  Detected: ${BOLD}$TOOL${NC}"

# Check for heavy deps
echo ""
echo -e "  ${BOLD}Scanning dependencies for bundle bloat...${NC}"
echo ""

PACKAGE_JSON="package.json"
[ ! -f "$PACKAGE_JSON" ] && echo -e "  ${RED}No package.json found${NC}" && exit 1

declare -A ALTERNATIVES=(
  ["moment"]="date-fns or dayjs (~80% smaller)"
  ["lodash\""]="lodash-es or native JS methods"
  ["lodash-webpack-plugin"]="lodash-es + tree shaking"
  ["jquery"]="Vanilla JS or React"
  ["axios"]="Consider native fetch for simple cases"
  ["@mui/material"]="shadcn/ui + Radix UI (~60% smaller)"
  ["antd"]="shadcn/ui + Radix UI (~70% smaller)"
  ["react-icons"]="@tabler/icons-react or lucide-react (tree-shakeable)"
  ["chart.js"]="react-apexcharts (better React integration)"
  ["recharts"]="react-apexcharts if already using ApexCharts"
)

FOUND_HEAVY=0
for pkg in "${!ALTERNATIVES[@]}"; do
  if grep -q "\"$pkg\"" "$PACKAGE_JSON" 2>/dev/null; then
    echo -e "  ${YELLOW}⚠️  $pkg${NC} → consider ${GREEN}${ALTERNATIVES[$pkg]}${NC}"
    FOUND_HEAVY=$((FOUND_HEAVY + 1))
  fi
done

[ $FOUND_HEAVY -eq 0 ] && echo -e "  ${GREEN}✅ No known heavy dependencies found${NC}"

# Check for missing lazy loading
echo ""
echo -e "  ${BOLD}Checking lazy loading opportunities...${NC}"
EAGER_IMPORTS=$(grep -rn "^import.*from" --include="*.tsx" --include="*.ts" . 2>/dev/null \
  | grep -E "(Chart|Table|Editor|Modal|Dialog|Drawer|Map|PDF|Calendar)" \
  | grep -v "lazy\|dynamic\|node_modules\|stories\|test\|spec" \
  | head -8)
if [ -n "$EAGER_IMPORTS" ]; then
  echo -e "  ${YELLOW}Components that could be lazy-loaded:${NC}"
  echo "$EAGER_IMPORTS" | while read -r line; do
    echo -e "  ${CYAN}$line${NC}"
  done
  echo ""
  echo -e "  Fix: const MyChart = dynamic(() => import('./MyChart'))  // Next.js"
  echo -e "       const MyChart = lazy(() => import('./MyChart'))     // React"
else
  echo -e "  ${GREEN}✅ No obvious lazy-loading opportunities detected${NC}"
fi

# Run actual analyzer if dist exists
echo ""
echo -e "  ${BOLD}Bundle size analysis:${NC}"
if [ -d "dist" ] || [ -d ".next" ]; then
  if [ "$TOOL" = "vite" ] && [ -d "dist" ]; then
    TOTAL=$(du -sh dist 2>/dev/null | cut -f1)
    echo -e "  dist/: ${BOLD}$TOTAL${NC}"
    echo ""
    echo -e "  For detailed visualization, run:"
    echo -e "  ${CYAN}npx vite-bundle-visualizer${NC}     (interactive treemap)"
    echo -e "  ${CYAN}npx bundlephobia-cli [package]${NC}  (per-package size)"
  elif [ "$TOOL" = "next" ] && [ -d ".next" ]; then
    echo -e "  Run ${CYAN}ANALYZE=true npm run build${NC} with @next/bundle-analyzer"
    echo -e "  or ${CYAN}npx nextjs-bundle-analysis${NC}"
  fi
else
  echo -e "  ${YELLOW}No build output found. Run build first for size analysis.${NC}"
  echo -e "  ${CYAN}npm run build${NC}"
fi

echo ""
echo -e "  ${BOLD}Recommendations:${NC}"
echo -e "  • Target: JS < 200KB gzipped, CSS < 50KB gzipped"
echo -e "  • Use dynamic imports for routes (React Router, Next.js)"
echo -e "  • Enable tree-shaking: use named imports, not default"
echo -e "  • Use \`import type\` for TypeScript-only imports"
echo -e "  • Consider splitting vendor chunks in vite.config"
echo ""
