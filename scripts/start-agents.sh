#!/usr/bin/env bash
# Start the GhostForge multi-agent workflow: Claude Code + GitHub Copilot CLI
# working this repo at the same time, coordinating through .agent-sync/.
#
# Protocol: docs/MULTI-AGENT-WORKFLOW.md   Rules: AGENTS.md
#
# Usage:
#   scripts/start-agents.sh              # tmux split if available, else prints steps
#   scripts/start-agents.sh --setup-only # just create the worktree + checks
#   scripts/start-agents.sh --no-loop    # start Copilot once instead of looping
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COPILOT_WORKTREE="$(cd "$REPO_ROOT/.." && pwd)/gf-copilot"
COPILOT_BRANCH="agent/copilot/main"
KICKOFF="$REPO_ROOT/prompts/multi-agent-kickoff.md"

SETUP_ONLY=0
LOOP=1
for arg in "$@"; do
  case "$arg" in
    --setup-only) SETUP_ONLY=1 ;;
    --no-loop)    LOOP=0 ;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

info()  { printf '\033[36m[start-agents]\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m[start-agents]\033[0m %s\n' "$*" >&2; }

# ── Preflight ────────────────────────────────────────────────────────────────
command -v git >/dev/null || { warn "git not found"; exit 1; }
[ -n "${GITHUB_TOKEN:-}" ] || warn "GITHUB_TOKEN is not set — the MCP servers and gh actions need it. export GITHUB_TOKEN=... before starting."

HAVE_CLAUDE=1; command -v claude  >/dev/null || { HAVE_CLAUDE=0; warn "claude (Claude Code) not found — install: npm i -g @anthropic-ai/claude-code"; }
HAVE_COPILOT=1; command -v copilot >/dev/null || { HAVE_COPILOT=0; warn "copilot (GitHub Copilot CLI) not found — install: npm i -g @github/copilot"; }

# ── Sync main ────────────────────────────────────────────────────────────────
info "Fetching latest main…"
git -C "$REPO_ROOT" fetch origin main --quiet || warn "fetch failed (offline?) — continuing"

# ── Copilot worktree (separate working dir avoids file collisions) ───────────
if [ ! -d "$COPILOT_WORKTREE" ]; then
  info "Creating Copilot worktree at $COPILOT_WORKTREE (branch $COPILOT_BRANCH)…"
  git -C "$REPO_ROOT" worktree add "$COPILOT_WORKTREE" -B "$COPILOT_BRANCH" origin/main >/dev/null
else
  info "Copilot worktree already exists: $COPILOT_WORKTREE"
fi

if [ "$SETUP_ONLY" = 1 ]; then
  info "Setup complete. Claude dir: $REPO_ROOT  •  Copilot dir: $COPILOT_WORKTREE"
  exit 0
fi

# ── Build the two commands ───────────────────────────────────────────────────
CLAUDE_CMD="cd '$REPO_ROOT' && claude '/team start'"
if [ "$LOOP" = 1 ]; then
  COPILOT_CMD="cd '$COPILOT_WORKTREE' && while :; do copilot -p \"\$(cat '$KICKOFF')\"; sleep 5; done"
else
  COPILOT_CMD="cd '$COPILOT_WORKTREE' && copilot -p \"\$(cat '$KICKOFF')\""
fi

# ── Launch: tmux split if we can, else print the steps ───────────────────────
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
