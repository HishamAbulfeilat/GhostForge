#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

ACTION="${1:-help}"
shift || true
REVIEW_DIR="$HOME/.ghostforge/reviews"
mkdir -p "$REVIEW_DIR"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🔍  GhostForge AI Code Review${NC}"
  echo -e "${DIM}  Diff-aware review for bugs, security, performance, TS, and React patterns.${NC}"
  echo ""
}

require_git() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo -e "${RED}✖ Not a git repository.${NC}"
    exit 1
  }
}

has_claude() {
  command -v claude &>/dev/null
}

manual_checklist() {
  cat <<'EOF'
## Manual Review Checklist
- Bugs: edge cases, null/undefined paths, state transitions
- Security: secrets, injection, auth gaps, unsafe HTML
- Performance: unnecessary re-renders, large loops, sync blocking work
- TypeScript: weak types, any leakage, unsafe casts
- React: stale effects, missing keys, prop patterns
EOF
}

save_review() {
  local content="$1"
  local file="$REVIEW_DIR/review-$(date +%Y%m%d-%H%M%S).md"
  printf '%s\n' "$content" > "$file"
  echo -e "${GREEN}✅ Saved review:${NC} $file"
}

render_review() {
  local title="$1"
  local prompt="$2"
  local payload="$3"
  local output

  if has_claude; then
    output="$(printf '%s' "$payload" | claude -p "$prompt" 2>/dev/null || true)"
    [[ -n "$output" ]] || output="## ${title}\n\nClaude returned no output. Verify your Claude CLI session and retry."
  else
    output="# ${title}"
    output+=$'\n\n'
    output+="Claude CLI not found."
    output+=$'\n'
    output+="Install it, then re-run:"
    output+=$'\n'
    output+="  npm install -g @anthropic-ai/claude-code"
    output+=$'\n'
    output+="  claude --help"
    output+=$'\n\n'
    output+="$(manual_checklist)"
    output+=$'\n\n```diff\n'
    output+="$(printf '%s' "$payload" | sed -n '1,200p')"
    output+=$'\n```'
  fi

  echo "$output"
  save_review "$output"
}

review_staged() {
  require_git
  local diff
  diff="$(git --no-pager diff --staged --no-ext-diff || true)"
  [[ -n "$diff" ]] || {
    echo -e "${YELLOW}⚠ No staged changes found.${NC}"
    exit 0
  }

  header
  render_review \
    "Staged Review" \
    "You are a senior frontend developer. Review this code diff for: 1) Bugs 2) Security issues 3) Performance anti-patterns 4) TypeScript best practices 5) React patterns. Be specific and actionable. Format as sections." \
    "$diff"
}

review_branch() {
  require_git
  local base="${1:-main}"
  local diff
  diff="$(git --no-pager diff "${base}...HEAD" --no-ext-diff || true)"
  [[ -n "$diff" ]] || {
    echo -e "${YELLOW}⚠ No changes found between ${base} and HEAD.${NC}"
    exit 0
  }

  header
  render_review \
    "Branch Review (${base}...HEAD)" \
    "You are a senior frontend developer. Review this branch diff against ${base} for: 1) Bugs 2) Security issues 3) Performance anti-patterns 4) TypeScript best practices 5) React patterns. Be specific and actionable. Format as sections." \
    "$diff"
}

review_file() {
  local path="${1:-}"
  [[ -n "$path" ]] || {
    echo -e "${RED}✖ File path is required.${NC}"
    exit 1
  }
  [[ -f "$path" ]] || {
    echo -e "${RED}✖ File not found: $path${NC}"
    exit 1
  }

  header
  render_review \
    "File Review (${path})" \
    "You are a senior frontend developer. Review this file for: 1) Bugs 2) Security issues 3) Performance anti-patterns 4) TypeScript best practices 5) React patterns. Be specific and actionable. Format as sections. File: ${path}" \
    "$(cat "$path")"
}

review_full() {
  require_git
  local base="main"
  if ! git show-ref --verify --quiet refs/heads/main && git show-ref --verify --quiet refs/heads/master; then
    base="master"
  fi
  local diff files
  files="$(git --no-pager diff --name-only "${base}...HEAD" || true)"
  diff="$(git --no-pager diff "${base}...HEAD" --no-ext-diff || true)"
  [[ -n "$diff" ]] || {
    echo -e "${YELLOW}⚠ No changed files found vs ${base}.${NC}"
    exit 0
  }

  header
  render_review \
    "Full Review (${base}...HEAD)" \
    "You are a senior frontend developer. Review all changed files vs ${base}. Focus on: 1) Bugs 2) Security issues 3) Performance anti-patterns 4) TypeScript best practices 5) React patterns. Be specific and actionable. Format as sections. Changed files:\n${files}" \
    "$diff"
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/ai-review.sh staged
  bash scripts/ai-review.sh branch [base]
  bash scripts/ai-review.sh file <path>
  bash scripts/ai-review.sh full
  bash scripts/ai-review.sh help
EOF
}

case "$ACTION" in
  staged) review_staged ;;
  branch) review_branch "${1:-main}" ;;
  file) review_file "${1:-}" ;;
  full) review_full ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
