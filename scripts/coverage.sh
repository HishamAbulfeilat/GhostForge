#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

ACTION="${1:-help}"
shift || true
DATA_DIR="$HOME/.ghostforge/coverage"
HISTORY_FILE="$DATA_DIR/history.csv"
THRESHOLD_FILE="$DATA_DIR/thresholds.csv"
mkdir -p "$DATA_DIR"
[[ -f "$HISTORY_FILE" ]] || echo 'date,project,lines,branches,functions' > "$HISTORY_FILE"
[[ -f "$THRESHOLD_FILE" ]] || echo 'project,threshold' > "$THRESHOLD_FILE"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  📈  GhostForge Test Coverage Tracker${NC}"
  echo -e "${DIM}  Capture snapshots, track history, compare regressions, and alert on drops.${NC}"
  echo ""
}

project_name() {
  basename "$(pwd)"
}

coverage_summary_file() {
  for file in coverage/coverage-summary.json coverage-summary.json; do
    [[ -f "$file" ]] && {
      printf '%s\n' "$file"
      return 0
    }
  done
  return 1
}

runner_type() {
  if [[ -f package.json ]] && grep -qi 'vitest' package.json; then
    echo 'vitest'
  elif [[ -f package.json ]] && grep -qi 'jest' package.json; then
    echo 'jest'
  else
    echo 'unknown'
  fi
}

snapshot_cmd() {
  header
  local runner project summary metrics lines branches functions
  runner="$(runner_type)"
  project="$(project_name)"
  rm -f .ghostforge-coverage-vitest.json .ghostforge-coverage-jest.json
  if [[ "$runner" == 'vitest' ]]; then
    npm run test -- --coverage --reporter=json --outputFile=.ghostforge-coverage-vitest.json
  else
    npx jest --coverage --json --outputFile=.ghostforge-coverage-jest.json
  fi
  summary="$(coverage_summary_file || true)"
  [[ -n "$summary" ]] || {
    echo -e "${RED}✖ Coverage summary not found after test run.${NC}"
    exit 1
  }
  metrics="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const t=j.total||{};console.log([t.lines?.pct||0,t.branches?.pct||0,t.functions?.pct||0].map(v=>Number(v).toFixed(2)).join(','))" "$summary")"
  IFS=',' read -r lines branches functions <<< "$metrics"
  echo "$(date '+%Y-%m-%d %H:%M:%S'),$project,$lines,$branches,$functions" >> "$HISTORY_FILE"
  echo -e "${GREEN}✅ Snapshot saved.${NC}"
  echo -e "${CYAN}Lines:${NC} $lines%"
  echo -e "${CYAN}Branches:${NC} $branches%"
  echo -e "${CYAN}Functions:${NC} $functions%"
}

history_cmd() {
  header
  tail -n 10 "$HISTORY_FILE" | awk -F',' 'NR==1{next} { color=($3>=80?"\033[0;32m":($3>=60?"\033[1;33m":"\033[0;31m")); printf "  %s%-19s  %-20s  L:%6s%%  B:%6s%%  F:%6s%%\033[0m\n", color, $1, $2, $3, $4, $5 }'
}

compare_cmd() {
  header
  local project rows
  project="$(project_name)"
  rows="$(grep ",$project," "$HISTORY_FILE" | tail -2 || true)"
  [[ "$(printf '%s\n' "$rows" | sed '/^$/d' | wc -l | tr -d ' ')" -ge 2 ]] || {
    echo -e "${YELLOW}⚠ Need at least two snapshots for ${project}.${NC}"
    exit 0
  }
  python3 - <<'PY' "$rows"
import sys
rows = [line.split(",") for line in sys.argv[1].splitlines() if line.strip()]
prev, curr = rows[-2], rows[-1]
for idx, label in [(2, "Lines"), (3, "Branches"), (4, "Functions")]:
    p = float(prev[idx]); c = float(curr[idx])
    arrow = "↑" if c > p else "↓" if c < p else "→"
    delta = c - p
    print(f"{label}: {p:.2f}% {arrow} {c:.2f}% ({delta:+.2f})")
PY
}

alert_cmd() {
  header
  local project threshold latest lines
  project="$(project_name)"
  threshold="${1:-}"
  if [[ -n "$threshold" ]]; then
    python3 - <<'PY' "$project" "$threshold" "$THRESHOLD_FILE"
from pathlib import Path
import sys
project, threshold, file = sys.argv[1:4]
path = Path(file)
rows = [line.strip().split(",") for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
out = [rows[0]]
updated = False
for row in rows[1:]:
    if row[0] == project:
        out.append([project, threshold])
        updated = True
    else:
        out.append(row)
if not updated:
    out.append([project, threshold])
path.write_text("\n".join(",".join(r) for r in out) + "\n", encoding="utf-8")
PY
  fi
  latest="$(grep ",$project," "$HISTORY_FILE" | tail -1 || true)"
  [[ -n "$latest" ]] || {
    echo -e "${YELLOW}⚠ No snapshots for ${project}.${NC}"
    exit 0
  }
  lines="$(printf '%s\n' "$latest" | awk -F',' '{print $3}')"
  threshold="$(awk -F',' -v p="$project" '$1==p{print $2}' "$THRESHOLD_FILE" | tail -1)"
  threshold="${threshold:-80}"
  echo -e "${CYAN}Threshold:${NC} ${threshold}%"
  echo -e "${CYAN}Latest lines:${NC} ${lines}%"
  awk -v lines="$lines" -v threshold="$threshold" 'BEGIN { exit !(lines+0 < threshold+0) }' \
    && echo -e "${YELLOW}⚠ Coverage is below threshold.${NC}" \
    || echo -e "${GREEN}✅ Coverage meets threshold.${NC}"
}

report_cmd() {
  header
  local project file
  project="$(project_name)"
  file="$DATA_DIR/report-$(date +%Y%m%d-%H%M%S).md"
  {
    echo "# Coverage Report"
    echo ""
    echo "- Project: **$project**"
    echo "- Generated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    echo "| Date | Lines | Branches | Functions |"
    echo "| --- | ---: | ---: | ---: |"
    grep ",$project," "$HISTORY_FILE" | tail -10 | awk -F',' '{printf "| %s | %s%% | %s%% | %s%% |\n", $1, $3, $4, $5}'
  } > "$file"
  echo -e "${GREEN}✅ Saved report:${NC} $file"
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/coverage.sh snapshot
  bash scripts/coverage.sh history
  bash scripts/coverage.sh compare
  bash scripts/coverage.sh alert [threshold]
  bash scripts/coverage.sh report
  bash scripts/coverage.sh help
EOF
}

case "$ACTION" in
  snapshot) snapshot_cmd ;;
  history) history_cmd ;;
  compare) compare_cmd ;;
  alert) alert_cmd "${1:-}" ;;
  report) report_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
