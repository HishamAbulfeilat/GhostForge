#!/usr/bin/env bash
set -euo pipefail
GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; CYAN='\033[0;36m'; NC='\033[0m'

TARGET="$(pwd)"
TICKET="${1:-}"
for arg in "$@"; do
  case "$arg" in
    --path=*) TARGET="${arg#--path=}" ;;
    *) [[ "$arg" != --* ]] && TICKET="$arg" ;;
  esac
done

echo ""
echo -e "${BLUE}${BOLD}  ╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   /estimate — Story Point Estimator               ║${NC}"
echo -e "${BLUE}${BOLD}  ╚════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${DIM}Project: $TARGET${NC}"
echo ""

SRC_DIR="$TARGET/src"
[[ ! -d "$SRC_DIR" ]] && SRC_DIR="$TARGET"

echo -e "  ${BLUE}Analyzing codebase complexity...${NC}"
echo ""

TS_FILES=$(find "$SRC_DIR" \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null | grep -v '/node_modules/' | wc -l | tr -d ' ')
JS_FILES=$(find "$SRC_DIR" \( -name "*.js" -o -name "*.jsx" \) 2>/dev/null | grep -v '/node_modules/' | wc -l | tr -d ' ')
TEST_FILES=$(find "$SRC_DIR" \( -name "*.test.*" -o -name "*.spec.*" \) 2>/dev/null | grep -v '/node_modules/' | wc -l | tr -d ' ')
TOTAL_LINES=$(find "$SRC_DIR" \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) 2>/dev/null | grep -v '/node_modules/' | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}' || echo 0)
COMPONENTS=$(find "$SRC_DIR" \( -name "*.tsx" -o -name "*.jsx" \) 2>/dev/null | grep -v '/node_modules/' | wc -l | tr -d ' ')
HAS_TESTS=$(( TEST_FILES > 0 ? 1 : 0 ))
HAS_TYPES=$(( TS_FILES > 0 ? 1 : 0 ))
DEPS=$(node -e "const p=require('$TARGET/package.json'); console.log(Object.keys(p.dependencies||{}).length)" 2>/dev/null || echo 0)

echo -e "  ${DIM}TypeScript files : $TS_FILES${NC}"
echo -e "  ${DIM}JavaScript files : $JS_FILES${NC}"
echo -e "  ${DIM}Components       : $COMPONENTS${NC}"
echo -e "  ${DIM}Test files       : $TEST_FILES${NC}"
echo -e "  ${DIM}Total lines      : $TOTAL_LINES${NC}"
echo -e "  ${DIM}Dependencies     : $DEPS packages${NC}"
echo -e "  ${DIM}Has tests        : $([[ $HAS_TESTS -eq 1 ]] && echo Yes || echo No)${NC}"
echo -e "  ${DIM}Has TypeScript   : $([[ $HAS_TYPES -eq 1 ]] && echo Yes || echo No)${NC}"
echo ""

COMPLEXITY=1
(( TS_FILES > 100 )) && COMPLEXITY=$((COMPLEXITY + 2))
(( TS_FILES > 50 )) && COMPLEXITY=$((COMPLEXITY + 1))
(( TOTAL_LINES > 10000 )) && COMPLEXITY=$((COMPLEXITY + 2))
(( TOTAL_LINES > 5000 )) && COMPLEXITY=$((COMPLEXITY + 1))
(( DEPS > 30 )) && COMPLEXITY=$((COMPLEXITY + 1))
(( TEST_FILES < 10 )) && COMPLEXITY=$((COMPLEXITY + 1))

echo -e "  ${BOLD}Ticket description:${NC}"
if [[ -z "$TICKET" ]]; then
  echo -e "  ${DIM}(no description provided — enter below for better estimate)${NC}"
  read -rp "  > " TICKET
fi

if [[ -n "$TICKET" ]]; then
  echo -e "  ${DIM}\"$TICKET\"${NC}"
fi
echo ""

POINTS=3
TICKET_LOWER="${TICKET,,}"

if echo "$TICKET_LOWER" | grep -qE "typo|text|copy|label|rename|wording|minor"; then POINTS=1
elif echo "$TICKET_LOWER" | grep -qE "simple|small|quick|trivial|cosmetic|style|css|color"; then POINTS=2
elif echo "$TICKET_LOWER" | grep -qE "form|modal|page|screen|component|list|table|filter"; then POINTS=3
elif echo "$TICKET_LOWER" | grep -qE "auth|login|api|integration|service|hook|complex|refactor"; then POINTS=5
elif echo "$TICKET_LOWER" | grep -qE "architecture|migration|system|full|redesign|overhaul"; then POINTS=8
elif echo "$TICKET_LOWER" | grep -qE "epic|major|new feature|entire|from scratch"; then POINTS=13
fi

(( COMPLEXITY >= 5 )) && POINTS=$((POINTS + 1))
[[ "$HAS_TESTS" -eq 0 ]] && POINTS=$((POINTS + 1))

fibonacci=(1 2 3 5 8 13 21)
FINAL_POINTS=3
for f in "${fibonacci[@]}"; do
  (( f <= POINTS )) && FINAL_POINTS=$f
done
(( POINTS > FINAL_POINTS )) && {
  for f in "${fibonacci[@]}"; do
    (( f > FINAL_POINTS && f >= POINTS )) && { FINAL_POINTS=$f; break; } || true
  done
}

HOURS_LOW=$((FINAL_POINTS * 2))
HOURS_HIGH=$((FINAL_POINTS * 4))
CONFIDENCE="Medium"
(( FINAL_POINTS <= 3 )) && CONFIDENCE="High"
(( FINAL_POINTS >= 8 )) && CONFIDENCE="Low"

echo -e "  ${BOLD}Estimation:${NC}"
echo ""
echo -e "  Story Points  : ${GREEN}${BOLD}$FINAL_POINTS SP${NC}  ${DIM}(Fibonacci scale)${NC}"
echo -e "  Time range    : ${CYAN}${HOURS_LOW}h – ${HOURS_HIGH}h${NC}"
echo -e "  Confidence    : ${YELLOW}$CONFIDENCE${NC}"
echo -e "  Codebase size : ${DIM}$COMPLEXITY/7 complexity score${NC}"
echo ""
echo -e "  ${DIM}Fibonacci scale: 1 · 2 · 3 · 5 · 8 · 13 · 21${NC}"
echo -e "  ${DIM}  1-2: trivial  3-5: standard  8-13: complex  21: spike needed${NC}"
echo ""
