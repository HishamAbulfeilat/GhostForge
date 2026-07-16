#!/usr/bin/env bash
set -euo pipefail
GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; CYAN='\033[0;36m'; NC='\033[0m'

SKIP_BREW=false; SKIP_NODE=false; SKIP_VSCODE=false
for arg in "$@"; do
  case "$arg" in
    --skip-brew) SKIP_BREW=true ;;
    --skip-node) SKIP_NODE=true ;;
    --skip-vscode) SKIP_VSCODE=true ;;
  esac
done

check() { command -v "$1" &>/dev/null; }
ok() { echo -e "  ${GREEN}✔${NC} $1"; }
skip() { echo -e "  ${DIM}⟳ Skipping: $1${NC}"; }
fail() { echo -e "  ${RED}✖ $1${NC}"; }
step() { echo -e "\n  ${BLUE}${BOLD}▶ $1${NC}"; }

echo ""
echo -e "${BLUE}${BOLD}  ╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   GhostForge Developer Onboarding                         ║${NC}"
echo -e "${BLUE}${BOLD}  ║   Sets up a new GhostForge dev machine in one command      ║${NC}"
echo -e "${BLUE}${BOLD}  ╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${DIM}OS: $(uname -s) $(uname -m)${NC}"
echo ""

if [[ "$(uname -s)" == "Darwin" ]] && ! $SKIP_BREW; then
  step "Homebrew"
  if check brew; then ok "Homebrew already installed"
  else
    echo -e "  ${DIM}Installing Homebrew...${NC}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" && ok "Homebrew installed" || fail "Homebrew install failed (continue manually)"
  fi
fi

if ! $SKIP_NODE; then
  step "Node.js 20+ LTS"
  if check node && node -e "process.exit(parseInt(process.version.slice(1), 10) >= 20 ? 0 : 1)" 2>/dev/null; then
    ok "Node.js $(node --version) already installed"
  else
    if check brew; then
      brew install node@20 2>/dev/null && ok "Node.js 20 installed via brew" || fail "Node install failed"
    elif check apt-get; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs && ok "Node.js installed" || fail "Node install failed"
    else
      echo -e "  ${YELLOW}⚠  Install Node.js 20+ manually: https://nodejs.org${NC}"
    fi
  fi
fi

step "Bun (fast JS runtime)"
if check bun; then ok "Bun $(bun --version) already installed"
else
  curl -fsSL https://bun.sh/install | bash 2>/dev/null && ok "Bun installed" || fail "Bun install failed"
fi

step "GitHub CLI (gh)"
if check gh; then ok "gh $(gh --version | head -1) already installed"
else
  if check brew; then brew install gh && ok "gh installed" || fail "gh install failed"
  elif check apt-get; then
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    sudo apt update && sudo apt install gh -y && ok "gh installed" || fail "gh install failed"
  fi
fi

step "Azure CLI (az)"
if check az; then ok "az $(az version --query '\"azure-cli\"' -o tsv 2>/dev/null || echo '?') already installed"
else
  if check brew; then brew install azure-cli 2>/dev/null && ok "az installed" || fail "az install failed"
  else echo -e "  ${DIM}Install manually: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli${NC}"; fi
fi

step "Global npm tools"
TOOLS=("npm-check-updates" "typescript" "lighthouse" "concurrently")
for tool in "${TOOLS[@]}"; do
  if npm list -g "$tool" &>/dev/null; then ok "$tool already installed"
  else npm install -g "$tool" --silent 2>/dev/null && ok "$tool installed" || fail "$tool install failed"; fi
done

if ! $SKIP_VSCODE; then
  step "VS Code extensions"
  if check code; then
    EXTENSIONS=(
      "github.copilot"
      "github.copilot-chat"
      "dbaeumer.vscode-eslint"
      "esbenp.prettier-vscode"
      "bradlc.vscode-tailwindcss"
      "ms-vscode.vscode-typescript-next"
      "formulahendry.auto-rename-tag"
      "christian-kohler.path-intellisense"
      "ms-azuretools.vscode-docker"
      "eamodio.gitlens"
    )
    for ext in "${EXTENSIONS[@]}"; do
      code --install-extension "$ext" --force &>/dev/null && ok "$ext" || skip "$ext"
    done
    VSIX=$(ls "$GHOSTFORGE_DIR/extension/"*.vsix 2>/dev/null | head -1 || true)
    if [[ -n "$VSIX" ]]; then
      code --install-extension "$VSIX" --force &>/dev/null && ok "ghostforge-ai extension" || skip "ghostforge-ai extension"
    fi
  else
    echo -e "  ${YELLOW}⚠  VS Code CLI not found. Install VS Code and run: Shell Command: Install 'code' in PATH${NC}"
  fi
fi

step "GitHub authentication"
if gh auth status &>/dev/null 2>&1; then
  ok "Already authenticated with GitHub"
else
  echo -e "  ${YELLOW}⚠  Not authenticated with GitHub.${NC}"
  echo -e "  ${DIM}  Run: gh auth login${NC}"
fi

step "GhostForge AI Toolkit"
cd "$GHOSTFORGE_DIR/tui" && npm install --silent 2>/dev/null && ok "TUI dependencies installed"

SHELL_PROFILE="$HOME/.zshrc"
[[ -f "$HOME/.bashrc" ]] && SHELL_PROFILE="$HOME/.bashrc"
if ! grep -q "ghostforge-ai" "$SHELL_PROFILE" 2>/dev/null; then
  echo "" >> "$SHELL_PROFILE"
  echo "# GhostForge AI Toolkit" >> "$SHELL_PROFILE"
  echo "alias ghostforge-ai='node $GHOSTFORGE_DIR/tui/index.js'" >> "$SHELL_PROFILE"
  ok "ghostforge-ai alias added to $SHELL_PROFILE"
else
  ok "ghostforge-ai alias already in $SHELL_PROFILE"
fi

echo ""
echo -e "  ${DIM}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${GREEN}${BOLD}✅ GhostForge developer environment ready!${NC}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "  ${DIM}1. Reload your shell: source $SHELL_PROFILE${NC}"
echo -e "  ${DIM}2. Auth GitHub: gh auth login${NC}"
echo -e "  ${DIM}3. Launch toolkit: ghostforge-ai${NC}"
echo ""
