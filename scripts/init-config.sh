#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-$(pwd)}"
TARGET="${TARGET/#\~/$HOME}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)"
CONFIG_FILE="$TARGET/.ghostforge-config.json"
GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

divider() { echo -e "${DIM}──────────────────────────────────────────────────────${NC}"; }
ask_choice() {
  local prompt="$1"; shift
  local options=("$@")
  echo -e "${BOLD}$prompt${NC}" >&2
  local i=1
  for option in "${options[@]}"; do echo "  $i) $option" >&2; ((i++)); done
  read -rp '  Choice: ' idx >&2
  echo "${options[$((idx-1))]:-${options[0]}}"
}

echo ""
echo -e "${BLUE}${BOLD}GhostForge Project Config Initializer${NC}"
echo -e "${DIM}Project: $TARGET${NC}"
divider

default_agent="$(ask_choice 'Default agent' frontend mobile backend fullstack qa security devops)"
test_runner="$(ask_choice 'Preferred test runner' jest vitest playwright detox)"
deploy_target="$(ask_choice 'Deploy target' azure vercel gh-pages custom)"
tracker_provider="$(ask_choice 'Issue tracker' github azure jira)"
read -rp 'Project key: ' project_key
package_manager="$(ask_choice 'Node package manager' npm yarn pnpm bun)"

cat > "$CONFIG_FILE" <<JSON
{
  "$schema": "./ghostforge-config.schema.json",
  "defaultAgent": "$default_agent",
  "testRunner": "$test_runner",
  "deployTarget": "$deploy_target",
  "issueTracker": {
    "provider": "$tracker_provider",
    "projectKey": "${project_key:-default}"
  },
  "packageManager": "$package_manager"
}
JSON

cp "$GHOSTFORGE_DIR/ghostforge-config.schema.json" "$TARGET/"
echo -e "${GREEN}✔ Created $CONFIG_FILE${NC}"
echo -e "${GREEN}✔ Copied ghostforge-config.schema.json${NC}"
