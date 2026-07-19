#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

ACTION="${1:-help}"
shift || true
OUT_DIR="$HOME/.ghostforge/explanations"
LOG_DIR="$HOME/.ghostforge/logs"
mkdir -p "$OUT_DIR"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  💡  GhostForge AI Error Explainer${NC}"
  echo -e "${DIM}  Turn stack traces and log fragments into clear fixes.${NC}"
  echo ""
}

has_claude() {
  command -v claude >/dev/null 2>&1
}

save_output() {
  local content="$1"
  local file="$OUT_DIR/explain-$(date +%Y%m%d-%H%M%S).md"
  printf '%s\n' "$content" > "$file"
  echo -e "${GREEN}✅ Saved explanation:${NC} $file"
}

explain_payload() {
  local payload="$1"
  local title="$2"
  local output

  if has_claude; then
    output="$(printf '%s' "$payload" | claude -p "You are a senior developer. Explain this error clearly and provide the exact fix with code example. Format your answer with sections: Root Cause, Exact Fix, Example, Prevention." 2>/dev/null || true)"
    [[ -n "$output" ]] || output="## ${title}\n\nClaude returned no output. Verify your Claude CLI auth and retry."
  else
    output="# ${title}"
    output+=$'\n\n'
    output+="Claude CLI is not installed."
    output+=$'\n'
    output+="Suggested fallback:"
    output+=$'\n'
    output+="- search the exact error text"
    output+=$'\n'
    output+="- inspect the first failing stack frame"
    output+=$'\n'
    output+="- compare recent code changes"
    output+=$'\n\n```'
    output+=$'\n'
    output+="$payload"
    output+=$'\n```'
  fi

  echo "$output"
  save_output "$output"
}

error_cmd() {
  local message="${*:-}"
  [[ -n "$message" ]] || {
    echo -e "${RED}✖ Error message is required.${NC}"
    exit 1
  }
  header
  explain_payload "$message" "Error Explanation"
}

log_cmd() {
  local file="${1:-}"
  [[ -n "$file" ]] || {
    echo -e "${RED}✖ Log file is required.${NC}"
    exit 1
  }
  [[ -f "$file" ]] || {
    echo -e "${RED}✖ File not found: $file${NC}"
    exit 1
  }
  header
  local extracted
  extracted="$(grep -inE 'error|exception|fatal' "$file" | tail -50 || true)"
  [[ -n "$extracted" ]] || extracted="$(tail -n 50 "$file" || true)"
  explain_payload "$extracted" "Log Explanation"
}

pipe_cmd() {
  header
  local payload
  payload="$(cat)"
  [[ -n "$payload" ]] || {
    echo -e "${YELLOW}⚠ No stdin content received.${NC}"
    exit 0
  }
  explain_payload "$payload" "Piped Error Explanation"
}

last_cmd() {
  header
  local latest=""
  if [[ -d "$LOG_DIR" ]]; then
    latest="$(find "$LOG_DIR" -type f | sort | tail -1 || true)"
  fi
  if [[ -z "$latest" ]]; then
    latest="$(find . -maxdepth 3 -type f \( -name '*.log' -o -name 'npm-debug.log*' -o -name 'yarn-error.log' \) | head -1 || true)"
  fi
  [[ -n "$latest" ]] || {
    echo -e "${YELLOW}⚠ No recent logs found.${NC}"
    exit 0
  }
  explain_payload "$(tail -n 50 "$latest" || true)" "Recent Log Explanation"
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/explain.sh error <message>
  bash scripts/explain.sh log <file>
  cat error.log | bash scripts/explain.sh pipe
  bash scripts/explain.sh last
  bash scripts/explain.sh help
EOF
}

case "$ACTION" in
  error) error_cmd "$@" ;;
  log) log_cmd "${1:-}" ;;
  pipe) pipe_cmd ;;
  last) last_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
