#!/usr/bin/env bash
set -euo pipefail
GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

MODE="interactive"
for arg in "$@"; do
  case "$arg" in
    --safe) MODE="safe" ;;
    --security) MODE="security" ;;
    --all) MODE="all" ;;
    --patch) MODE="patch" ;;
  esac
done

echo ""
echo -e "${BLUE}${BOLD}  ╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   /upgrade — Dependency Upgrade Assistant  ║${NC}"
echo -e "${BLUE}${BOLD}  ╚════════════════════════════════════════════╝${NC}"
echo ""

[[ ! -f "package.json" ]] && { echo -e "  ${RED}✖  No package.json found.${NC}"; exit 1; }

PKG_MGR="npm"
[[ -f "bun.lockb" || -f "bun.lock" ]] && PKG_MGR="bun"
[[ -f "pnpm-lock.yaml" ]] && PKG_MGR="pnpm"
[[ -f "yarn.lock" ]] && PKG_MGR="yarn"

echo -e "  ${DIM}Package manager: $PKG_MGR | Mode: $MODE${NC}"
echo ""

if ! command -v ncu &>/dev/null; then
  echo -e "  ${DIM}Installing npm-check-updates...${NC}"
  npm install -g npm-check-updates --silent 2>/dev/null || true
fi

case "$MODE" in
  security)
    echo -e "  ${BLUE}Running security-only upgrade...${NC}"
    echo ""
    npm audit fix 2>&1 | tail -5
    echo ""
    echo -e "  ${GREEN}✅ Security vulnerabilities fixed.${NC}"
    echo -e "  ${DIM}  Run: npm audit to verify${NC}"
    ;;
  safe|patch)
    echo -e "  ${BLUE}Upgrading patch + minor versions only (safe)...${NC}"
    echo ""
    ncu --upgrade --target minor 2>/dev/null || ncu -u --target minor || ncu -u --semverLevel minor
    echo ""
    case "$PKG_MGR" in
      bun) bun install ;;
      pnpm) pnpm install ;;
      yarn) yarn install ;;
      *) npm install ;;
    esac
    echo -e "  ${GREEN}✅ Safe upgrades applied.${NC}"
    ;;
  all)
    echo -e "  ${YELLOW}⚠  Upgrading ALL deps to latest (may include breaking changes)...${NC}"
    echo ""
    ncu --upgrade 2>/dev/null || ncu -u
    case "$PKG_MGR" in
      bun) bun install ;;
      pnpm) pnpm install ;;
      yarn) yarn install ;;
      *) npm install ;;
    esac
    echo -e "  ${GREEN}✅ All deps upgraded.${NC}"
    ;;
  *)
    echo -e "  ${BLUE}Checking for outdated packages...${NC}"
    echo ""
    ncu 2>/dev/null || npm outdated || true
    echo ""
    echo -e "  ${BOLD}Choose upgrade strategy:${NC}"
    echo -e "  ${BOLD}1)${NC} Patch only   (safest — bug fixes)"
    echo -e "  ${BOLD}2)${NC} Minor + patch (safe — new features, no breaking changes)"
    echo -e "  ${BOLD}3)${NC} All latest   (risky — may include breaking changes)"
    echo -e "  ${BOLD}4)${NC} Security only (npm audit fix)"
    echo -e "  ${BOLD}5)${NC} Cancel"
    echo ""
    read -rp "  Choice [1-5]: " choice
    case "$choice" in
      1) bash "$0" --patch ;;
      2) bash "$0" --safe ;;
      3) bash "$0" --all ;;
      4) bash "$0" --security ;;
      5) echo -e "  ${DIM}Cancelled.${NC}" ;;
      *) echo -e "  ${YELLOW}Invalid choice.${NC}" ;;
    esac
    ;;
esac
echo ""
