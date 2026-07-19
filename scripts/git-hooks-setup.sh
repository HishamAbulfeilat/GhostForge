#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
HOOKS_DIR="$(git rev-parse --git-path hooks 2>/dev/null || true)"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🪝  GhostForge Smart Git Hooks${NC}"
  echo -e "${DIM}  Install lightweight repo hooks for carbon tracking, lint, typecheck, and commit hygiene.${NC}"
  echo ""
}

require_repo() {
  git rev-parse --git-dir >/dev/null 2>&1 || {
    echo -e "${RED}✖ Run this inside a git repository.${NC}"
    exit 1
  }
  HOOKS_DIR="$(git rev-parse --git-path hooks)"
  mkdir -p "$HOOKS_DIR"
}

write_hooks() {
  cat > "$HOOKS_DIR/pre-commit" <<'HOOKEOF'
#!/usr/bin/env bash
echo "🔫 GhostForge pre-commit checks..."

# 1. Carbon micro-track
if command -v ghostforge &>/dev/null; then
  ghostforge carbon track git-commit-check 2>/dev/null || true
fi

# 2. Type check (if tsconfig exists)
if [ -f tsconfig.json ]; then
  echo "⏳ TypeScript check..."
  npx tsc --noEmit --skipLibCheck 2>&1 | tail -5
fi

# 3. Lint staged files
if [ -f .eslintrc ] || [ -f .eslintrc.js ] || [ -f .eslintrc.cjs ] || [ -f .eslintrc.json ] || [ -f eslint.config.js ] || [ -f eslint.config.mjs ] || [ -f eslint.config.cjs ]; then
  echo "⏳ ESLint..."
  npx eslint --cache $(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$' | tr '\n' ' ') 2>/dev/null || true
fi

echo "✅ Pre-commit checks done"
HOOKEOF

  cat > "$HOOKS_DIR/commit-msg" <<'HOOKEOF'
#!/usr/bin/env bash
msg_file="$1"
pattern='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: .+'
if ! grep -Eq "$pattern" "$msg_file"; then
  echo "❌ Commit message must follow Conventional Commits."
  echo "   Example: feat(api): add health endpoint"
  exit 1
fi
HOOKEOF

  chmod +x "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/commit-msg"
}

install_cmd() {
  require_repo
  header
  write_hooks
  echo -e "${GREEN}✅ Installed pre-commit and commit-msg hooks in ${HOOKS_DIR}${NC}"
}

uninstall_cmd() {
  require_repo
  header
  rm -f "$HOOKS_DIR/pre-commit" "$HOOKS_DIR/commit-msg"
  echo -e "${GREEN}✅ Removed GhostForge hooks from ${HOOKS_DIR}${NC}"
}

status_cmd() {
  require_repo
  header
  for hook in pre-commit commit-msg; do
    local_path="$HOOKS_DIR/$hook"
    if [[ -f "$local_path" ]]; then
      echo -e "${GREEN}✔ ${hook}${NC}"
      sed 's/^/  /' "$local_path"
    else
      echo -e "${YELLOW}○ ${hook} not installed${NC}"
    fi
    echo ""
  done
}

customize_cmd() {
  require_repo
  header
  local hook="${1:-pre-commit}"
  local editor="${EDITOR:-vi}"
  local file="$HOOKS_DIR/$hook"
  [[ -f "$file" ]] || { echo -e "${YELLOW}⚠ $hook not installed. Run install first.${NC}"; return 0; }
  "$editor" "$file"
}

help_cmd() {
  header
  cat <<EOF2
Usage:
  bash scripts/git-hooks-setup.sh install
  bash scripts/git-hooks-setup.sh uninstall
  bash scripts/git-hooks-setup.sh status
  bash scripts/git-hooks-setup.sh customize [pre-commit|commit-msg]
  bash scripts/git-hooks-setup.sh help
EOF2
}

case "$ACTION" in
  install) install_cmd ;;
  uninstall) uninstall_cmd ;;
  status) status_cmd ;;
  customize) customize_cmd "${1:-pre-commit}" ;;
  help|--help|-h) help_cmd ;;
  *) help_cmd; exit 1 ;;
esac
