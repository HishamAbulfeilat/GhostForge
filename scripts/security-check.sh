#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-$(pwd)}"
TARGET="${TARGET/#\~/$HOME}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)"
BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

divider() { echo -e "${DIM}──────────────────────────────────────────────────────${NC}"; }

echo ""
echo -e "${BLUE}${BOLD}GhostForge Security Check${NC}"
echo -e "${DIM}Target: $TARGET${NC}"
divider

if [[ ! -f "$TARGET/package.json" ]]; then
  echo -e "${YELLOW}No package.json found. Running lightweight git-based checks only.${NC}"
else
  audit_json="$(cd "$TARGET" && npm audit --json 2>/dev/null || true)"
  if [[ -n "$audit_json" ]]; then
    printf '%s' "$audit_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=j.metadata?.vulnerabilities||{};console.log('npm audit => critical:',v.critical||0,'high:',v.high||0,'moderate:',v.moderate||0,'low:',v.low||0)}catch{console.log('npm audit unavailable')}})"
  else
    echo -e "${YELLOW}npm audit unavailable.${NC}"
  fi
fi

if (cd "$TARGET" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
  env_hits="$(cd "$TARGET" && git log --all --full-history -- '*.env*' 2>/dev/null | head -20 || true)"
  if [[ -n "$env_hits" ]]; then
    echo -e "${YELLOW}Recent git history touching .env files:${NC}"
    echo "$env_hits"
  else
    echo -e "${GREEN}✔ No .env history references found in recent scan.${NC}"
  fi
else
  echo -e "${YELLOW}Not a git repository; skipped history scan.${NC}"
fi
