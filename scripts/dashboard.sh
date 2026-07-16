#!/usr/bin/env bash
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_JS="$GHOSTFORGE_DIR/tui/dashboard.js"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

if [[ ! -f "$DASHBOARD_JS" ]]; then
  echo -e "${RED}✖  Dashboard not found at $DASHBOARD_JS${NC}"
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo -e "${RED}✖  Node.js not found. Install Node.js 18+.${NC}"
  exit 1
fi

# Check gh auth
if ! gh auth status &>/dev/null 2>&1; then
  echo -e "${YELLOW}⚠  gh CLI not authenticated. Run: gh auth login${NC}"
  echo -e "${DIM}  Dashboard will show limited data without GitHub auth.${NC}"
  echo ""
fi

echo -e "${BLUE}${BOLD}  Launching GhostForge Developer Dashboard...${NC}"
echo -e "${DIM}  Keyboard: R=refresh  Q=quit  Tab=focus  ↑↓=scroll${NC}"
echo ""
sleep 0.5

cd "$GHOSTFORGE_DIR"
node "$DASHBOARD_JS"
