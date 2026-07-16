#!/usr/bin/env bash
# /ticket — Scaffold feature from Jira/Azure DevOps ticket
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
BOLD='\033[1m'

TICKET_ID="${1:-}"

echo ""
echo -e "  ${BOLD}${CYAN}╔══════════════════════════════════╗${NC}"
echo -e "  ${BOLD}${CYAN}║   GhostForge Ticket Scaffold          ║${NC}"
echo -e "  ${BOLD}${CYAN}╚══════════════════════════════════╝${NC}"
echo ""

if [ -z "$TICKET_ID" ]; then
  echo -e "  ${YELLOW}Usage: bash scripts/ticket.sh <TICKET-ID>${NC}"
  echo -e "  ${YELLOW}Example: bash scripts/ticket.sh PROJ-123${NC}"
  echo ""
  echo -e "  Or use the /ticket command in Copilot Chat and paste the ticket description."
  exit 0
fi

# Normalize ticket ID
TICKET_UPPER=$(echo "$TICKET_ID" | tr '[:lower:]' '[:upper:]')
TICKET_LOWER=$(echo "$TICKET_ID" | tr '[:upper:]' '[:lower:]' | tr '_' '-')

echo -e "  Ticket: ${BOLD}$TICKET_UPPER${NC}"
echo ""

# Detect project type
if [ -f "next.config.ts" ] || [ -f "next.config.js" ]; then
  FRAMEWORK="nextjs"
elif [ -f "vite.config.ts" ] || [ -f "vite.config.js" ]; then
  FRAMEWORK="vite"
else
  FRAMEWORK="unknown"
fi

# Generate branch name
BRANCH="feature/${TICKET_LOWER}"
echo -e "  ${BOLD}Suggested branch:${NC} ${CYAN}$BRANCH${NC}"
echo -e "  Create it: ${CYAN}git checkout -b $BRANCH${NC}"
echo ""

# Generate commit message template
echo -e "  ${BOLD}Commit message template:${NC}"
echo -e "  ${CYAN}feat(${TICKET_UPPER}): <description>"
echo ""
echo -e "  - <what was changed>"
echo -e "  - <why it was changed>"
echo ""
echo -e "  Closes ${TICKET_UPPER}${NC}"
echo ""

# Detect component name from ticket
COMPONENT_NAME=$(echo "$TICKET_ID" | sed 's/[^a-zA-Z0-9]//g' | sed 's/\b./\u&/g')

# Show scaffold suggestion
if [ "$FRAMEWORK" = "nextjs" ]; then
  echo -e "  ${BOLD}Suggested file structure (Next.js):${NC}"
  echo -e "  ${CYAN}app/[locale]/${TICKET_LOWER}/"
  echo -e "    ├── page.tsx              # Page component"
  echo -e "    ├── layout.tsx            # Optional layout"
  echo -e "    └── _components/          # Page-specific components"
  echo -e "  app/components/${COMPONENT_NAME}/"
  echo -e "    ├── ${COMPONENT_NAME}.tsx"
  echo -e "    ├── ${COMPONENT_NAME}.test.tsx"
  echo -e "    └── index.ts${NC}"
elif [ "$FRAMEWORK" = "vite" ]; then
  echo -e "  ${BOLD}Suggested file structure (Vite):${NC}"
  echo -e "  ${CYAN}src/pages/${TICKET_LOWER}/"
  echo -e "    ├── index.tsx             # Page component"
  echo -e "    └── components/           # Page-specific components"
  echo -e "  src/components/${COMPONENT_NAME}/"
  echo -e "    ├── ${COMPONENT_NAME}.tsx"
  echo -e "    ├── ${COMPONENT_NAME}.test.tsx"
  echo -e "    └── index.ts${NC}"
fi

echo ""
echo -e "  ${BOLD}Use Copilot to scaffold:${NC}"
echo -e "  Paste the ticket description in chat and use: /create ${TICKET_UPPER}"
echo ""
