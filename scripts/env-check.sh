#!/usr/bin/env bash
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

TARGET="$(pwd)"
FIX=false
STRICT=false

for arg in "$@"; do
  case "$arg" in
    --fix) FIX=true ;;
    --strict) STRICT=true ;;
    *) TARGET="$arg" ;;
  esac
done
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)"

echo ""
echo -e "${BLUE}${BOLD}  ╔═════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   /env-check — Env Var Validator        ║${NC}"
echo -e "${BLUE}${BOLD}  ╚═════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${DIM}Project: $TARGET${NC}"
echo ""

ENV_FILE="$TARGET/.env"
EXAMPLE_FILE="$TARGET/.env.example"
ISSUES=0

# Check files exist
if [[ ! -f "$ENV_FILE" ]]; then
  echo -e "  ${YELLOW}⚠  No .env file found at $ENV_FILE${NC}"
  echo -e "  ${DIM}  Create one: cp .env.example .env${NC}"
fi

if [[ ! -f "$EXAMPLE_FILE" ]]; then
  echo -e "  ${YELLOW}⚠  No .env.example file found at $EXAMPLE_FILE${NC}"
fi

if [[ ! -f "$ENV_FILE" && ! -f "$EXAMPLE_FILE" ]]; then
  echo -e "  ${RED}✖  Neither .env nor .env.example found. Nothing to check.${NC}"
  exit 0
fi

# Parse keys
get_keys() {
  local file="$1"
  grep -E '^[A-Z_][A-Z0-9_]*=' "$file" 2>/dev/null | cut -d= -f1 | sort -u || true
}

ENV_KEYS="$(get_keys "$ENV_FILE" 2>/dev/null || true)"
EXAMPLE_KEYS="$(get_keys "$EXAMPLE_FILE" 2>/dev/null || true)"

# 1. Missing in .env (defined in .env.example but not .env)
if [[ -f "$EXAMPLE_FILE" && -f "$ENV_FILE" ]]; then
  MISSING_IN_ENV="$(comm -23 <(echo "$EXAMPLE_KEYS") <(echo "$ENV_KEYS") 2>/dev/null || true)"
  if [[ -n "$MISSING_IN_ENV" ]]; then
    COUNT=$(echo "$MISSING_IN_ENV" | wc -l | tr -d ' ')
    echo -e "  ${RED}❌ Missing in .env ($COUNT):${NC}"
    while IFS= read -r key; do
      [[ -z "$key" ]] && continue
      echo -e "     ${YELLOW}$key${NC} ${DIM}— defined in .env.example${NC}"
    done <<< "$MISSING_IN_ENV"
    echo ""
    ISSUES=$((ISSUES + COUNT))
  fi
fi

# 2. Undocumented in .env.example (in .env but not .env.example)
if [[ -f "$ENV_FILE" && -f "$EXAMPLE_FILE" ]]; then
  UNDOCUMENTED="$(comm -23 <(echo "$ENV_KEYS") <(echo "$EXAMPLE_KEYS") 2>/dev/null || true)"
  if [[ -n "$UNDOCUMENTED" ]]; then
    COUNT=$(echo "$UNDOCUMENTED" | wc -l | tr -d ' ')
    echo -e "  ${YELLOW}⚠️  Undocumented in .env.example ($COUNT):${NC}"
    while IFS= read -r key; do
      [[ -z "$key" ]] && continue
      echo -e "     ${YELLOW}$key${NC}"
    done <<< "$UNDOCUMENTED"
    echo ""
    ISSUES=$((ISSUES + COUNT))
    if $FIX; then
      echo -e "  ${BLUE}--fix: Adding undocumented keys to .env.example...${NC}"
      while IFS= read -r key; do
        [[ -z "$key" ]] && continue
        echo "${key}=" >> "$EXAMPLE_FILE"
        echo -e "     ${GREEN}+${NC} $key= added to .env.example"
      done <<< "$UNDOCUMENTED"
      echo ""
    fi
  fi
fi

# 3. Secrets exposed in .env.example
if [[ -f "$EXAMPLE_FILE" ]]; then
  EXPOSED=""
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    # Placeholders are safe: empty, YOUR_, <...>, EXAMPLE_, xxx, yyy
    if [[ -n "$value" && ! "$value" =~ ^(YOUR_|EXAMPLE_|<|xxx|yyy|changeme|placeholder|todo) ]]; then
      EXPOSED+="$key"$'\n'
    fi
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "$EXAMPLE_FILE" 2>/dev/null || true)
  if [[ -n "$EXPOSED" ]]; then
    COUNT=$(echo "$EXPOSED" | grep -c . || true)
    echo -e "  ${RED}🔴 Possible secrets in .env.example ($COUNT):${NC}"
    while IFS= read -r key; do
      [[ -z "$key" ]] && continue
      echo -e "     ${RED}$key${NC} ${DIM}← has real value, use a placeholder instead${NC}"
    done <<< "$EXPOSED"
    echo ""
    ISSUES=$((ISSUES + COUNT))
  fi
fi

# 4. Empty required vars in .env
if [[ -f "$ENV_FILE" ]]; then
  EMPTY_REQUIRED=""
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    if [[ -z "$value" ]]; then
      EMPTY_REQUIRED+="$key"$'\n'
    fi
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "$ENV_FILE" 2>/dev/null || true)
  if [[ -n "$EMPTY_REQUIRED" ]]; then
    COUNT=$(echo "$EMPTY_REQUIRED" | grep -c . || true)
    echo -e "  ${YELLOW}⚠️  Empty values in .env ($COUNT):${NC}"
    while IFS= read -r key; do
      [[ -z "$key" ]] && continue
      echo -e "     ${YELLOW}$key${NC}${DIM}= (empty)${NC}"
    done <<< "$EMPTY_REQUIRED"
    echo ""
    ISSUES=$((ISSUES + COUNT))
  fi
fi

# Summary
TOTAL_KEYS=$(echo "$ENV_KEYS" | grep -c . 2>/dev/null || echo 0)
MAX_SCORE=10
if (( ISSUES == 0 )); then
  SCORE=$MAX_SCORE
  echo -e "  ${GREEN}✅ All environment variables look good!${NC}"
elif (( ISSUES <= 2 )); then
  SCORE=8
elif (( ISSUES <= 5 )); then
  SCORE=5
else
  SCORE=2
fi

echo ""
echo -e "  ${DIM}Total keys checked: $TOTAL_KEYS${NC}"
echo -e "  Score: ${BOLD}$SCORE/$MAX_SCORE${NC} ${DIM}($ISSUES issues found)${NC}"
echo ""

if $STRICT && (( ISSUES > 0 )); then
  echo -e "  ${RED}✖  Strict mode: exiting with error ($ISSUES issues)${NC}"
  exit 1
fi
