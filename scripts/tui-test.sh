#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$ROOT_DIR/scripts"
TEST_DIR="${GF_TUI_TEST_DIR:-$ROOT_DIR/.gf-test-$$}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

PASS_COUNT=0
TOTAL_COUNT=0
RESULT_LINES=()

cleanup() {
  rm -rf "$TEST_DIR"
}

trap cleanup EXIT

print_header() {
  echo -e "${CYAN}${BOLD}GhostForge TUI Feature Test${NC}"
  echo -e "${DIM}Scratch project: $TEST_DIR${NC}"
  echo ""
}

create_dummy_project() {
  mkdir -p "$TEST_DIR/src"

  cat > "$TEST_DIR/package.json" <<'EOF'
{
  "name": "test-project",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "18.3.1"
  }
}
EOF

  cat > "$TEST_DIR/src/index.js" <<'EOF'
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
EOF

  cat > "$TEST_DIR/src/App.jsx" <<'EOF'
import React from "react";

export default function App() {
  return (
    <main>
      <h1>GhostForge Test Project</h1>
      <p>Dummy React app for CLI smoke tests.</p>
    </main>
  );
}
EOF

  cat > "$TEST_DIR/README.md" <<'EOF'
# Test Project

Dummy project for GhostForge CLI smoke tests.
EOF

  (
    cd "$TEST_DIR"
    git init -q
    git config user.name "GhostForge Test"
    git config user.email "ghostforge@example.com"
    npm install --package-lock-only --silent >/dev/null 2>&1 || true
    git add .
    git commit -qm "init"
  )
}

run_with_timeout() {
  local seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
    return $?
  fi

  python3 - "$seconds" "$@" <<'PY'
import os
import signal
import subprocess
import sys

timeout = int(sys.argv[1])
command = sys.argv[2:]
proc = subprocess.Popen(command)

def handle_timeout(signum, frame):
    try:
        proc.kill()
    finally:
        sys.exit(124)

signal.signal(signal.SIGALRM, handle_timeout)
signal.alarm(timeout)
code = proc.wait()
signal.alarm(0)
sys.exit(code)
PY
}

record_result() {
  local status="$1"
  local label="$2"
  local detail="$3"

  TOTAL_COUNT=$((TOTAL_COUNT + 1))

  if [[ "$status" == "PASS" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    RESULT_LINES+=("✓|$label|$detail")
    echo -e "${GREEN}✓${NC} $label ${DIM}$detail${NC}"
  else
    RESULT_LINES+=("✗|$label|$detail")
    echo -e "${RED}✗${NC} $label ${DIM}$detail${NC}"
  fi
}

run_test() {
  local label="$1"
  local cwd="$2"
  shift 2

  local output_file="$TEST_DIR/.last-output"
  if (
    cd "$cwd"
    GF_NON_INTERACTIVE=1 run_with_timeout 10 "$@"
  ) >"$output_file" 2>&1; then
    record_result "PASS" "$label" "$(head -n 1 "$output_file" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
  else
    local exit_code=$?
    local first_line
    first_line="$(head -n 1 "$output_file" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
    [[ -n "$first_line" ]] || first_line="exit $exit_code"
    record_result "FAIL" "$label" "$first_line"
  fi
}

print_summary() {
  echo ""
  echo -e "${BOLD}Summary${NC}"
  echo -e "${BLUE}Passed: $PASS_COUNT / Total: $TOTAL_COUNT${NC}"
}

main() {
  print_header
  create_dummy_project

  run_test "carbon.sh status" "$TEST_DIR" bash "$SCRIPTS_DIR/carbon.sh" status
  run_test "health-score.sh score" "$ROOT_DIR" bash "$SCRIPTS_DIR/health-score.sh" score "$TEST_DIR"
  run_test "dep-health.sh check" "$TEST_DIR" bash "$SCRIPTS_DIR/dep-health.sh" check
  run_test "bundle.sh track" "$ROOT_DIR" bash "$SCRIPTS_DIR/bundle.sh" track "$TEST_DIR"
  run_test "doctor.sh" "$ROOT_DIR" env GHOSTFORGE_ROOT="$TEST_DIR" bash "$SCRIPTS_DIR/doctor.sh"
  run_test "ai-review.sh --help" "$TEST_DIR" bash "$SCRIPTS_DIR/ai-review.sh" --help
  run_test "standup.sh --help" "$TEST_DIR" bash "$SCRIPTS_DIR/standup.sh" --help
  run_test "commit.sh --help" "$TEST_DIR" bash "$SCRIPTS_DIR/commit.sh" --help
  run_test "marketplace.sh list" "$ROOT_DIR" bash "$SCRIPTS_DIR/marketplace.sh" list

  print_summary
}

main "$@"
