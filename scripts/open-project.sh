#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  open-project.sh — Open Existing Project with GhostForge
#  Usage: bash open-project.sh [/path/to/project]
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(cat "$GHOSTFORGE_DIR/VERSION" 2>/dev/null || echo "2.0.0")"
NO_VSCODE=false

# ── Colors ───────────────────────────────────────────────────
BLUE='\033[0;34m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

divider() { echo -e "${DIM}──────────────────────────────────────────────────────${NC}"; }

header() {
  clear
  echo ""
  echo -e "${BLUE}${BOLD}  ╔═══════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}${BOLD}  ║   GhostForge  —  Open Project  v${VERSION}  ║${NC}"
  echo -e "${BLUE}${BOLD}  ╚═══════════════════════════════════════════╝${NC}"
  echo ""
}

# ── Detect project type ──────────────────────────────────────
detect_stack() {
  local dir="$1"
  local stack="Unknown"
  if [[ -f "$dir/package.json" ]]; then
    local pkg; pkg=$(cat "$dir/package.json")
    if echo "$pkg" | grep -q '"react-native"'; then
      if echo "$pkg" | grep -q '"expo"'; then
        stack="React Native + Expo"
      else
        stack="React Native (bare)"
      fi
    elif echo "$pkg" | grep -q '"next"'; then
      stack="Next.js"
    elif echo "$pkg" | grep -q '"react"'; then
      stack="React JS (Vite/CRA)"
    elif echo "$pkg" | grep -q '"@nestjs/core"'; then
      stack="NestJS (Backend)"
    elif echo "$pkg" | grep -q '"express"'; then
      stack="Node.js / Express"
    fi
    if echo "$pkg" | grep -q '"typescript"'; then stack="$stack + TypeScript"; fi
    if echo "$pkg" | grep -q '"tailwindcss"'; then stack="$stack + Tailwind"; fi
  elif [[ -f "$dir/*.csproj" ]] || ls "$dir"/*.sln 2>/dev/null | head -1 | grep -q "\.sln"; then
    stack=".NET / C#"
  elif [[ -f "$dir/requirements.txt" ]] || [[ -f "$dir/pyproject.toml" ]]; then
    stack="Python"
  fi
  echo "$stack"
}

# ── Get relevant commands for stack ─────────────────────────
stack_commands() {
  local stack="$1"
  echo ""
  echo -e "  ${CYAN}${BOLD}Useful commands for this project:${NC}"
  echo ""
  if echo "$stack" | grep -qi "react native\|expo"; then
    echo -e "  ${YELLOW}/test${NC}          — run Detox E2E + Jest unit tests"
    echo -e "  ${YELLOW}/security${NC}      — OWASP mobile security audit"
    echo -e "  ${YELLOW}/optimize${NC}      — bundle size + JS thread performance"
    echo -e "  ${YELLOW}/tickets${NC}       — view assigned bugs by priority"
    echo -e "  ${YELLOW}act as mobile developer${NC} — activate mobile AI agent"
  elif echo "$stack" | grep -qi "next"; then
    echo -e "  ${YELLOW}/test${NC}          — run Playwright + Jest tests"
    echo -e "  ${YELLOW}/security${NC}      — OWASP web + API audit"
    echo -e "  ${YELLOW}/optimize${NC}      — Core Web Vitals + bundle analysis"
    echo -e "  ${YELLOW}/deploy${NC}        — deploy to Vercel / Azure Static Web Apps"
    echo -e "  ${YELLOW}act as frontend developer${NC} — activate web AI agent"
  elif echo "$stack" | grep -qi "react js\|react.js\|vite\|cra"; then
    echo -e "  ${YELLOW}/test${NC}          — run Jest + React Testing Library"
    echo -e "  ${YELLOW}/security${NC}      — OWASP + dependency audit"
    echo -e "  ${YELLOW}/optimize${NC}      — bundle size + React profiling"
    echo -e "  ${YELLOW}/tickets${NC}       — view assigned bugs by priority"
    echo -e "  ${YELLOW}act as frontend developer${NC} — activate web AI agent"
  elif echo "$stack" | grep -qi "nestjs\|node\|express"; then
    echo -e "  ${YELLOW}/test${NC}          — run Jest + Supertest API tests"
    echo -e "  ${YELLOW}/security${NC}      — API security + injection audit"
    echo -e "  ${YELLOW}/sql${NC}           — generate or optimize DB queries"
    echo -e "  ${YELLOW}/deploy${NC}        — deploy to Azure App Service / AKS"
    echo -e "  ${YELLOW}act as backend developer${NC} — activate backend AI agent"
  else
    echo -e "  ${YELLOW}/optimize${NC}      — review and improve code quality"
    echo -e "  ${YELLOW}/security${NC}      — security audit"
    echo -e "  ${YELLOW}/test${NC}          — run tests"
    echo -e "  ${YELLOW}/tickets${NC}       — view assigned bugs"
  fi
}

# ── Check if toolkit already applied ────────────────────────
toolkit_status() {
  local dir="$1"
  local has_copilot=false; local has_vscode=false; local has_agents=false
  [[ -f "$dir/.github/copilot-instructions.md" ]] && has_copilot=true
  [[ -f "$dir/.vscode/settings.json" ]] && has_vscode=true
  [[ -d "$dir/ghostforge-agents" ]] && has_agents=true

  echo -e "  ${BOLD}Current toolkit status:${NC}"
  $has_copilot && echo -e "  ${GREEN}✔${NC} .github/copilot-instructions.md" \
               || echo -e "  ${RED}✖${NC} .github/copilot-instructions.md (missing)"
  $has_vscode  && echo -e "  ${GREEN}✔${NC} .vscode/settings.json" \
               || echo -e "  ${RED}✖${NC} .vscode/settings.json (missing)"
  $has_agents  && echo -e "  ${GREEN}✔${NC} ghostforge-agents/ folder" \
               || echo -e "  ${RED}✖${NC} ghostforge-agents/ folder (missing)"

  $has_copilot && $has_vscode && $has_agents && echo "full" || echo "partial"
}

# ── Copy files to project ────────────────────────────────────
copy_toolkit() {
  local target="$1"

  echo ""
  echo -e "  ${BLUE}Copying toolkit files...${NC}"
  echo ""

  mkdir -p "$target/.github/workflows" "$target/.vscode" "$target/ghostforge-agents"

  cp "$GHOSTFORGE_DIR/.github/copilot-instructions.md" "$target/.github/"
  echo -e "  ${GREEN}✔${NC} .github/copilot-instructions.md"

  cp "$GHOSTFORGE_DIR/.github/copilot-setup-steps.yml" "$target/.github/" 2>/dev/null || true
  cp "$GHOSTFORGE_DIR/.github/workflows/"*.yml "$target/.github/workflows/" 2>/dev/null || true
  echo -e "  ${GREEN}✔${NC} .github/workflows/ (pr-review, deploy-azure, qa-pipeline)"

  cp "$GHOSTFORGE_DIR/.vscode/settings.json"   "$target/.vscode/"
  cp "$GHOSTFORGE_DIR/.vscode/extensions.json" "$target/.vscode/"
  echo -e "  ${GREEN}✔${NC} .vscode/ (Copilot auto-read settings + extensions)"

  cp -r "$GHOSTFORGE_DIR/agents"       "$target/ghostforge-agents/"
  cp -r "$GHOSTFORGE_DIR/commands"     "$target/ghostforge-agents/"
  cp -r "$GHOSTFORGE_DIR/instructions" "$target/ghostforge-agents/"
  cp -r "$GHOSTFORGE_DIR/prompts"      "$target/ghostforge-agents/"
  cp -r "$GHOSTFORGE_DIR/snippets"     "$target/ghostforge-agents/"
  cp "$GHOSTFORGE_DIR/ghostforge-config.schema.json" "$target/"
  echo -e "  ${GREEN}✔${NC} ghostforge-agents/ (14 agents · 33 commands · 20 instructions · 7 prompts · snippets)"
  echo -e "  ${GREEN}✔${NC} ghostforge-config.schema.json"

  # Write toolkit version stamp into project
  echo "$VERSION" > "$target/ghostforge-agents/.version"
  echo -e "  ${GREEN}✔${NC} ghostforge-agents/.version (v${VERSION})"
}

# ════════════════════════════════════════════════════════════
#  MAIN
# ════════════════════════════════════════════════════════════
header

# ── Get project path ─────────────────────────────────────────
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --no-vscode) NO_VSCODE=true ;;
    *) [[ -z "$TARGET" ]] && TARGET="$arg" ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo -e "  ${BOLD}Open which project?${NC}"
  echo -e "  ${DIM}(leave blank to use current directory: $(pwd))${NC}"
  echo ""
  read -rp "  Project path: " TARGET
  TARGET="${TARGET:-$(pwd)}"
fi

# Expand ~ and resolve path
TARGET="${TARGET/#\~/$HOME}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || {
  echo -e "${RED}  ✖  Path not found: $TARGET${NC}"
  exit 1
}

echo -e "  Project : ${YELLOW}${BOLD}$TARGET${NC}"
echo ""
divider

# ── Detect stack ─────────────────────────────────────────────
STACK=$(detect_stack "$TARGET")
echo -e "  Detected stack : ${CYAN}${BOLD}$STACK${NC}"
echo ""

# ── Check existing toolkit ───────────────────────────────────
STATUS=$(toolkit_status "$TARGET")
echo ""
divider

# ── Ask about overwrite if already present ───────────────────
if echo "$STATUS" | grep -q "full"; then
  echo ""
  echo -e "  ${YELLOW}⚠  This project already has the full GhostForge toolkit (v$(cat "$TARGET/ghostforge-agents/.version" 2>/dev/null || echo "?")).${NC}"
  echo ""
  echo -e "  What would you like to do?"
  echo -e "  ${BOLD}1)${NC} Update / overwrite with latest (v${VERSION})"
  echo -e "  ${BOLD}2)${NC} Skip copy — just open in VS Code"
  echo -e "  ${BOLD}3)${NC} Cancel"
  echo ""
  read -rp "  Choice [1/2/3]: " choice
  case "$choice" in
    1) copy_toolkit "$TARGET" ;;
    2) echo -e "  ${CYAN}Skipping copy.${NC}" ;;
    3) echo -e "  Cancelled."; exit 0 ;;
    *) echo -e "  ${YELLOW}Invalid — skipping copy.${NC}" ;;
  esac
else
  echo ""
  echo -e "  ${BOLD}Copy GhostForge to this project?${NC} (y/n)"
  read -rp "  > " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    copy_toolkit "$TARGET"
  else
    echo -e "  ${YELLOW}Skipped copy.${NC}"
  fi
fi

divider

# ── Show relevant commands ───────────────────────────────────
stack_commands "$STACK"

echo ""
divider

# ── Open in VS Code ──────────────────────────────────────────
echo ""
if command -v code &>/dev/null; then
  if $NO_VSCODE; then
    echo -e "  ${CYAN}Skipping VS Code launch (--no-vscode).${NC}"
    echo ""
    echo -e "  ${GREEN}${BOLD}All done!${NC} Copilot is ready. Try: ${YELLOW}/optimize${NC}, ${YELLOW}/security${NC}, ${YELLOW}/tickets${NC}"
    echo ""
    exit 0
  fi
  echo -e "  ${BOLD}Open in VS Code?${NC} (y/n)"
  read -rp "  > " open_vscode
  if [[ "$open_vscode" =~ ^[Yy]$ ]]; then
    code "$TARGET"
    echo ""
    echo -e "  ${GREEN}${BOLD}✅ Opened in VS Code!${NC}"
    echo -e "  ${DIM}Copilot Chat (Cmd+Shift+I) is now powered by GhostForge v${VERSION}${NC}"
  fi
else
  echo -e "  ${YELLOW}VS Code CLI not found.${NC} Open manually: code $TARGET"
fi

echo ""
echo -e "  ${GREEN}${BOLD}All done!${NC} Copilot is ready. Try: ${YELLOW}/optimize${NC}, ${YELLOW}/security${NC}, ${YELLOW}/tickets${NC}"
echo ""
