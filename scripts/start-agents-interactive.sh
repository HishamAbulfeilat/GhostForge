#!/usr/bin/env bash
# Interactive launcher for the GhostForge multi-agent workflow. Asks which
# agent(s) to run before starting anything — handy when one provider (e.g.
# Claude Code) has hit its usage/token limit and you want to keep the team
# moving with just the other one, instead of both.
#
# This is a copy of scripts/start-agents.sh with a mode picker in front of it;
# see that script for the plain "always run both" version. Same protocol:
# docs/MULTI-AGENT-WORKFLOW.md   Rules: AGENTS.md
#
# Usage:
#   scripts/start-agents-interactive.sh              # interactive picker
#   scripts/start-agents-interactive.sh --mode both      # skip the prompt
#   scripts/start-agents-interactive.sh --mode claude    # Claude Code only
#   scripts/start-agents-interactive.sh --mode copilot   # Copilot CLI only
#   scripts/start-agents-interactive.sh --setup-only     # just create the worktree + checks
#   scripts/start-agents-interactive.sh --no-loop        # run the solo/loop agent once
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COPILOT_WORKTREE="$(cd "$REPO_ROOT/.." && pwd)/gf-copilot"
COPILOT_BRANCH="agent/copilot/main"
KICKOFF_BOTH="$REPO_ROOT/prompts/multi-agent-kickoff.md"
KICKOFF_COPILOT_SOLO="$REPO_ROOT/prompts/copilot-solo-kickoff.md"
KICKOFF_CLAUDE_SOLO="$REPO_ROOT/prompts/claude-solo-kickoff.md"

MODE=""
SETUP_ONLY=0
LOOP=1
for arg in "$@"; do
  case "$arg" in
    --mode=*)     MODE="${arg#*=}" ;;
    --mode)       shift_next=1 ;;
    --setup-only) SETUP_ONLY=1 ;;
    --no-loop)    LOOP=0 ;;
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
  both|claude|copilot) ;;
  *) warn "invalid --mode '$MODE' (expected both|claude|copilot)"; exit 2 ;;
esac

if [ "$MODE" = both ] || [ "$MODE" = claude ]; then
  [ "$HAVE_CLAUDE" = 1 ] || { warn "Claude Code is required for mode '$MODE' but isn't installed."; exit 1; }
fi
if [ "$MODE" = both ] || [ "$MODE" = copilot ]; then
  [ "$HAVE_COPILOT" = 1 ] || { warn "Copilot CLI is required for mode '$MODE' but isn't installed."; exit 1; }
fi

info "Mode: $MODE"

# ── Sync main ────────────────────────────────────────────────────────────────
info "Fetching latest main…"
git -C "$REPO_ROOT" fetch origin main --quiet || warn "fetch failed (offline?) — continuing"

# ── Copilot worktree (separate working dir avoids file collisions) ───────────
if [ "$MODE" = both ] || [ "$MODE" = copilot ]; then
  if [ ! -d "$COPILOT_WORKTREE" ]; then
    info "Creating Copilot worktree at $COPILOT_WORKTREE (branch $COPILOT_BRANCH)…"
    git -C "$REPO_ROOT" worktree add "$COPILOT_WORKTREE" -B "$COPILOT_BRANCH" origin/main >/dev/null
  else
    info "Copilot worktree already exists: $COPILOT_WORKTREE"
  fi
fi

if [ "$SETUP_ONLY" = 1 ]; then
  info "Setup complete."
  [ "$MODE" = both ] || [ "$MODE" = claude ] && info "Claude dir: $REPO_ROOT"
  [ "$MODE" = both ] || [ "$MODE" = copilot ] && info "Copilot dir: $COPILOT_WORKTREE"
  exit 0
fi

# ── Build the command(s) for the chosen mode ─────────────────────────────────
case "$MODE" in
  both)
    CLAUDE_CMD="cd '$REPO_ROOT' && claude '/team start'"
    if [ "$LOOP" = 1 ]; then
      COPILOT_CMD="cd '$COPILOT_WORKTREE' && while :; do copilot -p \"\$(cat '$KICKOFF_BOTH')\"; sleep 5; done"
    else
      COPILOT_CMD="cd '$COPILOT_WORKTREE' && copilot -p \"\$(cat '$KICKOFF_BOTH')\""
    fi
    ;;
  claude)
    # Solo framing is passed as the kickoff prompt so Claude knows Copilot
    # isn't running and it's free to pick up [copilot]-tagged tasks too.
    CLAUDE_CMD="cd '$REPO_ROOT' && claude -p \"\$(cat '$KICKOFF_CLAUDE_SOLO')\""
    ;;
  copilot)
    if [ "$LOOP" = 1 ]; then
      COPILOT_CMD="cd '$COPILOT_WORKTREE' && while :; do copilot -p \"\$(cat '$KICKOFF_COPILOT_SOLO')\"; sleep 5; done"
    else
      COPILOT_CMD="cd '$COPILOT_WORKTREE' && copilot -p \"\$(cat '$KICKOFF_COPILOT_SOLO')\""
    fi
    ;;
esac

# ── Launch: tmux split for "both", else run/print the single command ────────
if [ "$MODE" = both ]; then
  if command -v tmux >/dev/null && [ -z "${TMUX:-}" ]; then
    info "Launching both agents in a tmux session 'gf-agents' (Ctrl-b then arrows to switch, Ctrl-b d to detach)…"
    tmux new-session -d -s gf-agents -n agents "$CLAUDE_CMD"
    tmux split-window -h -t gf-agents "$COPILOT_CMD"
    tmux select-layout -t gf-agents even-horizontal
    exec tmux attach -t gf-agents
  else
    cat <<EOF

  tmux not available (or already inside tmux). Start the agents in two terminals:

  ── Terminal 1 — Claude Code ──────────────────────────────────────────────
    $CLAUDE_CMD

  ── Terminal 2 — GitHub Copilot CLI ───────────────────────────────────────
    $COPILOT_CMD

  They coordinate through .agent-sync/BOARD.md + MESSAGES.md.
  Tip: pre-approve Copilot's tools (copilot → /allow) so it doesn't stop to ask.
EOF
  fi
elif [ "$MODE" = claude ]; then
  info "Starting Claude Code solo…"
  eval "$CLAUDE_CMD"
else
  info "Starting Copilot CLI solo…"
  eval "$COPILOT_CMD"
fi
