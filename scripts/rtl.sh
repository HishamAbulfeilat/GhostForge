#!/usr/bin/env bash
# /rtl — Tailwind RTL audit: find physical spacing classes and replace with logical ones
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
BOLD='\033[1m'

TARGET="${1:-.}"
AUTO_FIX="${2:-}"

echo ""
echo -e "  ${BOLD}${CYAN}╔══════════════════════════════════╗${NC}"
echo -e "  ${BOLD}${CYAN}║   GhostForge RTL Audit                ║${NC}"
echo -e "  ${BOLD}${CYAN}╚══════════════════════════════════╝${NC}"
echo ""

EXTS='--include=*.tsx --include=*.ts --include=*.jsx --include=*.js --include=*.css --include=*.scss --include=*.html'

declare -A REPLACEMENTS=(
  ["\\bml-"]="ms-"
  ["\\bmr-"]="me-"
  ["\\bpl-"]="ps-"
  ["\\bpr-"]="pe-"
  ["\\btext-left\\b"]="text-start"
  ["\\btext-right\\b"]="text-end"
  ["\\bleft-0\\b"]="start-0"
  ["\\bright-0\\b"]="end-0"
  ["\\bleft-1"]="start-1"
  ["\\bright-1"]="end-1"
  ["\\bleft-2"]="start-2"
  ["\\bright-2"]="end-2"
  ["\\bleft-4"]="start-4"
  ["\\bright-4"]="end-4"
  ["\\brounded-l-"]="rounded-s-"
  ["\\brounded-r-"]="rounded-e-"
  ["\\bborder-l-"]="border-s-"
  ["\\bborder-r-"]="border-e-"
)

TOTAL=0
declare -A COUNTS

for pattern in "${!REPLACEMENTS[@]}"; do
  replacement="${REPLACEMENTS[$pattern]}"
  count=$(grep -rn $EXTS --count "$pattern" "$TARGET" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
  if [ "$count" -gt 0 ]; then
    COUNTS["$pattern→$replacement"]=$count
    TOTAL=$((TOTAL + count))
  fi
done

if [ $TOTAL -eq 0 ]; then
  echo -e "  ${GREEN}✅ No RTL issues found! All spacing classes use logical properties.${NC}"
  echo ""
  exit 0
fi

echo -e "  ${RED}Found ${TOTAL} non-logical class usages:${NC}"
echo ""
printf "  %-30s %-20s %s\n" "Pattern" "→ Replace with" "Count"
printf "  %-30s %-20s %s\n" "-------" "--------------" "-----"
for entry in "${!COUNTS[@]}"; do
  pattern="${entry%%→*}"
  replacement="${entry##*→}"
  printf "  ${YELLOW}%-30s${NC} ${GREEN}%-20s${NC} %s\n" "$pattern" "$replacement" "${COUNTS[$entry]}"
done

echo ""
# Show first 5 locations
echo -e "  ${BOLD}Sample locations:${NC}"
for pattern in "${!REPLACEMENTS[@]}"; do
  grep -rn $EXTS "$pattern" "$TARGET" 2>/dev/null | head -2 | while read -r line; do
    echo -e "  ${CYAN}$line${NC}"
  done
done | head -15
echo ""

if [ "$AUTO_FIX" = "--fix" ]; then
  echo -e "  ${BOLD}Auto-fixing...${NC}"
  for pattern in "${!REPLACEMENTS[@]}"; do
    replacement="${REPLACEMENTS[$pattern]}"
    grep -rl $EXTS "$pattern" "$TARGET" 2>/dev/null | xargs -r sed -i "s/${pattern}/${replacement}/g" 2>/dev/null || true
  done
  echo -e "  ${GREEN}✅ Auto-fix applied. Review changes with: git diff${NC}"
else
  echo -e "  Run with ${BOLD}--fix${NC} to auto-replace: bash scripts/rtl.sh . --fix"
fi
echo ""
