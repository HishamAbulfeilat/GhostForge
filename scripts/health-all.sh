#!/usr/bin/env bash
set -euo pipefail
GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; CYAN='\033[0;36m'; NC='\033[0m'

PROJECTS_FILE="$GHOSTFORGE_DIR/.registered-projects"
PARALLEL=false
for arg in "$@"; do [[ "$arg" == "--parallel" ]] && PARALLEL=true; done

echo ""
echo -e "${BLUE}${BOLD}  ╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   Multi-Project Health Scan                  ║${NC}"
echo -e "${BLUE}${BOLD}  ╚══════════════════════════════════════════════╝${NC}"
echo ""

if [[ ! -f "$PROJECTS_FILE" ]] || [[ ! -s "$PROJECTS_FILE" ]]; then
  echo -e "  ${YELLOW}⚠  No registered projects found.${NC}"
  echo -e "  ${DIM}  Register: echo '/path/to/project' >> ~/ghostforge-agents/.registered-projects${NC}"
  exit 0
fi

mapfile -t PROJECTS < <(grep -v '^\s*#' "$PROJECTS_FILE" | grep -v '^\s*$' || true)
if [[ ${#PROJECTS[@]} -eq 0 ]]; then
  echo -e "  ${YELLOW}⚠  No valid project paths in .registered-projects${NC}"
  exit 0
fi

echo -e "  ${DIM}Scanning ${#PROJECTS[@]} registered projects...${NC}"
$PARALLEL && echo -e "  ${DIM}Parallel mode requested (currently informational only).${NC}"
echo ""

declare -A SCORES
declare -A ICONS

run_health() {
  local proj="$1"
  if [[ ! -d "$proj" ]]; then
    SCORES["$proj"]="N/A"; ICONS["$proj"]="⚫"; return
  fi

  local cache_json="$proj/.ghostforge-cache/health.json"
  local cache_legacy="$proj/.ghostforge-health-cache"

  if [[ -f "$cache_json" ]]; then
    local raw score
    raw="$(cat "$cache_json" 2>/dev/null || true)"
    score="$(echo "$raw" | python3 -c "import json,sys,re; d=sys.stdin.read(); m=re.search(r'\"score\":\s*\"[^\"]*?(\d+)/100\"', d); print(m.group(1) if m else '?')" 2>/dev/null || echo "?")"
    SCORES["$proj"]="$score"
  elif [[ -f "$cache_legacy" ]]; then
    local score
    score="$(grep -E '^score=' "$cache_legacy" 2>/dev/null | head -1 | cut -d'=' -f2 || echo '?')"
    SCORES["$proj"]="${score:-?}"
  else
    local out
    out="$(bash "$GHOSTFORGE_DIR/scripts/health-check.sh" "$proj" 2>/dev/null | grep -E "Final health score:|score\": " | grep -oE '[0-9]+/100|[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "?")"
    SCORES["$proj"]="${out:-?}"
  fi

  local score="${SCORES[$proj]}"
  if [[ "$score" =~ ^[0-9]+$ ]]; then
    (( score >= 90 )) && ICONS["$proj"]="🟢" || (( score >= 70 )) && ICONS["$proj"]="🟡" || (( score >= 50 )) && ICONS["$proj"]="🟠" || ICONS["$proj"]="🔴"
  else
    ICONS["$proj"]="⚫"
  fi
}

for proj in "${PROJECTS[@]}"; do
  proj="${proj/#\~/$HOME}"
  run_health "$proj"
done

echo -e "  ${BOLD}Project Health Comparison:${NC}"
echo ""
printf "  ${BLUE}%-4s  %-35s  %-8s  %s${NC}\n" "Icon" "Project" "Score" "Path"
echo -e "  ${DIM}$(printf '%.0s─' {1..65})${NC}"

TOTAL=0; COUNT=0; BEST_SCORE=-1; BEST_PROJ=""; WORST_SCORE=101; WORST_PROJ=""

for proj in "${PROJECTS[@]}"; do
  proj="${proj/#\~/$HOME}"
  name="$(basename "$proj")"
  score="${SCORES[$proj]:-?}"
  icon="${ICONS[$proj]:-⚫}"

  if [[ "$score" =~ ^[0-9]+$ ]]; then
    TOTAL=$((TOTAL + score)); COUNT=$((COUNT + 1))
    (( score > BEST_SCORE )) && { BEST_SCORE=$score; BEST_PROJ="$name"; }
    (( score < WORST_SCORE )) && { WORST_SCORE=$score; WORST_PROJ="$name"; }
    COLOR="${GREEN}"; (( score < 70 )) && COLOR="${YELLOW}"; (( score < 50 )) && COLOR="${RED}"
    printf "  %s    ${COLOR}%-35s  %3s/100${NC}  ${DIM}%s${NC}\n" "$icon" "$name" "$score" "$proj"
  else
    printf "  %s    ${DIM}%-35s  %7s  %s${NC}\n" "$icon" "$name" "no data" "$proj"
  fi
done

echo ""
echo -e "  ${DIM}$(printf '%.0s─' {1..65})${NC}"

if (( COUNT > 0 )); then
  AVG=$((TOTAL / COUNT))
  AVG_ICON="🟢"; (( AVG < 70 )) && AVG_ICON="🟡"; (( AVG < 50 )) && AVG_ICON="🟠"; (( AVG < 30 )) && AVG_ICON="🔴"
  echo ""
  echo -e "  ${BOLD}Summary:${NC}"
  echo -e "  Average score : ${AVG_ICON} ${BOLD}${AVG}/100${NC}"
  echo -e "  Best project  : ${GREEN}${BEST_PROJ} (${BEST_SCORE}/100)${NC}"
  echo -e "  Needs work    : ${YELLOW}${WORST_PROJ} (${WORST_SCORE}/100)${NC}"
  echo -e "  Projects scanned: ${COUNT}/${#PROJECTS[@]}"
fi
echo ""
