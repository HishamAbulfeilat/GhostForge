#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

ACTION="${1:-help}"
shift || true
RELEASE_DIR="$HOME/.ghostforge/releases"
mkdir -p "$RELEASE_DIR"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🚀  GhostForge Release Manager${NC}"
  echo -e "${DIM}  Prepare versions, tags, notes, and publish flows from one place.${NC}"
  echo ""
}

package_file() {
  if [[ -f package.json ]]; then
    printf 'package.json\n'
  elif [[ -f tui/package.json ]]; then
    printf 'tui/package.json\n'
  else
    echo -e "${RED}✖ No package.json found in current directory or tui/.${NC}" >&2
    exit 1
  fi
}

current_version() {
  node -e "const fs=require('fs');const file=process.argv[1];console.log(JSON.parse(fs.readFileSync(file,'utf8')).version||'0.0.0')" "$(package_file)"
}

bump_version() {
  local kind="$1"
  node - <<'NODE' "$kind" "$(package_file)"
const fs = require('fs');
const kind = process.argv[2];
const file = process.argv[3];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
let [major, minor, patch] = String(data.version || '0.0.0').split('.').map(Number);
if (kind === 'major') [major, minor, patch] = [major + 1, 0, 0];
else if (kind === 'minor') [major, minor, patch] = [major, minor + 1, 0];
else [major, minor, patch] = [major, minor, patch + 1];
const next = `${major}.${minor}.${patch}`;
data.version = next;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(next);
NODE
}

latest_tag() {
  git describe --tags --abbrev=0 2>/dev/null || true
}

extract_latest_notes() {
  [[ -f CHANGELOG.md ]] || {
    echo -e "${YELLOW}⚠ CHANGELOG.md not found.${NC}"
    return 0
  }
  python3 - <<'PY'
from pathlib import Path
lines = Path("CHANGELOG.md").read_text(encoding="utf-8").splitlines()
active = False
chunk = []
for line in lines:
    if line.startswith("## "):
        if active:
            break
        active = True
    if active:
        chunk.append(line)
print("\n".join(chunk).strip())
PY
}

prepare_cmd() {
  local kind="${1:-patch}"
  local file old new
  file="$(package_file)"
  old="$(current_version)"
  header
  echo -e "${DIM}Running changelog generator...${NC}"
  bash scripts/changelog.sh generate || true
  new="$(bump_version "$kind")"
  [[ -f VERSION ]] && printf '%s\n' "$new" > VERSION
  echo -e "${GREEN}✅ Release prepared.${NC}"
  echo -e "${CYAN}Package:${NC} $file"
  echo -e "${CYAN}Version:${NC} ${old} → ${new}"
  echo -e "${DIM}Next:${NC} bash scripts/release.sh tag"
}

tag_cmd() {
  local version
  version="$(current_version)"
  header
  git tag -a "v${version}" -m "Release v${version}"
  echo -e "${GREEN}✅ Created tag:${NC} v${version}"
}

notes_cmd() {
  local version file notes
  version="$(current_version)"
  notes="$(extract_latest_notes)"
  [[ -n "$notes" ]] || exit 0
  file="$RELEASE_DIR/release-notes-v${version}.md"
  header
  printf '%s\n' "$notes" | tee "$file"
  echo -e "${GREEN}✅ Saved notes:${NC} $file"
}

publish_cmd() {
  local version remote_url repo_url draft_url
  version="$(current_version)"
  header
  git push --tags
  remote_url="$(git remote get-url origin 2>/dev/null || true)"
  repo_url="$(printf '%s' "$remote_url" | sed -E 's#git@github.com:([^ ]+)#https://github.com/\1#; s#\.git$##')"
  if [[ -n "$repo_url" ]]; then
    draft_url="${repo_url}/releases/new?tag=v${version}"
    echo -e "${GREEN}✅ Tags pushed.${NC}"
    echo -e "${CYAN}Draft release:${NC} $draft_url"
    open "$draft_url" 2>/dev/null || xdg-open "$draft_url" 2>/dev/null || true
  fi
}

status_cmd() {
  local version tag commits changed
  version="$(current_version)"
  tag="$(latest_tag)"
  commits=0
  changed=0
  if [[ -n "$tag" ]]; then
    commits="$(git rev-list --count "${tag}..HEAD" 2>/dev/null || echo 0)"
    changed="$(git diff --name-only "${tag}..HEAD" 2>/dev/null | sed '/^$/d' | wc -l | tr -d ' ')"
  fi
  header
  echo -e "${CYAN}Current version:${NC} $version"
  echo -e "${CYAN}Last tag:${NC} ${tag:-none}"
  echo -e "${CYAN}Commits since tag:${NC} $commits"
  echo -e "${CYAN}Unreleased changed files:${NC} $changed"
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/release.sh prepare [patch|minor|major]
  bash scripts/release.sh tag
  bash scripts/release.sh notes
  bash scripts/release.sh publish
  bash scripts/release.sh status
  bash scripts/release.sh help
EOF
}

case "$ACTION" in
  prepare) prepare_cmd "${1:-patch}" ;;
  tag) tag_cmd ;;
  notes) notes_cmd ;;
  publish) publish_cmd ;;
  status) status_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
