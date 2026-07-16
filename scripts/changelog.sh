#!/usr/bin/env bash
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

SINCE_TAG=""
DRY_RUN=false
UNRELEASED=false
FORMAT="keepachangelog"
CHANGELOG_FILE="CHANGELOG.md"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --unreleased) UNRELEASED=true ;;
    --format=*) FORMAT="${arg#--format=}" ;;
    --since=*) SINCE_TAG="${arg#--since=}" ;;
    --out=*) CHANGELOG_FILE="${arg#--out=}" ;;
  esac
done

echo ""
echo -e "${BLUE}${BOLD}  ╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   /changelog — Generate CHANGELOG.md  ║${NC}"
echo -e "${BLUE}${BOLD}  ╚════════════════════════════════════════╝${NC}"
echo ""

# Check git repo
if ! git rev-parse --git-dir &>/dev/null; then
  echo -e "  ${RED}✖  Not a git repository.${NC}"; exit 1
fi

# Determine range
if [[ -z "$SINCE_TAG" ]]; then
  SINCE_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
fi

TODAY="$(date +%F)"
CURRENT_VERSION="$(cat VERSION 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || echo "unreleased")"

if [[ -n "$SINCE_TAG" ]]; then
  RAW_LOG="$(git --no-pager log --oneline "${SINCE_TAG}..HEAD" --no-merges 2>/dev/null || true)"
  RANGE="${SINCE_TAG}..HEAD"
else
  RAW_LOG="$(git --no-pager log --oneline --no-merges 2>/dev/null | head -100 || true)"
  RANGE="all commits"
fi

if [[ -z "$RAW_LOG" ]]; then
  echo -e "  ${YELLOW}ℹ  No commits found since ${SINCE_TAG:-beginning}. Nothing to generate.${NC}"
  echo ""
  exit 0
fi

echo -e "  ${DIM}Range: $RANGE${NC}"
echo -e "  ${DIM}Commits found: $(echo "$RAW_LOG" | wc -l | tr -d ' ')${NC}"
echo ""

# Parse commits into sections
declare -A SECTIONS
SECTIONS[feat]=""
SECTIONS[fix]=""
SECTIONS[perf]=""
SECTIONS[refactor]=""
SECTIONS[docs]=""
SECTIONS[chore]=""
SECTIONS[ci]=""
SECTIONS[breaking]=""
OTHER=""

while IFS= read -r line; do
  hash="${line%% *}"
  msg="${line#* }"
  if [[ "$msg" =~ ^feat(\(.+\))?!?:\ (.+)$ ]]; then
    SECTIONS[feat]+="- ${BASH_REMATCH[2]}"$'\n'
  elif [[ "$msg" =~ ^fix(\(.+\))?!?:\ (.+)$ ]]; then
    SECTIONS[fix]+="- ${BASH_REMATCH[2]}"$'\n'
  elif [[ "$msg" =~ ^perf(\(.+\))?!?:\ (.+)$ ]]; then
    SECTIONS[perf]+="- ${BASH_REMATCH[2]}"$'\n'
  elif [[ "$msg" =~ ^refactor(\(.+\))?!?:\ (.+)$ ]]; then
    SECTIONS[refactor]+="- ${BASH_REMATCH[2]}"$'\n'
  elif [[ "$msg" =~ ^docs(\(.+\))?!?:\ (.+)$ ]]; then
    SECTIONS[docs]+="- ${BASH_REMATCH[2]}"$'\n'
  elif [[ "$msg" =~ ^chore(\(.+\))?!?:\ (.+)$ ]]; then
    SECTIONS[chore]+="- ${BASH_REMATCH[2]}"$'\n'
  elif [[ "$msg" =~ ^ci(\(.+\))?!?:\ (.+)$ ]]; then
    SECTIONS[ci]+="- ${BASH_REMATCH[2]}"$'\n'
  elif [[ "$msg" =~ BREAKING\ CHANGE ]]; then
    SECTIONS[breaking]+="- $msg"$'\n'
  else
    OTHER+="- $msg"$'\n'
  fi
done <<< "$RAW_LOG"

# Build markdown output
build_section() {
  local header="$1" content="$2"
  if [[ -n "$content" ]]; then
    echo "### $header"
    echo ""
    echo -e "$content"
  fi
}

NEW_ENTRY="## [$CURRENT_VERSION] — $TODAY"$'\n'$'\n'
[[ -n "${SECTIONS[breaking]}" ]] && NEW_ENTRY+="$(build_section "💥 Breaking Changes" "${SECTIONS[breaking]}")"$'\n'
[[ -n "${SECTIONS[feat]}" ]]     && NEW_ENTRY+="$(build_section "✨ Features" "${SECTIONS[feat]}")"$'\n'
[[ -n "${SECTIONS[fix]}" ]]      && NEW_ENTRY+="$(build_section "🐛 Bug Fixes" "${SECTIONS[fix]}")"$'\n'
[[ -n "${SECTIONS[perf]}" ]]     && NEW_ENTRY+="$(build_section "⚡ Performance" "${SECTIONS[perf]}")"$'\n'
[[ -n "${SECTIONS[refactor]}" ]] && NEW_ENTRY+="$(build_section "♻️ Refactoring" "${SECTIONS[refactor]}")"$'\n'
[[ -n "${SECTIONS[docs]}" ]]     && NEW_ENTRY+="$(build_section "📚 Documentation" "${SECTIONS[docs]}")"$'\n'
[[ -n "${SECTIONS[chore]}" ]]    && NEW_ENTRY+="$(build_section "🔧 Maintenance" "${SECTIONS[chore]}")"$'\n'
[[ -n "${SECTIONS[ci]}" ]]       && NEW_ENTRY+="$(build_section "👷 CI/CD" "${SECTIONS[ci]}")"$'\n'
[[ -n "$OTHER" ]]                && NEW_ENTRY+="$(build_section "📝 Other" "$OTHER")"$'\n'
NEW_ENTRY+="---"$'\n'

if $DRY_RUN; then
  echo -e "${DIM}─────── DRY RUN ────────────────────────────────────────${NC}"
  echo ""
  echo "# Changelog"
  echo ""
  echo -e "$NEW_ENTRY"
  echo -e "${DIM}──────────────────────────────────────────────────────────${NC}"
  echo -e "  ${YELLOW}ℹ  Dry run — nothing written.${NC}"
else
  EXISTING=""
  if [[ -f "$CHANGELOG_FILE" ]]; then
    EXISTING="$(cat "$CHANGELOG_FILE")"
    EXISTING="${EXISTING#"# Changelog"}"
    EXISTING="${EXISTING#$'\n'}"
    EXISTING="${EXISTING#$'\n'}"
  fi
  {
    echo "# Changelog"
    echo ""
    echo -e "$NEW_ENTRY"
    [[ -n "$EXISTING" ]] && printf '%s\n' "$EXISTING"
  } > "$CHANGELOG_FILE"
  echo -e "  ${GREEN}✅ CHANGELOG.md updated:${NC} ${BOLD}$CHANGELOG_FILE${NC}"
fi

echo ""
echo -e "  ${GREEN}${BOLD}Done!${NC}"
echo ""
