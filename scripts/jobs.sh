#!/usr/bin/env bash
# ghostforge jobs — Job Hunter (CV → matching jobs → one-click applications)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# TypeScript stripping + module hooks: Node 22.15+ or 23.5+
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>23||(a===23&&b>=5)||(a===22&&b>=15)?0:1)'; then
  echo "ghostforge jobs needs Node 22.15+ (you have $(node --version))." >&2
  exit 1
fi

if [ ! -d "$SCRIPT_DIR/../web-ui/node_modules" ]; then
  echo "Installing web-ui dependencies (first run only)..."
  (cd "$SCRIPT_DIR/../web-ui" && npm install --silent)
fi

exec node --experimental-strip-types --no-warnings "$SCRIPT_DIR/job-hunter.mjs" "$@"
