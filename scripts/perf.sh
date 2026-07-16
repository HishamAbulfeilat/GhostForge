#!/usr/bin/env bash
set -euo pipefail
GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

URL="${1:-}"
MODE="${2:-desktop}"
FORMAT="${3:-json}"

echo ""
echo -e "${BLUE}${BOLD}  ╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   /perf — Lighthouse Performance Audit ║${NC}"
echo -e "${BLUE}${BOLD}  ╚════════════════════════════════════════╝${NC}"
echo ""

if [[ -z "$URL" ]]; then
  echo -e "  ${DIM}Enter the URL to audit (e.g. http://localhost:3000):${NC}"
  read -rp "  > " URL
fi
[[ -z "$URL" ]] && { echo -e "  ${RED}✖  No URL provided.${NC}"; exit 1; }

echo -e "  ${BLUE}URL:${NC} $URL"
echo -e "  ${BLUE}Mode:${NC} $MODE"
echo -e "  ${BLUE}Format:${NC} $FORMAT"
echo ""

OUT_DIR="$GHOSTFORGE_DIR/.cache/perf/$(date +%s)"
mkdir -p "$OUT_DIR"
REPORT_JSON="$OUT_DIR/report.json"

if ! command -v lighthouse &>/dev/null; then
  echo -e "  ${DIM}Installing Lighthouse...${NC}"
  npm install -g lighthouse --silent 2>/dev/null || {
    echo -e "  ${RED}✖  Could not install Lighthouse. Run: npm install -g lighthouse${NC}"
    exit 1
  }
fi

CHROME_FLAGS="--headless --no-sandbox --disable-gpu --disable-dev-shm-usage"

echo -e "  ${DIM}Running Lighthouse audit (this takes ~30s)...${NC}"
echo ""

lighthouse "$URL" \
  --output=json \
  --output-path="$REPORT_JSON" \
  --form-factor="$MODE" \
  --chrome-flags="$CHROME_FLAGS" \
  --quiet 2>/dev/null || {
    echo -e "  ${RED}✖  Lighthouse failed. Make sure Chrome/Chromium is installed.${NC}"
    echo -e "  ${DIM}  macOS: brew install --cask google-chrome${NC}"
    echo -e "  ${DIM}  Linux: sudo apt install chromium-browser${NC}"
    exit 1
  }

if [[ "$FORMAT" == "html" ]]; then
  REPORT_HTML="$OUT_DIR/report.html"
  lighthouse "$URL" \
    --output=html \
    --output-path="$REPORT_HTML" \
    --form-factor="$MODE" \
    --chrome-flags="$CHROME_FLAGS" \
    --quiet >/dev/null 2>&1 || true
fi

if [[ -f "$REPORT_JSON" ]] && command -v node &>/dev/null; then
  node -e "
    const r = require('$REPORT_JSON');
    const cats = r.categories || {};
    console.log('');
    console.log('  \033[1mLighthouse Results:\033[0m');
    console.log('');
    const rows = [
      ['Performance', cats.performance?.score],
      ['Accessibility', cats.accessibility?.score],
      ['Best Practices', cats['best-practices']?.score],
      ['SEO', cats.seo?.score],
      ['PWA', cats.pwa?.score],
    ];
    rows.forEach(([name, score]) => {
      if (score !== undefined && score !== null) {
        const pct = Math.round(score * 100);
        const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
        const icon = pct >= 90 ? '\033[32m' : pct >= 50 ? '\033[33m' : '\033[31m';
        console.log('  ' + icon + (name + ':').padEnd(18) + pct.toString().padStart(3) + '/100  ' + bar + '\033[0m');
      }
    });
    const lcp = r.audits?.['largest-contentful-paint']?.displayValue || '?';
    const tbt = r.audits?.['total-blocking-time']?.displayValue || '?';
    const cls = r.audits?.['cumulative-layout-shift']?.displayValue || '?';
    const fcp = r.audits?.['first-contentful-paint']?.displayValue || '?';
    const si  = r.audits?.['speed-index']?.displayValue || '?';
    console.log('');
    console.log('  \033[1mCore Web Vitals:\033[0m');
    console.log('  FCP (First Contentful Paint) : ' + fcp);
    console.log('  LCP (Largest Contentful Paint): ' + lcp);
    console.log('  TBT (Total Blocking Time)    : ' + tbt);
    console.log('  CLS (Cumulative Layout Shift): ' + cls);
    console.log('  Speed Index                  : ' + si);
    console.log('');
    const opps = Object.values(r.audits || {})
      .filter(a => a.details?.type === 'opportunity' && a.score !== null && a.score < 0.9)
      .sort((a, b) => (a.score || 0) - (b.score || 0))
      .slice(0, 5);
    if (opps.length > 0) {
      console.log('  \033[1mTop Opportunities:\033[0m');
      opps.forEach(o => console.log('  ⚡ ' + o.title + ' — ' + (o.displayValue || '')));
    }
    console.log('');
    console.log('  \033[2mFull report: $REPORT_JSON\033[0m');
  " 2>/dev/null || echo -e "  ${YELLOW}  Run: cat $REPORT_JSON | python3 -m json.tool${NC}"
fi

echo ""
echo -e "  ${GREEN}${BOLD}✅ Audit complete!${NC}"
echo -e "  ${DIM}Report saved: $REPORT_JSON${NC}"
[[ -n "${REPORT_HTML:-}" && -f "${REPORT_HTML:-}" ]] && echo -e "  ${DIM}HTML report: $REPORT_HTML${NC}"
echo -e "  ${DIM}Tip: Run with URL port to audit local dev server${NC}"
echo ""
