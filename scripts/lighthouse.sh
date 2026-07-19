#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
DATA_DIR="$HOME/.ghostforge/lighthouse"
REPORT_DIR="$DATA_DIR/reports"
HISTORY_FILE="$DATA_DIR/history.csv"
LAST_HTML="$DATA_DIR/last-report.txt"
mkdir -p "$REPORT_DIR"
[[ -f "$HISTORY_FILE" ]] || echo 'date,url,performance,accessibility,best_practices,seo,json_report,html_report' > "$HISTORY_FILE"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🔦  GhostForge Lighthouse CI${NC}"
  echo -e "${DIM}  Performance, accessibility, best practices, and SEO tracking.${NC}"
  echo ""
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/lighthouse.sh install
  bash scripts/lighthouse.sh run [url]
  bash scripts/lighthouse.sh history
  bash scripts/lighthouse.sh report
  bash scripts/lighthouse.sh help
EOF
}

install_cmd() {
  header
  npm install -g lighthouse
}

run_cmd() {
  local url="${1:-http://localhost:3000}"
  local stamp json html
  stamp="$(date +%Y%m%d-%H%M%S)"
  json="$REPORT_DIR/$stamp.json"
  html="$REPORT_DIR/$stamp.html"
  header
  if ! command -v lighthouse >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Lighthouse not installed. Run install first.${NC}"
    exit 1
  fi
  lighthouse "$url" --output=json --output=html --output-path="$REPORT_DIR/$stamp" --quiet --chrome-flags='--headless' >/dev/null 2>&1
  node - <<'NODE' "$json" "$html" "$url" "$HISTORY_FILE" "$LAST_HTML"
const fs = require('fs');
const [jsonPath, htmlPath, url, historyPath, lastPath] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const score = key => Math.round(((report.categories?.[key]?.score) || 0) * 100);
const row = [
  new Date().toISOString().slice(0, 19).replace('T', ' '),
  url,
  score('performance'),
  score('accessibility'),
  score('best-practices'),
  score('seo'),
  jsonPath,
  htmlPath,
].join(',');
fs.appendFileSync(historyPath, row + '\n');
fs.writeFileSync(lastPath, htmlPath + '\n');
console.log(`  Performance   : ${score('performance')}`);
console.log(`  Accessibility : ${score('accessibility')}`);
console.log(`  Best Practices: ${score('best-practices')}`);
console.log(`  SEO           : ${score('seo')}`);
console.log(`  JSON report   : ${jsonPath}`);
console.log(`  HTML report   : ${htmlPath}`);
NODE
}

history_cmd() {
  header
  tail -n 10 "$HISTORY_FILE" | awk -F',' 'NR==1 {next} {
    perf=$3+0;
    color=(perf>=90?"\033[0;32m":perf>=70?"\033[1;33m":"\033[0;31m");
    printf "  %-19s  %-22s  %sP:%3s A:%3s B:%3s S:%3s\033[0m\n", $1, substr($2,1,22), color, $3, $4, $5, $6;
  }'
  echo ""
}

report_cmd() {
  header
  [[ -f "$LAST_HTML" ]] || { echo -e "${YELLOW}⚠ No saved HTML report yet.${NC}"; return 0; }
  local report
  report="$(tr -d '\n' < "$LAST_HTML")"
  echo -e "${BLUE}Opening:${NC} $report"
  open "$report" 2>/dev/null || xdg-open "$report" 2>/dev/null || echo "$report"
}

case "$ACTION" in
  install) install_cmd ;;
  run)     run_cmd "${1:-http://localhost:3000}" ;;
  history) history_cmd ;;
  report)  report_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
