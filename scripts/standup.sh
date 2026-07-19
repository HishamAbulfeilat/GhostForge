#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
DATA_DIR="$HOME/.ghostforge/standups"
mkdir -p "$DATA_DIR"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🗣️  GhostForge Daily Standup Generator${NC}"
  echo -e "${DIM}  Turn recent git activity into a concise standup update.${NC}"
  echo ""
}

collect_commits() {
  local since="$1"
  local until="$2"
  local repo author email
  if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
    return 0
  fi
  repo="$(git rev-parse --show-toplevel)"
  author="$(git -C "$repo" config user.name 2>/dev/null || true)"
  email="$(git -C "$repo" config user.email 2>/dev/null || true)"
  if [[ -n "$email" ]]; then
    git -C "$repo" log --since="$since" --until="$until" --author="$email" --pretty=format:'- %s' 2>/dev/null | sed '/^$/d'
  elif [[ -n "$author" ]]; then
    git -C "$repo" log --since="$since" --until="$until" --author="$author" --pretty=format:'- %s' 2>/dev/null | sed '/^$/d'
  else
    git -C "$repo" log --since="$since" --until="$until" --pretty=format:'- %s' 2>/dev/null | sed '/^$/d'
  fi
}

generate_standup() {
  local since="$1"
  local until="$2"
  local label="$3"
  local repo commits
  repo="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"
  commits="$(collect_commits "$since" "$until")"
  if [[ -z "$commits" ]]; then
    echo "No commits found for ${label}."
    return 0
  fi
  printf '## %s\n\n' "$repo"
  printf '%s\n' "$commits"
}

summarize() {
  local raw="$1"
  if command -v claude >/dev/null 2>&1; then
    local prompt
    prompt="Convert these git commits into a clear daily standup update. Format: What I did, What I'm doing today, Any blockers. Be concise.\n\n${raw}"
    printf '%s\n' "$prompt" | claude -p
  else
    printf '%s\n' "$raw"
  fi
}

render_cmd() {
  local since="$1"
  local until="$2"
  local label="$3"
  local raw
  raw="$(generate_standup "$since" "$until" "$label")"
  header
  if [[ -z "$raw" ]]; then
    echo -e "${YELLOW}⚠ No standup data available.${NC}"
    return 0
  fi
  if ! command -v claude >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Claude CLI not found — showing raw grouped commits instead.${NC}"
    echo ""
  fi
  summarize "$raw"
}

today_summary() {
  summarize "$(generate_standup 'yesterday 9am' 'now' 'today')"
}

save_cmd() {
  local file="$DATA_DIR/standup-$(date +%Y-%m-%d).md"
  local content
  content="$(today_summary)"
  printf '\n## %s\n\n%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$content" >> "$file"
  header
  echo -e "${GREEN}✅ Saved standup:${NC} $file"
}

help_cmd() {
  header
  cat <<EOF2
Usage:
  bash scripts/standup.sh today
  bash scripts/standup.sh yesterday
  bash scripts/standup.sh week
  bash scripts/standup.sh save
  bash scripts/standup.sh help
EOF2
}

case "$ACTION" in
  today) render_cmd 'yesterday 9am' 'now' 'today' ;;
  yesterday) render_cmd '2 days ago' 'yesterday midnight' 'yesterday' ;;
  week) render_cmd '7 days ago' 'now' 'this week' ;;
  save) save_cmd ;;
  help|--help|-h) help_cmd ;;
  *) help_cmd; exit 1 ;;
esac
