#!/usr/bin/env bash
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

TARGET="$(pwd)"
MINIMAL=false
REMOVE=false
PKG_MGR="npm"

for arg in "$@"; do
  case "$arg" in
    --minimal) MINIMAL=true ;;
    --remove) REMOVE=true ;;
    --bun) PKG_MGR="bun" ;;
    --pnpm) PKG_MGR="pnpm" ;;
    --yarn) PKG_MGR="yarn" ;;
    *) TARGET="$arg" ;;
  esac
done
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)"

echo ""
echo -e "${BLUE}${BOLD}  ╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   /git-hooks — Husky + lint-staged Setup     ║${NC}"
echo -e "${BLUE}${BOLD}  ╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${DIM}Project: $TARGET${NC}"

cd "$TARGET"

if [[ ! -f "package.json" ]]; then
  echo -e "  ${RED}✖  No package.json found. Run from a Node.js project root.${NC}"
  exit 1
fi

if ! git rev-parse --git-dir &>/dev/null; then
  echo -e "  ${RED}✖  Not a git repository. Run: git init${NC}"
  exit 1
fi

# Auto-detect package manager
if [[ -f "bun.lockb" || -f "bun.lock" ]]; then PKG_MGR="bun"
elif [[ -f "pnpm-lock.yaml" ]]; then PKG_MGR="pnpm"
elif [[ -f "yarn.lock" ]]; then PKG_MGR="yarn"
fi

echo -e "  ${DIM}Package manager: $PKG_MGR${NC}"
echo ""

# Remove mode
if $REMOVE; then
  echo -e "  ${YELLOW}Removing Husky and hooks...${NC}"
  rm -rf .husky
  # Remove husky from package.json prepare script
  if command -v node &>/dev/null; then
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
      if (pkg.scripts?.prepare === 'husky') delete pkg.scripts.prepare;
      if (pkg.scripts?.prepare === 'husky install') delete pkg.scripts.prepare;
      fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    " 2>/dev/null || true
  fi
  echo -e "  ${GREEN}✅ Hooks removed.${NC}"
  exit 0
fi

# Install packages
PKGS="husky lint-staged"
$MINIMAL || PKGS="$PKGS @commitlint/cli @commitlint/config-conventional"

echo -e "  ${BLUE}Installing: $PKGS${NC}"
echo ""
case "$PKG_MGR" in
  bun)  bun add --dev $PKGS ;;
  pnpm) pnpm add --save-dev $PKGS ;;
  yarn) yarn add --dev $PKGS ;;
  *)    npm install --save-dev $PKGS ;;
esac

# Init husky
echo ""
echo -e "  ${BLUE}Initializing Husky...${NC}"
npx husky init

# pre-commit hook
cat > .husky/pre-commit << 'HOOKEOF'
npx lint-staged
HOOKEOF
chmod +x .husky/pre-commit
echo -e "  ${GREEN}✔${NC} .husky/pre-commit → lint-staged"

# commit-msg hook (unless minimal)
if ! $MINIMAL; then
  cat > .husky/commit-msg << 'HOOKEOF'
npx --no -- commitlint --edit $1
HOOKEOF
  chmod +x .husky/commit-msg
  echo -e "  ${GREEN}✔${NC} .husky/commit-msg → commitlint"
fi

# Add lint-staged config to package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg['lint-staged'] = pkg['lint-staged'] || {
    '*.{ts,tsx,js,jsx}': ['eslint --fix', 'prettier --write'],
    '*.{json,css,md}': ['prettier --write']
  };
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo -e "  ${GREEN}✔${NC} lint-staged config added to package.json"

# Create commitlint config (unless minimal)
if ! $MINIMAL && [[ ! -f "commitlint.config.js" ]]; then
  cat > commitlint.config.js << 'COMMITEOF'
module.exports = { extends: ['@commitlint/config-conventional'] };
COMMITEOF
  echo -e "  ${GREEN}✔${NC} commitlint.config.js created"
fi

echo ""
echo -e "  ${GREEN}${BOLD}✅ Git hooks installed successfully!${NC}"
echo ""
echo -e "  ${DIM}Hooks active:${NC}"
echo -e "  ${DIM}  pre-commit  → ESLint + Prettier on staged files${NC}"
$MINIMAL || echo -e "  ${DIM}  commit-msg  → Conventional Commits validation${NC}"
echo ""
echo -e "  ${DIM}Valid commit format:${NC}"
echo -e "  ${DIM}  feat: add login page${NC}"
echo -e "  ${DIM}  fix: resolve auth token expiry${NC}"
echo -e "  ${DIM}  chore: update dependencies${NC}"
echo ""
