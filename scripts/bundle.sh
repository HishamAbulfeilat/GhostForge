#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
DATA_DIR="$HOME/.ghostforge/bundle"
HISTORY_FILE="$DATA_DIR/history.csv"
CONFIG_FILE="$DATA_DIR/config.json"

mkdir -p "$DATA_DIR"
[[ -f "$HISTORY_FILE" ]] || echo 'date,project,size_kb' > "$HISTORY_FILE"
[[ -f "$CONFIG_FILE" ]] || echo '{"threshold_kb":500}' > "$CONFIG_FILE"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  📦  GhostForge Bundle Size Tracker${NC}"
  echo -e "${DIM}  Track JavaScript build weight over time.${NC}"
  echo ""
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/bundle.sh track [dir]
  bash scripts/bundle.sh history
  bash scripts/bundle.sh compare
  bash scripts/bundle.sh alert [threshold_kb]
  bash scripts/bundle.sh clean
  bash scripts/bundle.sh help
EOF
}

find_js_kb() {
  local target="${1:-.}"
  local sum=0
  while IFS= read -r dir; do
    local value
    value="$(find "$dir" -type f -name '*.js' -exec du -sk {} + 2>/dev/null | awk '{sum+=$1} END {print sum+0}')"
    sum=$((sum + value))
  done < <(find "$target" -type d \( -path '*/.next/static' -o -path '*/dist' -o -path '*/build' \) 2>/dev/null | sort -u)
  echo "$sum"
}

track_cmd() {
  local target="${1:-.}"
  local size_kb project date_str
  size_kb="$(find_js_kb "$target")"
  project="$(basename "$(cd "$target" && pwd)")"
  date_str="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "$date_str,$project,$size_kb" >> "$HISTORY_FILE"
  header
  echo -e "${GREEN}✅ Tracked:${NC} ${BOLD}$project${NC} → ${CYAN}${size_kb} KB${NC}"
}

history_cmd() {
  header
  tail -n 10 "$HISTORY_FILE" | awk -F',' 'NR==1 {next} {printf "  %-19s  %-24s  %8s KB\n", $1, $2, $3}'
  echo ""
}

compare_cmd() {
  header
  local project
  project="$(basename "$PWD")"
  local lines
  lines="$(awk -F',' -v p="$project" 'NR>1 && $2==p {print $0}' "$HISTORY_FILE" | tail -n 2)"
  if [[ "$(printf '%s\n' "$lines" | sed '/^$/d' | wc -l | tr -d ' ')" -lt 2 ]]; then
    echo -e "${YELLOW}⚠ Need at least 2 tracked builds for ${project}.${NC}"
    return 0
  fi
  local prev curr
  prev="$(printf '%s\n' "$lines" | head -n 1 | awk -F',' '{print $3}')"
  curr="$(printf '%s\n' "$lines" | tail -n 1 | awk -F',' '{print $3}')"
  python3 - <<PY "$prev" "$curr"
import sys
prev=float(sys.argv[1]); curr=float(sys.argv[2])
change=((curr-prev)/prev*100) if prev else 0
icon='📈' if change>0 else '📉' if change<0 else '➖'
print(f"  Previous: {prev:.0f} KB")
print(f"  Current : {curr:.0f} KB")
print(f"  {icon} Change  : {change:+.2f}%")
PY
}

alert_cmd() {
  local threshold="${1:-500}"
  printf '{"threshold_kb":%s}\n' "$threshold" > "$CONFIG_FILE"
  header
  echo -e "${GREEN}✅ Alert threshold set to ${BOLD}${threshold} KB${NC}"
}

clean_cmd() {
  rm -rf "$DATA_DIR"
  mkdir -p "$DATA_DIR"
  echo 'date,project,size_kb' > "$HISTORY_FILE"
  echo '{"threshold_kb":500}' > "$CONFIG_FILE"
  header
  echo -e "${GREEN}✅ Bundle history cleared.${NC}"
}

case "$ACTION" in
  track)   track_cmd "${1:-.}" ;;
  history) history_cmd ;;
  compare) compare_cmd ;;
  alert)   alert_cmd "${1:-500}" ;;
  clean)   clean_cmd ;;
  help|--help|-h) help_text ;;
  *)       help_text; exit 1 ;;
esac
