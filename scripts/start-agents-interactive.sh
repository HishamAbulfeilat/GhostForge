#!/usr/bin/env bash
# Start the team with an explicit provider selection when one CLI is unavailable.
#
# Usage:
#   scripts/start-agents-interactive.sh              # interactive picker
#   scripts/start-agents-interactive.sh --mode both      # skip the prompt
#   scripts/start-agents-interactive.sh --mode claude    # Claude Code only
#   scripts/start-agents-interactive.sh --mode copilot   # Copilot CLI only
#   scripts/start-agents-interactive.sh --setup-only     # just create the worktree + checks
#   scripts/start-agents-interactive.sh --no-loop        # run the solo/loop agent once
#   scripts/start-agents-interactive.sh --no-ecc         # skip the default pinned ECC context setup
#
# Optional ECC setup for Claude workflows:
#   claude /plugin marketplace add https://github.com/affaan-m/ECC
#   claude /plugin install ecc@ecc
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COPILOT_WORKTREE="$(cd "$REPO_ROOT/.." && pwd)/gf-copilot"
COPILOT_BRANCH="agent/copilot/main"
KICKOFF_BOTH="$REPO_ROOT/prompts/multi-agent-kickoff.md"
KICKOFF_COPILOT_SOLO="$REPO_ROOT/prompts/copilot-solo-kickoff.md"
KICKOFF_CLAUDE_SOLO="$REPO_ROOT/prompts/claude-solo-kickoff.md"
# --allow-all-tools is required by `copilot -p` (non-interactive mode); deny
# the handful of destructive git/gh actions the workflow doesn't need the
# agent to run itself (main is branch-protected anyway, but belt + suspenders).
COPILOT_FLAGS="--allow-all-tools --deny-tool 'shell(git push --force*)' --deny-tool 'shell(git push origin main)' --deny-tool 'shell(git push origin main:*)' --deny-tool 'shell(gh pr merge)'"

MODE=
SETUP_ONLY=0
LOOP=1
INSTALL_ECC=1
for arg in "$@"; do
  case "$arg" in
    --mode=*)     MODE="${arg#*=}" ;;
    --mode)       shift_next=1 ;;
    --setup-only) SETUP_ONLY=1 ;;
    --no-loop)    LOOP=0 ;;
    --install-ecc) INSTALL_ECC=1 ;;
    --no-ecc)     INSTALL_ECC=0 ;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    both|claude|copilot) MODE="$arg" ;;
    *) if [ "${shift_next:-0}" = 1 ]; then MODE="$arg"; shift_next=0; else echo "unknown option: $arg" >&2; exit 2; fi ;;
  esac
done

info()  { printf '\033[36m[start-agents]\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m[start-agents]\033[0m %s\n' "$*" >&2; }

# ── Preflight ────────────────────────────────────────────────────────────────
command -v git >/dev/null || { warn "git not found"; exit 1; }
[ -n "${GITHUB_TOKEN:-}" ] || warn "GITHUB_TOKEN is not set — the MCP servers and gh actions need it. export GITHUB_TOKEN=... before starting."

HAVE_CLAUDE=1; command -v claude  >/dev/null || { HAVE_CLAUDE=0; warn "claude (Claude Code) not found — install: npm i -g @anthropic-ai/claude-code"; }
HAVE_COPILOT=1; command -v copilot >/dev/null || { HAVE_COPILOT=0; warn "copilot (GitHub Copilot CLI) not found — install: npm i -g @github/copilot"; }

if [ "$INSTALL_ECC" = 1 ]; then
  info "Preparing pinned ECC task context…"
  node "$REPO_ROOT/scripts/agents/ecc-setup.mjs"
fi

# ── Ask which agent(s) to run, unless --mode was passed ─────────────────────
if [ -z "$MODE" ]; then
  echo
  echo "  Which agent(s) do you want to run?"
  echo "    1) Claude Code + Copilot CLI (both, coordinating via .agent-sync/)"
  echo "    2) Claude Code only  (e.g. Copilot not set up on this machine)"
  echo "    3) Copilot CLI only  (e.g. Claude Code hit its usage/token limit)"
  default=1
  [ "$HAVE_CLAUDE" = 1 ] || default=3
  read -r -p "  Enter 1/2/3 [default ${default}]: " choice </dev/tty || choice=""
  choice="${choice:-$default}"
  case "$choice" in
    1) MODE=both ;;
    2) MODE=claude ;;
    3) MODE=copilot ;;
    *) warn "unrecognized choice '$choice', defaulting to option $default"; case "$default" in 1) MODE=both;; 3) MODE=copilot;; esac ;;
  esac
fi

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
    CLAUDE_CMD="cd '$REPO_ROOT' && claude '/team start'"
    if [ "$LOOP" = 1 ]; then
      COPILOT_CMD="cd '$COPILOT_WORKTREE' && while :; do copilot -p \"\$(cat '$KICKOFF_BOTH')\" $COPILOT_FLAGS; sleep 5; done"
    else
      COPILOT_CMD="cd '$COPILOT_WORKTREE' && copilot -p \"\$(cat '$KICKOFF_BOTH')\" $COPILOT_FLAGS"
    fi
    ;;
  claude)
    # Solo framing is passed as the kickoff prompt so Claude knows Copilot
    # isn't running and it's free to pick up [copilot]-tagged tasks too.
    CLAUDE_CMD="cd '$REPO_ROOT' && claude -p \"\$(cat '$KICKOFF_CLAUDE_SOLO')\" --permission-mode bypassPermissions --disallowedTools 'Bash(git push:*)' 'Bash(gh pr merge:*)' 'Bash(git rebase:*)'"
    ;;
  copilot)
    if [ "$LOOP" = 1 ]; then
      COPILOT_CMD="cd '$COPILOT_WORKTREE' && while :; do copilot -p \"\$(cat '$KICKOFF_COPILOT_SOLO')\" $COPILOT_FLAGS; sleep 5; done"
    else
      COPILOT_CMD="cd '$COPILOT_WORKTREE' && copilot -p \"\$(cat '$KICKOFF_COPILOT_SOLO')\" $COPILOT_FLAGS"
    fi
    printf '\nTerminal 1: %s\nTerminal 2: %s\n' "$CLAUDE_CMD" "$COPILOT_CMD"
    ;;
esac
