#!/usr/bin/env bash
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; CYAN='\033[0;36m'; NC='\033[0m'

ACTION="${1:-menu}"

divider() { echo -e "${DIM}══════════════════════════════════════════════════════${NC}"; }
open_url() { open "$1" 2>/dev/null || xdg-open "$1" 2>/dev/null || echo -e "  ${CYAN}Open: $1${NC}"; }

echo ""
echo -e "${BLUE}${BOLD}  ╔═══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   /skills — Claude Agent Skills Manager       ║${NC}"
echo -e "${BLUE}${BOLD}  ╚═══════════════════════════════════════════════╝${NC}"
echo ""

# ── List installed skills ─────────────────────────────────────────────────────
if [[ "$ACTION" == "list" ]]; then
  echo -e "  ${BOLD}Installed skills:${NC}"
  echo ""
  FOUND=false

  for dir in ~/.claude/skills ~/.copilot/skills .claude/skills .copilot/skills; do
    dir="${dir/#\~/$HOME}"
    if [[ -d "$dir" ]]; then
      while IFS= read -r skill_dir; do
        skill_name="$(basename "$skill_dir")"
        skill_md="$skill_dir/SKILL.md"
        desc=""
        if [[ -f "$skill_md" ]]; then
          desc="$(grep -m1 '^description:' "$skill_md" 2>/dev/null | sed 's/^description: *//' || true)"
          [[ -z "$desc" ]] && desc="$(head -5 "$skill_md" | grep -v '^---' | grep -v '^name' | head -1 | sed 's/^#* *//' || true)"
        fi
        echo -e "  ${GREEN}●${NC} ${BOLD}$skill_name${NC} ${DIM}($dir)${NC}"
        [[ -n "$desc" ]] && echo -e "    ${DIM}$desc${NC}"
        FOUND=true
      done < <(find "$dir" -mindepth 1 -maxdepth 1 -type d 2>/dev/null || true)
    fi
  done

  if ! $FOUND; then
    echo -e "  ${YELLOW}No skills installed yet.${NC}"
    echo -e "  ${DIM}Install location: ~/.claude/skills/<name>/SKILL.md${NC}"
  fi
  echo ""
  exit 0
fi

# ── Sources overview ──────────────────────────────────────────────────────────
if [[ "$ACTION" == "menu" || "$ACTION" == "sources" ]]; then
  divider
  echo -e "  ${BOLD}Trusted Skill Sources:${NC}"
  echo ""
  echo -e "  ${CYAN}1.${NC} ${BOLD}Anthropic Official Skills${NC}"
  echo -e "     ${DIM}docx, pdf, pptx, xlsx, web-test, MCP gen — by Anthropic${NC}"
  echo -e "     ${DIM}Install: /plugin marketplace add anthropics/skills (in Claude Code)${NC}"
  echo -e "     ${DIM}URL: https://github.com/anthropics/skills${NC}"
  echo ""
  echo -e "  ${CYAN}2.${NC} ${BOLD}SkillsMP — 2M+ Community Skills${NC}"
  echo -e "     ${DIM}Largest marketplace: React, TypeScript, Python, 12 domains${NC}"
  echo -e "     ${DIM}Free REST API + MCP server at https://skillsmp.com${NC}"
  echo -e "     ${DIM}API: curl 'https://skillsmp.com/api/search?q=react'${NC}"
  echo ""
  echo -e "  ${CYAN}3.${NC} ${BOLD}Awesome Claude Skills Directory${NC}"
  echo -e "     ${DIM}Curated free skills — SKILL.md files, open-source${NC}"
  echo -e "     ${DIM}URL: https://awesomeclaude.ai/awesome-claude-skills${NC}"
  echo ""
  echo -e "  ${CYAN}4.${NC} ${BOLD}Claude Skills Collection 2026 (Community)${NC}"
  echo -e "     ${DIM}Curated: official + community skills index${NC}"
  echo -e "     ${DIM}URL: https://github.com/obviousworks/Claude-AI-skills-collection-2026${NC}"
  echo ""
  echo -e "  ${CYAN}5.${NC} ${BOLD}Agent Skills Standard (agentskills.io)${NC}"
  echo -e "     ${DIM}The spec — works with Claude, Junie, Gemini CLI, ZeroClaw${NC}"
  echo -e "     ${DIM}URL: https://agentskills.io/home${NC}"
  echo ""
  echo -e "  ${CYAN}6.${NC} ${BOLD}Claude-Flow — AI Orchestration${NC}"
  echo -e "     ${DIM}Hive-mind swarm, 87 MCP tools, 84.8% SWE-Bench, 2.8-4.4x speed${NC}"
  echo -e "     ${DIM}Quick start: npx claude-flow@alpha swarm 'your task'${NC}"
  echo -e "     ${DIM}URL: https://github.com/edwincummins/claude-flow${NC}"
  echo ""
  divider
fi

# ── Install actions ───────────────────────────────────────────────────────────
case "$ACTION" in
  anthropic|anthropics)
    echo -e "  ${BLUE}Installing Anthropic official skills via Claude Code...${NC}"
    echo ""
    if command -v claude &>/dev/null; then
      echo -e "  ${DIM}Running: /plugin marketplace add anthropics/skills${NC}"
      echo ""
      echo -e "  ${YELLOW}Note: This must be run inside Claude Code, not the terminal.${NC}"
      echo -e "  ${CYAN}In Claude Code, type:${NC}"
      echo -e "  ${BOLD}  /plugin marketplace add anthropics/skills${NC}"
    else
      echo -e "  ${YELLOW}Claude Code not found. Install it first:${NC}"
      echo -e "  ${BOLD}  npm install -g @anthropic-ai/claude-code${NC}"
    fi
    echo ""
    echo -e "  ${DIM}Or manually clone and copy:${NC}"
    echo -e "  ${DIM}  git clone https://github.com/anthropics/skills /tmp/anthropics-skills${NC}"
    echo -e "  ${DIM}  mkdir -p ~/.claude/skills${NC}"
    echo -e "  ${DIM}  cp -r /tmp/anthropics-skills/skills/* ~/.claude/skills/${NC}"
    ;;

  claude-flow|claudeflow)
    echo -e "  ${BLUE}Setting up Claude-Flow...${NC}"
    echo ""
    if ! command -v npm &>/dev/null; then
      echo -e "  ${RED}✖  npm not found. Install Node.js 18+ first.${NC}"; exit 1
    fi
    echo -e "  ${DIM}Step 1: Ensure Claude Code is installed${NC}"
    if ! command -v claude &>/dev/null; then
      echo -e "  ${YELLOW}Installing Claude Code...${NC}"
      npm install -g @anthropic-ai/claude-code
    else
      echo -e "  ${GREEN}✔${NC} Claude Code already installed"
    fi
    echo ""
    echo -e "  ${DIM}Step 2: Initialize Claude Flow${NC}"
    npx claude-flow@alpha init --force
    echo ""
    echo -e "  ${GREEN}✅ Claude-Flow ready!${NC}"
    echo ""
    echo -e "  ${BOLD}Quick commands:${NC}"
    echo -e "  ${DIM}  npx claude-flow@alpha swarm 'your task'     # Quick task${NC}"
    echo -e "  ${DIM}  npx claude-flow@alpha hive-mind wizard      # Complex project${NC}"
    echo -e "  ${DIM}  npx claude-flow@alpha --help                # All options${NC}"
    ;;

  search)
    QUERY="${2:-}"
    if [[ -z "$QUERY" ]]; then
      echo -e "  Usage: bash scripts/skills.sh search <query>"
      echo -e "  Example: bash scripts/skills.sh search react"
      exit 1
    fi
    echo -e "  ${BLUE}Searching SkillsMP for: ${BOLD}$QUERY${NC}"
    echo ""
    if command -v curl &>/dev/null; then
      RESULT=$(curl -s --max-time 8 "https://skillsmp.com/api/search?q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))" 2>/dev/null || echo "$QUERY")" 2>/dev/null || true)
      if [[ -n "$RESULT" ]]; then
        echo "$RESULT" | python3 -c "
import json,sys
try:
  data=json.load(sys.stdin)
  items=data.get('results',data.get('skills',data.get('items',[])))[:10]
  for i in items:
    name=i.get('name',i.get('id','?'))
    desc=i.get('description','')[:70]
    url=i.get('url',i.get('source_url',''))
    print(f'  \033[0;36m●\033[0m \033[1m{name}\033[0m')
    if desc: print(f'    \033[2m{desc}\033[0m')
    if url: print(f'    \033[2m{url}\033[0m')
    print()
except:
  print('  \033[1;33mCould not parse results. Visit: https://skillsmp.com/search\033[0m')
" 2>/dev/null || echo -e "  ${YELLOW}Search failed. Visit: https://skillsmp.com/search${NC}"
      else
        echo -e "  ${YELLOW}No results. Visit: https://skillsmp.com/search?q=$QUERY${NC}"
      fi
    else
      echo -e "  ${YELLOW}curl not available. Visit: https://skillsmp.com/search?q=$QUERY${NC}"
    fi
    ;;

  open|browse)
    SOURCE="${2:-all}"
    case "$SOURCE" in
      anthropic|anthropics) open_url "https://github.com/anthropics/skills" ;;
      skillsmp)             open_url "https://skillsmp.com" ;;
      awesome)              open_url "https://awesomeclaude.ai/awesome-claude-skills" ;;
      collection|2026)      open_url "https://github.com/obviousworks/Claude-AI-skills-collection-2026" ;;
      agentskills|standard) open_url "https://agentskills.io/home" ;;
      claude-flow|flow)     open_url "https://github.com/edwincummins/claude-flow" ;;
      *)
        echo -e "  ${BOLD}Opening all skill sources in browser...${NC}"
        open_url "https://skillsmp.com"
        open_url "https://awesomeclaude.ai/awesome-claude-skills"
        open_url "https://github.com/anthropics/skills"
        ;;
    esac
    ;;

  add)
    SKILL_URL="${2:-}"
    SKILL_NAME="${3:-custom-skill}"
    if [[ -z "$SKILL_URL" ]]; then
      echo -e "  Usage: bash scripts/skills.sh add <url-or-path> [skill-name]"
      exit 1
    fi
    INSTALL_DIR="$HOME/.claude/skills/$SKILL_NAME"
    mkdir -p "$INSTALL_DIR"
    if [[ -f "$SKILL_URL" ]]; then
      cp "$SKILL_URL" "$INSTALL_DIR/SKILL.md"
      echo -e "  ${GREEN}✅ Skill installed: $INSTALL_DIR/SKILL.md${NC}"
    elif [[ "$SKILL_URL" =~ ^https?:// ]]; then
      curl -sL "$SKILL_URL" -o "$INSTALL_DIR/SKILL.md" \
        && echo -e "  ${GREEN}✅ Skill downloaded: $INSTALL_DIR/SKILL.md${NC}" \
        || echo -e "  ${RED}✖  Failed to download skill${NC}"
    fi
    ;;
esac

echo -e "  ${DIM}Run: bash scripts/skills.sh list  — to see installed skills${NC}"
echo ""
