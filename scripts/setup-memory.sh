#!/usr/bin/env bash
set -euo pipefail
GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; CYAN='\033[0;36m'; NC='\033[0m'

ACTION="${1:-install}"

echo ""
echo -e "${BLUE}${BOLD}  ╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   claude-mem — Persistent Shared Memory          ║${NC}"
echo -e "${BLUE}${BOLD}  ╚══════════════════════════════════════════════════╝${NC}"
echo ""

case "$ACTION" in
  install|setup)
    echo -e "  ${BOLD}Installing claude-mem persistent memory...${NC}"
    echo -e "  ${DIM}Preserves context across Claude Code sessions automatically.${NC}"
    echo ""

    if ! command -v node &>/dev/null; then
      echo -e "  ${RED}✖  Node.js not found. Install Node.js 20+ first.${NC}"
      exit 1
    fi

    echo -e "  ${DIM}Running: npx claude-mem install${NC}"
    npx claude-mem install 2>&1 || {
      echo ""
      echo -e "  ${YELLOW}⚠  Auto-install failed. Try manually inside Claude Code:${NC}"
      echo -e "  ${CYAN}  /plugin marketplace add thedotmack/claude-mem${NC}"
      echo -e "  ${CYAN}  /plugin install claude-mem${NC}"
      exit 1
    }

    echo ""
    echo -e "  ${GREEN}${BOLD}✅ claude-mem installed!${NC}"
    echo ""
    echo -e "  ${BOLD}What happens next:${NC}"
    echo -e "  ${DIM}  • Restart Claude Code${NC}"
    echo -e "  ${DIM}  • Context from previous sessions auto-appears in new sessions${NC}"
    echo -e "  ${DIM}  • Memory streams at: http://localhost:3000 (when active)${NC}"
    echo -e "  ${DIM}  • Use <private> tags to exclude sensitive content from storage${NC}"
    echo ""
    echo -e "  ${BOLD}Also installs skills.sh find-skills + frontend-design:${NC}"
    if command -v npx &>/dev/null; then
      echo -e "  ${DIM}  Installing find-skills...${NC}"
      npx skills add vercel-labs/skills@find-skills -g -y 2>/dev/null && \
        echo -e "  ${GREEN}  ✔ find-skills installed globally${NC}" || \
        echo -e "  ${YELLOW}  ⚠ find-skills: already installed or skipped${NC}"

      echo -e "  ${DIM}  Installing frontend-design...${NC}"
      npx skills add anthropics/skills@frontend-design -g -y 2>/dev/null && \
        echo -e "  ${GREEN}  ✔ frontend-design installed globally${NC}" || \
        echo -e "  ${YELLOW}  ⚠ frontend-design: already installed or skipped${NC}"
    fi
    ;;

  status)
    echo -e "  ${BOLD}Memory status:${NC}"
    echo ""
    if npx claude-mem status 2>/dev/null; then
      :
    else
      echo -e "  ${YELLOW}  claude-mem not installed. Run: bash scripts/setup-memory.sh install${NC}"
    fi
    echo ""
    echo -e "  ${BOLD}Installed skills:${NC}"
    SKILLS_GLOBAL="$HOME/.claude/skills"
    SKILLS_LOCAL="$GHOSTFORGE_DIR/.claude/skills"
    echo -e "  ${DIM}Global (~/.claude/skills/):${NC}"
    if [[ -d "$SKILLS_GLOBAL" ]]; then
      ls "$SKILLS_GLOBAL" 2>/dev/null | while read -r s; do echo -e "    ${GREEN}●${NC} $s"; done
    else
      echo -e "    ${DIM}none${NC}"
    fi
    echo -e "  ${DIM}Project (.claude/skills/):${NC}"
    if [[ -d "$SKILLS_LOCAL" ]]; then
      ls "$SKILLS_LOCAL" 2>/dev/null | while read -r s; do echo -e "    ${GREEN}●${NC} $s"; done
    else
      echo -e "    ${DIM}none${NC}"
    fi
    ;;

  search)
    QUERY="${2:-}"
    if [[ -z "$QUERY" ]]; then
      echo -e "  ${DIM}Usage: bash scripts/setup-memory.sh search <query>${NC}"
      echo -e "  ${DIM}Example: bash scripts/setup-memory.sh search react performance${NC}"
    else
      echo -e "  ${DIM}Searching skills for: $QUERY${NC}"
      npx skills find "$QUERY" 2>/dev/null || echo -e "  ${YELLOW}skills CLI not found. Run: npx skills find $QUERY${NC}"
    fi
    ;;

  uninstall)
    echo -e "  ${YELLOW}Uninstalling claude-mem...${NC}"
    npx claude-mem uninstall 2>/dev/null || echo -e "  ${YELLOW}Run manually: /plugin uninstall claude-mem in Claude Code${NC}"
    ;;

  help|*)
    echo -e "  ${BOLD}Usage:${NC}"
    echo -e "  ${CYAN}bash scripts/setup-memory.sh install${NC}   ${DIM}# Install claude-mem + find-skills + frontend-design${NC}"
    echo -e "  ${CYAN}bash scripts/setup-memory.sh status${NC}    ${DIM}# Show memory + installed skills status${NC}"
    echo -e "  ${CYAN}bash scripts/setup-memory.sh search react${NC} ${DIM}# Search skills ecosystem${NC}"
    echo -e "  ${CYAN}bash scripts/setup-memory.sh uninstall${NC} ${DIM}# Remove claude-mem${NC}"
    echo ""
    echo -e "  ${BOLD}claude-mem features:${NC}"
    echo -e "  ${DIM}  • Persistent memory across Claude Code sessions${NC}"
    echo -e "  ${DIM}  • Auto-captures tool usage, summaries, observations${NC}"
    echo -e "  ${DIM}  • Web viewer UI at localhost:3000${NC}"
    echo -e "  ${DIM}  • Natural language memory search (mem-search skill)${NC}"
    echo -e "  ${DIM}  • <private> tags for sensitive content exclusion${NC}"
    echo -e "  ${DIM}  • Works with Claude Code, OpenCode, Antigravity CLI${NC}"
    echo ""
    echo -e "  ${BOLD}Manual install (inside Claude Code):${NC}"
    echo -e "  ${CYAN}  /plugin marketplace add thedotmack/claude-mem${NC}"
    echo -e "  ${CYAN}  /plugin install claude-mem${NC}"
    ;;
esac
echo ""
