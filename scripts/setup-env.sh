#!/bin/bash

# ============================================================
# GhostForge Environment Setup
# Install and configure all required tools
# ============================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo "🔧 GhostForge Developer Environment Setup"
echo "======================================"

check_command() {
  if command -v "$1" &> /dev/null; then
    echo -e "${GREEN}✅ $1 is installed${NC}"
  else
    echo -e "${RED}❌ $1 is NOT installed — please install it${NC}"
  fi
}

echo ""
echo "Checking required tools..."
check_command node
check_command npm
check_command git
check_command code

echo ""
echo "Checking optional tools..."
check_command npx
check_command yarn
check_command pnpm

# Node version check
NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 18 ]; then
  echo -e "${GREEN}✅ Node.js version is compatible (v$(node --version))${NC}"
else
  echo -e "${RED}❌ Node.js 18+ required. Current: $(node --version)${NC}"
fi

# VS Code extensions
echo ""
echo "Installing recommended VS Code extensions..."
extensions=(
  "GitHub.copilot"
  "GitHub.copilot-chat"
  "dbaeumer.vscode-eslint"
  "esbenp.prettier-vscode"
  "bradlc.vscode-tailwindcss"
  "ms-azuretools.vscode-azurestaticwebapps"
  "ms-vscode.azurecli"
  "PKief.material-icon-theme"
  "usernamehw.errorlens"
  "streetsidesoftware.code-spell-checker"
  "eamodio.gitlens"
)

for ext in "${extensions[@]}"; do
  code --install-extension "$ext" --force 2>/dev/null && \
    echo -e "${GREEN}✅ $ext${NC}" || \
    echo -e "${YELLOW}⚠️  Could not install $ext (VS Code may not be in PATH)${NC}"
done

echo ""
echo -e "${GREEN}✅ Environment setup complete!${NC}"

# ── OfficeCLI ──────────────────────────────────────────────
echo ""
echo "Installing OfficeCLI (Office documents — .docx/.xlsx/.pptx)..."
if command -v officecli &>/dev/null; then
  echo -e "${GREEN}✅ officecli $(officecli --version 2>/dev/null | head -1) already installed${NC}"
else
  if curl -fsSL https://d.officecli.ai/install.sh | bash 2>/dev/null; then
    echo -e "${GREEN}✅ officecli installed successfully${NC}"
  else
    echo -e "${YELLOW}⚠️  officecli install failed — retry manually: curl -fsSL https://d.officecli.ai/install.sh | bash${NC}"
  fi
fi

echo ""
echo -e "${GREEN}🔫 GhostForge environment ready!${NC}"
