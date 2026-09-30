#!/usr/bin/env bash
# Start the team with an explicit provider selection when one CLI is unavailable.
#
# Usage:
#   scripts/start-agents-interactive.sh
#   scripts/start-agents-interactive.sh --mode both|claude|copilot
#   scripts/start-agents-interactive.sh --setup-only
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COPILOT_WORKTREE="$(cd "$REPO_ROOT/.." && pwd)/gf-copilot"
COPILOT_BRANCH="agent/copilot/main"
KICKOFF="$REPO_ROOT/prompts/copilot-solo-kickoff.md"

MODE=
SETUP_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      [ "$#" -ge 2 ] || { echo "--mode requires a value" >&2; exit 2; }
      MODE="$2"; shift 2 ;;
    --setup-only) SETUP_ONLY=1; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$MODE" in
  ''|both|claude|copilot) ;;
  *) echo "mode must be both, claude, or copilot" >&2; exit 2 ;;
esac

if [ -z "$MODE" ]; then
  if command -v claude >/dev/null && command -v copilot >/dev/null; then
    MODE=both
  elif command -v copilot >/dev/null; then
    MODE=copilot
  elif command -v claude >/dev/null; then
    MODE=claude
  else
    echo "Neither claude nor copilot is installed." >&2
    exit 1
  fi
fi

command -v git >/dev/null || { echo "git not found" >&2; exit 1; }
git -C "$REPO_ROOT" fetch origin main --quiet || true

if [ ! -d "$COPILOT_WORKTREE" ]; then
  git -C "$REPO_ROOT" worktree add "$COPILOT_WORKTREE" -B "$COPILOT_BRANCH" origin/main >/dev/null
fi

[ "$SETUP_ONLY" = 1 ] && exit 0

CLAUDE_CMD="cd '$REPO_ROOT' && claude '/team start'"
COPILOT_CMD="cd '$COPILOT_WORKTREE' && copilot -p \"\$(cat '$KICKOFF')\""

case "$MODE" in
  claude) exec bash -lc "$CLAUDE_CMD" ;;
  copilot) exec bash -lc "$COPILOT_CMD" ;;
  both)
    if command -v tmux >/dev/null && [ -z "${TMUX:-}" ]; then
      tmux new-session -d -s gf-agents -n agents "$CLAUDE_CMD"
      tmux split-window -h -t gf-agents "$COPILOT_CMD"
      tmux select-layout -t gf-agents even-horizontal
      exec tmux attach -t gf-agents
    fi
    printf '\nTerminal 1: %s\nTerminal 2: %s\n' "$CLAUDE_CMD" "$COPILOT_CMD"
    ;;
esac
