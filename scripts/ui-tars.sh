#!/usr/bin/env bash
# GhostForge — UI-TARS Integration
# ByteDance vision-language GUI automation agent
set -euo pipefail

RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m'
NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

print_header() {
  echo -e "${CYAN}${BOLD}"
  echo "  👁️   GhostForge — UI-TARS"
  echo "  ByteDance GUI Automation Agent"
  echo "  Sees your screen. Clicks. Types. Automates."
  echo -e "${NC}"
}

info_cmd() {
  print_header
  cat <<'EOF'
UI-TARS is a vision-language model (VLM) by ByteDance that can:
  • See screenshots of any UI (web, desktop, mobile)
  • Understand natural language instructions
  • Click, type, scroll, and navigate autonomously
  • Perform complex multi-step GUI tasks

Latest: UI-TARS-2 (Sep 2025) — GUI + Game + Code + Tool Use

Models available (HuggingFace):
  ByteDance-Seed/UI-TARS-1.5-7B    7B params, local GPU (8GB VRAM min)
  Via API: seed-tars.com

Two ways to use:
  1. UI-TARS-desktop  — local Electron app (easiest)
  2. UI-TARS API/model — programmatic, integrate with your code

Use cases for developers:
  • Automated E2E testing (visual, not selector-based)
  • Screenshot-based debugging
  • Form filling automation
  • UI regression testing
  • Complement Playwright with visual understanding

EOF
  echo -e "${CYAN}Links:${NC}"
  echo "  Model:   https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B"
  echo "  Paper:   https://arxiv.org/abs/2501.12326"
  echo "  Desktop: https://github.com/bytedance/UI-TARS-desktop"
  echo "  Website: https://seed-tars.com"
}

desktop_cmd() {
  print_header
  echo -e "${CYAN}UI-TARS Desktop — Local GUI Automation App${NC}\n"
  echo "UI-TARS-desktop is an Electron app that runs UI-TARS locally."
  echo "It automates your desktop via natural language."
  echo ""
  echo -e "${CYAN}Install options:${NC}"
  echo "  macOS: Download .dmg from GitHub Releases"
  echo "  https://github.com/bytedance/UI-TARS-desktop/releases"
  echo ""
  echo -e "${CYAN}Requirements:${NC}"
  echo "  • macOS 12+ / Windows 10+ / Linux"
  echo "  • API key: OpenAI, Anthropic, or local model"
  echo "  • OR run UI-TARS model locally (needs 8GB+ VRAM GPU)"
  echo ""

  if [[ "$OSTYPE" == "darwin"* ]]; then
    read -r -p "Open GitHub Releases page? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] && open "https://github.com/bytedance/UI-TARS-desktop/releases"
  fi
}

model_cmd() {
  print_header
  echo -e "${CYAN}UI-TARS Model Setup (HuggingFace)${NC}\n"
  echo "Model: ByteDance-Seed/UI-TARS-1.5-7B"
  echo ""
  echo -e "${CYAN}Option 1 — Use via API (no GPU needed):${NC}"
  echo "  Website: https://seed-tars.com"
  echo "  OR via OpenRouter if available"
  echo ""
  echo -e "${CYAN}Option 2 — Run locally (needs GPU):${NC}"
  echo "  Requirements: Python 3.10+, 8GB+ VRAM, ~15GB disk"
  echo ""
  echo "  pip install transformers torch accelerate"
  echo "  # Then use the inference code from:"
  echo "  # https://github.com/bytedance/UI-TARS/tree/main/codes"
  echo ""
  echo -e "${CYAN}Option 3 — Use with Midscene (browser automation):${NC}"
  echo "  npm install @midscene/web"
  echo "  https://github.com/web-infra-dev/Midscene"
  echo ""
  echo -e "${DIM}  Tip: Midscene + UI-TARS is the easiest path for web automation${NC}"
}

midscene_cmd() {
  print_header
  echo -e "${CYAN}Midscene — Browser Automation with UI-TARS${NC}\n"
  echo "Midscene.js uses UI-TARS for visual browser automation."
  echo "Works with Playwright, Puppeteer, or standalone."
  echo ""
  echo -e "${CYAN}Install:${NC}"
  echo "  npm install @midscene/web"
  echo ""
  echo -e "${CYAN}Example with Playwright:${NC}"
  cat <<'EXAMPLE'
  import { PlaywrightAiFixture } from '@midscene/web/playwright';
  import { test } from '@playwright/test';

  test.use({ ...PlaywrightAiFixture() });

  test('AI-driven test', async ({ ai, page }) => {
    await page.goto('https://example.com');
    await ai('Click the login button');
    await ai('Enter username: hisham, password: pass123');
    await ai('Assert that the dashboard is visible');
  });
EXAMPLE
  echo ""
  echo "  Docs: https://midscenejs.com"
  echo "  GitHub: https://github.com/web-infra-dev/Midscene"

  if command -v npm &>/dev/null; then
    read -r -p "Install @midscene/web now? [y/N] " reply
    if [[ "$reply" =~ ^[Yy]$ ]]; then
      npm install @midscene/web
      echo -e "${GREEN}✅ Midscene installed${NC}"
    fi
  fi
}

open_cmd() {
  case "${1:-}" in
    model)   open "https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B" 2>/dev/null || xdg-open "https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B" 2>/dev/null ;;
    desktop) open "https://github.com/bytedance/UI-TARS-desktop/releases" 2>/dev/null || xdg-open "https://github.com/bytedance/UI-TARS-desktop/releases" 2>/dev/null ;;
    paper)   open "https://arxiv.org/abs/2501.12326" 2>/dev/null || xdg-open "https://arxiv.org/abs/2501.12326" 2>/dev/null ;;
    site)    open "https://seed-tars.com" 2>/dev/null || xdg-open "https://seed-tars.com" 2>/dev/null ;;
    midscene) open "https://midscenejs.com" 2>/dev/null || xdg-open "https://midscenejs.com" 2>/dev/null ;;
    *) echo "Usage: ghostforge ui-tars open <model|desktop|paper|site|midscene>" ;;
  esac
}

help_cmd() {
  print_header
  cat <<'EOF'
Usage:
  ghostforge ui-tars <command>
  bash scripts/ui-tars.sh <command>

Commands:
  info          Overview of UI-TARS capabilities and use cases
  desktop       UI-TARS Desktop app — install guide
  model         Run UI-TARS model locally or via API
  midscene      Browser automation with Midscene.js + UI-TARS
  open <target> Open links: model | desktop | paper | site | midscene
  help          Show this help

Examples:
  ghostforge ui-tars info
  ghostforge ui-tars desktop       # download desktop app
  ghostforge ui-tars midscene      # browser automation setup
  ghostforge ui-tars open paper    # read the research paper
EOF
}

ACTION="${1:-help}"
shift 2>/dev/null || true
case "$ACTION" in
  info)     info_cmd ;;
  desktop)  desktop_cmd ;;
  model)    model_cmd ;;
  midscene) midscene_cmd ;;
  open)     open_cmd "$@" ;;
  help|--help|-h) help_cmd ;;
  *) echo -e "${RED}Unknown: $ACTION${NC}"; help_cmd ;;
esac
