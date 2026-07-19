#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  👻  GhostForge Git Autopilot${NC}"
  echo -e "${DIM}  Operator-grade git helpers, forged in the shadows.${NC}"
  echo ""
}

usage() {
  header
  cat <<EOF
Usage:
  bash scripts/git-autopilot.sh suggest-commit
  bash scripts/git-autopilot.sh suggest-branch [task description]
  bash scripts/git-autopilot.sh suggest-pr
  bash scripts/git-autopilot.sh status
  bash scripts/git-autopilot.sh help
EOF
}

require_git() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo -e "${RED}✖ Not a git repository.${NC}"; exit 1; }
}

has_claude() {
  command -v claude >/dev/null 2>&1
}

kebab() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

suggest_commit() {
  require_git
  local diff
  diff="$(git --no-pager diff --staged --no-ext-diff)"
  if [[ -z "$diff" ]]; then
    echo -e "${YELLOW}⚠ No staged changes found. Stage files first with git add.${NC}"
    return 0
  fi

  local message
  if has_claude; then
    message="$(printf '%s' "$diff" | claude -p 'Write one conventional commit message for this staged diff. Output only the commit subject line.' 2>/dev/null | head -n 1 | tr -d '\r')"
  else
    message=""
  fi
  [[ -z "$message" ]] && message='feat(scope): summarize the staged changes'

  echo ""
  echo -e "${GREEN}${BOLD}Suggested commit:${NC} ${CYAN}$message${NC}"
  echo ""

  if ! has_claude; then
    echo -e "${DIM}Claude CLI not found. Manual fallback template:${NC}"
    echo -e "${DIM}  type(scope): short imperative summary${NC}"
    echo ""
  fi

  read -r -p "Commit with this message now? [y/N] " answer
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    git commit -m "$message"
  else
    echo -e "${DIM}Skipped commit.${NC}"
  fi
}

suggest_branch() {
  local task="${*:-}"
  if [[ -z "$task" ]]; then
    read -r -p 'Task description: ' task
  fi
  [[ -z "$task" ]] && { echo -e "${RED}✖ Task description is required.${NC}"; exit 1; }

  if has_claude; then
    local prompt="Suggest 3 git branch names in kebab-case for this task: $task. Output exactly 3 lines, no numbering, no explanation."
    echo ""
    echo -e "${GREEN}${BOLD}Suggested branches:${NC}"
    claude -p "$prompt" 2>/dev/null | sed '/^\s*$/d' | head -n 3 | sed 's/^/  • /'
    echo ""
    return 0
  fi

  local slug
  slug="$(kebab "$task")"
  echo ""
  echo -e "${GREEN}${BOLD}Suggested branches:${NC}"
  echo "  • feat/$slug"
  echo "  • chore/$slug"
  echo "  • spike/$slug"
  echo ""
}

suggest_pr() {
  require_git
  local base='main'
  git show-ref --verify --quiet refs/heads/main || base='master'
  local log
  log="$(git --no-pager log "$base"..HEAD --oneline 2>/dev/null || true)"
  [[ -z "$log" ]] && { echo -e "${YELLOW}⚠ No commits found between $base and HEAD.${NC}"; return 0; }

  if has_claude; then
    printf '%s\n' "$log" | claude -p "Using these commits, write a PR title and a markdown PR description with sections: Summary, Changes, Testing. Output markdown only." 2>/dev/null
    return 0
  fi

  local first
  first="$(printf '%s\n' "$log" | head -n 1 | cut -d' ' -f2-)"
  echo "# ${first:-Update branch}"
  echo ""
  echo "## Summary"
  echo "- Summarize the goal of this branch."
  echo ""
  echo "## Changes"
  printf '%s\n' "$log" | sed 's/^/- /'
  echo ""
  echo "## Testing"
  echo "- [ ] Add validation steps"
}

show_status() {
  require_git
  local branch
  branch="$(git branch --show-current 2>/dev/null || echo detached)"
  header
  echo -e "${BLUE}Branch:${NC} $branch"
  echo -e "${BLUE}Status:${NC}"
  git --no-pager status --short --branch
  echo ""
}

case "$ACTION" in
  suggest-commit) header; suggest_commit ;;
  suggest-branch) header; suggest_branch "$@" ;;
  suggest-pr)     header; suggest_pr ;;
  status)         show_status ;;
  help|--help|-h) usage ;;
  *)              usage; exit 1 ;;
esac
