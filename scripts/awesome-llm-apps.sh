#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "ghostforge awesome-llm-apps requires Node.js 18 or newer." >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  exec node "$SCRIPT_DIR/awesome-llm-apps.mjs"
fi

case "${1:-}" in
  -h|--help|help)
    exec node "$SCRIPT_DIR/awesome-llm-apps.mjs" --help
    ;;
  *)
    exec node "$SCRIPT_DIR/awesome-llm-apps.mjs" "$@"
    ;;
esac
