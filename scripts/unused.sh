#!/usr/bin/env bash
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

MODE="all"
FIX=false
REPORTER="symbols"

for arg in "$@"; do
  case "$arg" in
    --deps) MODE="deps" ;;
    --exports) MODE="exports" ;;
    --files) MODE="files" ;;
    --fix) FIX=true ;;
    --reporter=*) REPORTER="${arg#--reporter=}" ;;
  esac
done

echo ""
echo -e "${BLUE}${BOLD}  ╔═════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   /unused — Dead Code Finder (knip)     ║${NC}"
echo -e "${BLUE}${BOLD}  ╚═════════════════════════════════════════╝${NC}"
echo ""

# Check package.json exists
if [[ ! -f "package.json" ]]; then
  echo -e "  ${RED}✖  No package.json found. Run from a Node.js project root.${NC}"
  exit 1
fi

echo -e "  ${DIM}Mode: $MODE | Reporter: $REPORTER${NC}"
echo ""

# Build knip args
KNIP_ARGS=("--reporter" "$REPORTER")
case "$MODE" in
  deps)    KNIP_ARGS+=("--include" "dependencies,unlisted") ;;
  exports) KNIP_ARGS+=("--include" "exports,nsExports,classMembers") ;;
  files)   KNIP_ARGS+=("--include" "files") ;;
esac

if $FIX; then
  # Safety: check git status first
  if git rev-parse --git-dir &>/dev/null; then
    DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    if (( DIRTY > 0 )); then
      echo -e "  ${YELLOW}⚠  Uncommitted changes detected. Commit or stash before --fix.${NC}"
      exit 1
    fi
  fi
  KNIP_ARGS+=("--fix")
fi

echo -e "  ${DIM}Running: npx knip ${KNIP_ARGS[*]}${NC}"
echo ""

if npx --yes knip "${KNIP_ARGS[@]}" 2>&1; then
  echo ""
  echo -e "  ${GREEN}✅ Scan complete.${NC}"
  if $FIX; then
    echo -e "  ${GREEN}✔  Safe unused items removed.${NC}"
    echo -e "  ${DIM}  Review changes with: git diff${NC}"
  else
    echo -e "  ${DIM}  Tip: Run /unused --fix to auto-remove safe items (checks git status first)${NC}"
  fi
else
  echo ""
  echo -e "  ${YELLOW}⚠  knip found issues (see above).${NC}"
fi

echo ""
