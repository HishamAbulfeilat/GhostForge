#!/usr/bin/env bash
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNIPPETS_DIR="$GHOSTFORGE_DIR/snippets"
BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

divider() { echo -e "${DIM}──────────────────────────────────────────────────────${NC}"; }
copy_clipboard() {
  local file="$1"
  if command -v pbcopy >/dev/null 2>&1; then
    cat "$file" | pbcopy
    echo -e "${GREEN}✔ Copied to clipboard.${NC}"
  elif command -v xclip >/dev/null 2>&1; then
    cat "$file" | xclip -selection clipboard
    echo -e "${GREEN}✔ Copied to clipboard.${NC}"
  else
    echo -e "${YELLOW}Clipboard tool not found. Open the file manually:${NC} $file"
  fi
}

while true; do
  echo ""
  echo -e "${BLUE}${BOLD}GhostForge Snippet Manager${NC}"
  divider
  mapfile -t snippets < <(find "$SNIPPETS_DIR" -maxdepth 1 -type f -name '*.md' ! -name 'README.md' -exec basename {} .md \; | sort)
  if [[ ${#snippets[@]} -eq 0 ]]; then
    echo -e "${RED}No snippets found.${NC}"
    exit 1
  fi
  printf '1) List snippets\n2) View snippet\n3) Copy snippet to clipboard\n4) Exit\n\n'
  read -rp 'Choice [1-4]: ' action
  case "$action" in
    1)
      printf '\n'
      for snippet in "${snippets[@]}"; do echo -e "${GREEN}•${NC} $snippet"; done
      ;;
    2|3)
      printf '\nAvailable snippets:\n'
      select snippet in "${snippets[@]}" "Back"; do
        [[ "$snippet" == "Back" || -z "$snippet" ]] && break
        file="$SNIPPETS_DIR/$snippet.md"
        if [[ "$action" == "2" ]]; then
          divider
          cat "$file"
          divider
        else
          copy_clipboard "$file"
        fi
        break
      done
      ;;
    4) exit 0 ;;
    *) echo -e "${YELLOW}Invalid choice.${NC}" ;;
  esac
done
