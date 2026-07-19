#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  update.sh — GhostForge Updater
#  • Pulls latest changes from GitHub
#  • Bumps version (major / minor / patch)
#  • Creates a git tag and pushes it
#  • Optionally syncs to all registered projects
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$GHOSTFORGE_DIR/VERSION"
CHANGELOG_FILE="$GHOSTFORGE_DIR/CHANGELOG.md"
PROJECTS_FILE="$GHOSTFORGE_DIR/.registered-projects"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

divider() { echo -e "${DIM}──────────────────────────────────────────────────${NC}"; }

prepend_changelog_entry() {
  local new_version="$1"
  local entry_date
  entry_date="$(date +%F)"
  local previous_tag=''
  previous_tag="$(git describe --tags --abbrev=0 2>/dev/null || true)"
  local log_lines='Initial release'

  if [[ -n "$previous_tag" ]]; then
    log_lines="$(git --no-pager log --oneline "${previous_tag}..HEAD" -n 20 2>/dev/null || true)"
    [[ -z "$log_lines" ]] && log_lines="No changes recorded"
  fi

  local scratch="$GHOSTFORGE_DIR/.changelog.prepend.$$"
  local existing_body=''
  if [[ -f "$CHANGELOG_FILE" ]]; then
    existing_body="$(cat "$CHANGELOG_FILE")"
    if [[ "$existing_body" == \#\ Changelog* ]]; then
      existing_body="${existing_body#"# Changelog"}"
      existing_body="${existing_body#"$'\n'"}"
      existing_body="${existing_body#"$'\n'"}"
    fi
  fi
  {
    echo "# Changelog"
    echo ""
    echo "## v${new_version} — ${entry_date}"
    echo ""
    echo "${log_lines}"
    echo ""
    echo "---"
    echo ""
    [[ -n "$existing_body" ]] && printf '%s\n' "$existing_body"
  } > "$scratch"
  mv "$scratch" "$CHANGELOG_FILE"
}

# ── Read current version ────────────────────────────────────
CURRENT_VERSION="$(cat "$VERSION_FILE" 2>/dev/null || echo "2.0.0")"

echo ""
echo -e "${BLUE}${BOLD}  ╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   GhostForge — Updater             ║${NC}"
echo -e "${BLUE}${BOLD}  ╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Current version : ${BOLD}v${CURRENT_VERSION}${NC}"
echo ""
divider

# ── Check if git repo ────────────────────────────────────────
cd "$GHOSTFORGE_DIR"
IS_GIT=false
if git rev-parse --git-dir > /dev/null 2>&1; then IS_GIT=true; fi

if $IS_GIT; then
  # ── Pull latest ─────────────────────────────────────────────
  echo ""
  echo -e "  ${BLUE}Pulling latest changes...${NC}"
  git pull origin main --quiet 2>/dev/null || git pull origin master --quiet 2>/dev/null || true

  PULLED_VERSION="$(cat "$VERSION_FILE" 2>/dev/null || echo "$CURRENT_VERSION")"
  if [[ "$PULLED_VERSION" != "$CURRENT_VERSION" ]]; then
    echo -e "  ${GREEN}✔${NC} Updated from ${BOLD}v${CURRENT_VERSION}${NC} → ${BOLD}v${PULLED_VERSION}${NC}"
    CURRENT_VERSION="$PULLED_VERSION"
  else
    echo -e "  ${CYAN}✔${NC} Already at latest from remote."
  fi
  echo ""
  divider
fi

# ── Version bump ──────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Bump version?${NC}  (current: v${CURRENT_VERSION})"
echo ""

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

NEXT_PATCH="${MAJOR}.${MINOR}.$((PATCH + 1))"
NEXT_MINOR="${MAJOR}.$((MINOR + 1)).0"
NEXT_MAJOR="$((MAJOR + 1)).0.0"

echo -e "  ${BOLD}1)${NC} Patch   v${CURRENT_VERSION} → ${YELLOW}v${NEXT_PATCH}${NC}  (bug fixes)"
echo -e "  ${BOLD}2)${NC} Minor   v${CURRENT_VERSION} → ${YELLOW}v${NEXT_MINOR}${NC}  (new features)"
echo -e "  ${BOLD}3)${NC} Major   v${CURRENT_VERSION} → ${YELLOW}v${NEXT_MAJOR}${NC}  (breaking changes)"
echo -e "  ${BOLD}4)${NC} Custom  (type your own)"
echo -e "  ${BOLD}5)${NC} Skip    (keep v${CURRENT_VERSION})"
echo ""
read -rp "  Choice [1-5]: " bump_choice

NEW_VERSION="$CURRENT_VERSION"
case "$bump_choice" in
  1) NEW_VERSION="$NEXT_PATCH" ;;
  2) NEW_VERSION="$NEXT_MINOR" ;;
  3) NEW_VERSION="$NEXT_MAJOR" ;;
  4)
    read -rp "  Enter version (e.g. 3.1.0): " custom_ver
    NEW_VERSION="${custom_ver:-$CURRENT_VERSION}"
    ;;
  5) echo -e "  ${DIM}Keeping v${CURRENT_VERSION}${NC}" ;;
  *) echo -e "  ${YELLOW}Invalid — keeping v${CURRENT_VERSION}${NC}" ;;
esac

if [[ "$NEW_VERSION" != "$CURRENT_VERSION" ]]; then
  echo "$NEW_VERSION" > "$VERSION_FILE"
  prepend_changelog_entry "$NEW_VERSION"
  echo -e ""
  echo -e "  ${GREEN}✔${NC} VERSION file updated: ${BOLD}v${NEW_VERSION}${NC}"
  echo -e "  ${GREEN}✔${NC} CHANGELOG.md updated"
fi

echo ""
divider

# ── Git tag & commit ─────────────────────────────────────────
if $IS_GIT && [[ "$NEW_VERSION" != "$CURRENT_VERSION" ]]; then
  echo ""
  echo -e "  ${BOLD}Commit + tag v${NEW_VERSION}?${NC} (y/n)"
  read -rp "  > " do_tag

  if [[ "$do_tag" =~ ^[Yy]$ ]]; then
    git add "$VERSION_FILE" "$CHANGELOG_FILE"
    git commit -m "chore: bump version to v${NEW_VERSION}" --quiet

    # Create annotated tag
    git tag -a "v${NEW_VERSION}" -m "GhostForge v${NEW_VERSION}"
    echo -e "  ${GREEN}✔${NC} Tag created: ${BOLD}v${NEW_VERSION}${NC}"

    # Push if remote exists
    if git remote get-url origin > /dev/null 2>&1; then
      echo -e "  ${BLUE}Pushing tag to origin...${NC}"
      git push origin main --quiet 2>/dev/null || git push origin master --quiet 2>/dev/null || true
      git push origin "v${NEW_VERSION}" --quiet
      echo -e "  ${GREEN}✔${NC} Pushed tag v${NEW_VERSION} to origin"
    else
      echo -e "  ${YELLOW}ℹ  No remote configured — tag created locally only.${NC}"
      echo -e "  ${DIM}  To push later: git push origin v${NEW_VERSION}${NC}"
    fi
  fi
fi

echo ""
divider

# ── Sync to registered projects ──────────────────────────────
if [[ -f "$PROJECTS_FILE" ]] && [[ -s "$PROJECTS_FILE" ]]; then
  echo ""
  echo -e "  ${BOLD}Registered projects found:${NC}"
  echo ""
  while IFS= read -r proj; do
    [[ -z "$proj" || "$proj" == \#* ]] && continue
    if [[ -d "$proj" ]]; then
      echo -e "  ${CYAN}•${NC} $proj"
    else
      echo -e "  ${DIM}• $proj (not found — skipping)${NC}"
    fi
  done < "$PROJECTS_FILE"

  echo ""
  echo -e "  ${BOLD}Sync toolkit to all registered projects?${NC} (y/n)"
  read -rp "  > " do_sync
  if [[ "$do_sync" =~ ^[Yy]$ ]]; then
    while IFS= read -r proj; do
      [[ -z "$proj" || "$proj" == \#* ]] && continue
      [[ -d "$proj" ]] || continue
      echo ""
      echo -e "  ${BLUE}Syncing → $proj${NC}"
      bash "$GHOSTFORGE_DIR/scripts/open-project.sh" "$proj" --no-vscode 2>/dev/null || \
        bash "$GHOSTFORGE_DIR/scripts/copy-to-project.sh" "$proj"
    done < "$PROJECTS_FILE"
  fi
else
  echo ""
  echo -e "  ${DIM}Tip: Register projects so updates auto-sync:${NC}"
  echo -e "  ${DIM}  echo \"/path/to/project\" >> ~/ghostforge/.registered-projects${NC}"
fi

echo ""
divider

# ── VS Code extension auto-rebuild & reinstall ───────────────
EXT_DIR="$GHOSTFORGE_DIR/extension"
if [[ -d "$EXT_DIR" ]] && [[ "$NEW_VERSION" != "$CURRENT_VERSION" ]]; then
  echo ""
  echo -e "  ${BLUE}Rebuilding VS Code extension for v${NEW_VERSION}...${NC}"

  # Update version in extension/package.json
  if command -v node &>/dev/null && [[ -f "$EXT_DIR/package.json" ]]; then
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$EXT_DIR/package.json', 'utf8'));
      pkg.version = '$NEW_VERSION';
      fs.writeFileSync('$EXT_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');
    " 2>/dev/null && echo -e "  ${GREEN}✔${NC} extension/package.json version → $NEW_VERSION"
  fi

  # Rebuild bundle
  if [[ -f "$EXT_DIR/esbuild.js" ]]; then
    node "$EXT_DIR/esbuild.js" 2>/dev/null \
      && echo -e "  ${GREEN}✔${NC} Extension rebuilt" \
      || echo -e "  ${YELLOW}⚠  Extension rebuild skipped (check extension/src/)${NC}"
  fi

  # Repackage .vsix
  if command -v npx &>/dev/null; then
    # Remove old vsix files
    rm -f "$EXT_DIR"/*.vsix 2>/dev/null || true
    npx @vscode/vsce package --no-dependencies --out "$EXT_DIR/ghostforge-${NEW_VERSION}.vsix" 2>/dev/null \
      && echo -e "  ${GREEN}✔${NC} Packaged: ghostforge-${NEW_VERSION}.vsix" \
      || echo -e "  ${YELLOW}⚠  VSIX packaging skipped${NC}"
  fi

  # Auto-reinstall if code CLI available
  VSIX_FILE="$EXT_DIR/ghostforge-${NEW_VERSION}.vsix"
  if command -v code &>/dev/null && [[ -f "$VSIX_FILE" ]]; then
    code --install-extension "$VSIX_FILE" --force &>/dev/null \
      && echo -e "  ${GREEN}✔${NC} Extension reinstalled in VS Code (reload window to activate)" \
      || echo -e "  ${YELLOW}⚠  Auto-install skipped — run: code --install-extension $VSIX_FILE${NC}"
  elif [[ -f "$VSIX_FILE" ]]; then
    echo -e "  ${DIM}  Install manually: code --install-extension $VSIX_FILE${NC}"
  fi
fi

echo ""
divider
echo ""
echo -e "  ${GREEN}${BOLD}✅ GhostForge v${NEW_VERSION} ready!${NC}"
echo ""
echo -e "  ${DIM}Launch TUI    : ~/ghostforge/ghostforge${NC}"
echo -e "  ${DIM}Open project  : bash ~/ghostforge/scripts/open-project.sh${NC}"
echo ""
