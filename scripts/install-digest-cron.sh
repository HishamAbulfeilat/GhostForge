#!/usr/bin/env bash
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$(pwd)}"
TARGET="${TARGET/#\~/$HOME}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)"
BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

divider() { echo -e "${DIM}──────────────────────────────────────────────────────${NC}"; }

echo ""
echo -e "${BLUE}${BOLD}GhostForge Daily Digest Installer${NC}"
echo -e "${DIM}Project: $TARGET${NC}"
divider
printf 'Install daily digest in:\n  1) cron\n  2) shell profile (.zshrc/.bashrc)\n  3) cancel\n\n'
read -rp 'Choice [1-3]: ' choice

case "$choice" in
  1)
    entry="0 9 * * 1-5 cd \"$TARGET\" && \"$GHOSTFORGE_DIR/scripts/daily-digest.sh\" \"$TARGET\""
    existing="$(crontab -l 2>/dev/null || true)"
    if printf '%s\n' "$existing" | grep -Fq "$GHOSTFORGE_DIR/scripts/daily-digest.sh"; then
      echo -e "${YELLOW}Digest cron already installed.${NC}"
    else
      { printf '%s\n' "$existing"; printf '%s\n' "$entry"; } | crontab -
      echo -e "${GREEN}✔ Daily digest added to cron (weekdays at 09:00).${NC}"
    fi
    ;;
  2)
    shell_name="$(basename "${SHELL:-zsh}")"
    profile="$HOME/.zshrc"
    [[ "$shell_name" == "bash" ]] && profile="$HOME/.bashrc"
    alias_line="alias ghostforge-digest='cd \"$TARGET\" && \"$GHOSTFORGE_DIR/scripts/daily-digest.sh\" \"$TARGET\"'"
    touch "$profile"
    if grep -Fq "$alias_line" "$profile"; then
      echo -e "${YELLOW}Alias already present in $profile.${NC}"
    else
      printf '\n%s\n' "$alias_line" >> "$profile"
      echo -e "${GREEN}✔ Added ghostforge-digest alias to $profile.${NC}"
      echo -e "${DIM}Run: source $profile${NC}"
    fi
    ;;
  *)
    echo -e "${RED}Cancelled.${NC}"
    ;;
esac
