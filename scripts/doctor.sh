#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GhostForge Doctor — comprehensive health check
# Usage: ghostforge doctor [--fix] [--json]
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

GHOSTFORGE_ROOT="${GHOSTFORGE_ROOT:-$HOME/GhostForge}"
WEBUI_DIR="$GHOSTFORGE_ROOT/web-ui"
ENV_FILE="$WEBUI_DIR/.env.local"
BRIDGE_DIR="$HOME/.ghostforge/bridge"
ROUTES_CONFIG="$WEBUI_DIR/routes.config.json"

# ── Flags ────────────────────────────────────────────────────────────────────
FIX_MODE=false
JSON_MODE=false
for arg in "$@"; do
  case $arg in --fix) FIX_MODE=true ;; --json) JSON_MODE=true ;; esac
done

# ── Colors ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]] && ! $JSON_MODE; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
  CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; CYAN=''; BOLD=''; DIM=''; NC=''
fi

# ── State ────────────────────────────────────────────────────────────────────
PASS=0; WARN=0; FAIL=0
declare -a RESULTS=()

# ── Helpers ──────────────────────────────────────────────────────────────────
pass()  { PASS=$((PASS+1));  RESULTS+=("PASS|$1|$2|"); }
warn()  { WARN=$((WARN+1));  RESULTS+=("WARN|$1|$2|$3"); }
fail()  { FAIL=$((FAIL+1));  RESULTS+=("FAIL|$1|$2|$3"); }

env_val() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true; }

check_url() {
  local url=$1 timeout=${2:-3}
  curl -sf --max-time "$timeout" "$url" -o /dev/null 2>/dev/null
}

# ─────────────────────────────────────────────────────────────────────────────
# CHECKS
# ─────────────────────────────────────────────────────────────────────────────

section() { [[ -t 1 ]] && ! $JSON_MODE && echo -e "\n${BOLD}${CYAN}── $1 ──${NC}"; return 0; }

# ── 1. Folder structure ──────────────────────────────────────────────────────
section "Folder Structure"

if [[ -d "$GHOSTFORGE_ROOT" ]]; then
  pass "Root folder" "$GHOSTFORGE_ROOT exists"
else
  fail "Root folder" "$GHOSTFORGE_ROOT not found" "Clone: git clone https://github.com/HishamAbulfeilat/GhostForge.git ~/GhostForge"
fi

for dir in web-ui scripts tui marketplace instructions commands; do
  if [[ -d "$GHOSTFORGE_ROOT/$dir" ]]; then
    pass "Dir: $dir" "found"
  else
    fail "Dir: $dir" "missing" "Missing expected directory $GHOSTFORGE_ROOT/$dir"
  fi
done

if [[ -f "$ROUTES_CONFIG" ]]; then
  pass "routes.config.json" "found"
else
  warn "routes.config.json" "missing" "Run: ghostforge doctor to regenerate"
fi

# ── 2. .env.local ────────────────────────────────────────────────────────────
section ".env.local Config"

if [[ -f "$ENV_FILE" ]]; then
  pass ".env.local" "file exists"

  REQUIRED_KEYS=("ACCESS_PIN" "AUTH_SECRET")
  OPTIONAL_KEYS=("GOOGLE_GENERATIVE_AI_API_KEY" "OPENROUTER_API_KEY" "GROQ_API_KEY" "GEMINI_MODEL" "WS_BRIDGE_URL" "WS_BRIDGE_TOKEN")

  for key in "${REQUIRED_KEYS[@]}"; do
    val=$(env_val "$key")
    if [[ -n "$val" ]]; then
      pass "env: $key" "set (${#val} chars)"
    else
      fail "env: $key" "not set" "Add $key=your_value to $ENV_FILE"
    fi
  done

  for key in "${OPTIONAL_KEYS[@]}"; do
    val=$(env_val "$key")
    if [[ -n "$val" ]]; then
      pass "env: $key" "set"
    else
      warn "env: $key" "not set (optional)" "Add $key to $ENV_FILE for full functionality"
    fi
  done
else
  fail ".env.local" "missing" "Copy example: cp $WEBUI_DIR/.env.example $ENV_FILE"
fi

# ── 3. Web UI ────────────────────────────────────────────────────────────────
section "Web UI Pages"

WEBUI_PORT=3001
if [[ -f "$WEBUI_DIR/package.json" ]]; then
  pass "web-ui/package.json" "found"
else
  fail "web-ui/package.json" "missing" "cd $WEBUI_DIR && npm install"
fi

if [[ -d "$WEBUI_DIR/node_modules" ]]; then
  pass "node_modules" "installed"
else
  fail "node_modules" "not installed" "cd $WEBUI_DIR && npm install"
fi

# Check page files from routes.config.json
if command -v node >/dev/null 2>&1 && [[ -f "$ROUTES_CONFIG" ]]; then
  while IFS= read -r page; do
    page_file="$WEBUI_DIR/app/$page"
    if [[ -f "$page_file" ]]; then
      pass "page: $page" "found"
    else
      warn "page: $page" "missing" "Create $page_file"
    fi
  done < <(node -e "const r=require('$ROUTES_CONFIG'); r.routes.forEach(x=>x.page&&console.log(x.page))" 2>/dev/null)
fi

# Web UI live check
if check_url "http://localhost:$WEBUI_PORT" 2; then
  pass "Web UI live" "responding on port $WEBUI_PORT"
else
  warn "Web UI live" "not running on port $WEBUI_PORT" "cd $WEBUI_DIR && npm run dev -- --hostname 0.0.0.0 --port $WEBUI_PORT"
fi

# ── 4. Bridge ────────────────────────────────────────────────────────────────
section "Mac Bridge"

if [[ -f "$BRIDGE_DIR/token" ]]; then
  TOKEN_AGE=$(( ($(date +%s) - $(stat -f%m "$BRIDGE_DIR/token" 2>/dev/null || echo 0)) / 60 ))
  pass "Bridge token" "exists (~${TOKEN_AGE}m old)"
else
  warn "Bridge token" "no token file" "Start bridge: bash $GHOSTFORGE_ROOT/scripts/bridge.sh start"
fi

if check_url "http://localhost:4747/health" 2; then
  pass "Bridge (4747)" "online"
else
  fail "Bridge (4747)" "offline" "Run: bash $GHOSTFORGE_ROOT/scripts/bridge.sh start"
fi

if check_url "http://localhost:4748/health" 2; then
  pass "PTY terminal (4748)" "online"
else
  warn "PTY terminal (4748)" "offline" "Bridge start also launches the PTY server. Run: bash $GHOSTFORGE_ROOT/scripts/bridge.sh start"
fi

if [[ -f "$BRIDGE_DIR/bridge.log" ]]; then
  RECENT_ERRORS=$(grep -c "ERROR\|error\|failed" "$BRIDGE_DIR/bridge.log" 2>/dev/null || true)
  if [[ "$RECENT_ERRORS" -gt 0 ]]; then
    warn "Bridge log" "$RECENT_ERRORS error lines found" "Check: tail -50 $BRIDGE_DIR/bridge.log"
  else
    pass "Bridge log" "no errors"
  fi
fi

# ── 5. AI Model Connectivity ─────────────────────────────────────────────────
section "AI Model Connectivity"

GEMINI_KEY=$(env_val "GOOGLE_GENERATIVE_AI_API_KEY")
GEMINI_MODEL=$(env_val "GEMINI_MODEL")
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-pro}"
OR_KEY=$(env_val "OPENROUTER_API_KEY")

if [[ -n "$GEMINI_KEY" ]]; then
  HTTP=$(curl -s --max-time 5 \
    -H "x-goog-api-key: $GEMINI_KEY" \
    -H "Content-Type: application/json" \
    -d '{"contents":[{"parts":[{"text":"ping"}]}],"generationConfig":{"maxOutputTokens":5}}' \
    "https://generativelanguage.googleapis.com/v1beta/models/$GEMINI_MODEL:generateContent" \
    -o /dev/null -w "%{http_code}" 2>/dev/null) || HTTP="000"
  [[ -z "$HTTP" ]] && HTTP="000"
  if [[ "$HTTP" == "200" ]]; then
    pass "Gemini ($GEMINI_MODEL)" "API reachable (HTTP 200)"
  elif [[ "$HTTP" == "429" ]]; then
    warn "Gemini ($GEMINI_MODEL)" "quota exceeded (HTTP 429)" "Check quota at aistudio.google.com or switch model in /settings"
  else
    fail "Gemini ($GEMINI_MODEL)" "unreachable (HTTP $HTTP)" "Check GOOGLE_GENERATIVE_AI_API_KEY in .env.local"
  fi
else
  warn "Gemini" "no API key" "Add GOOGLE_GENERATIVE_AI_API_KEY to $ENV_FILE"
fi

if [[ -n "$OR_KEY" ]]; then
  HTTP=$(curl -s --max-time 5 \
    -H "Authorization: Bearer $OR_KEY" \
    "https://openrouter.ai/api/v1/models" \
    -o /dev/null -w "%{http_code}" 2>/dev/null ) || HTTP="000"
  [[ -z "$HTTP" ]] && HTTP="000"
  if [[ "$HTTP" == "200" ]]; then
    pass "OpenRouter" "API reachable (HTTP 200)"
  else
    fail "OpenRouter" "unreachable (HTTP $HTTP)" "Check OPENROUTER_API_KEY in .env.local"
  fi
else
  warn "OpenRouter" "no API key (fallback unavailable)" "Add OPENROUTER_API_KEY to $ENV_FILE"
fi

# GitHub Copilot CLI
if command -v gh >/dev/null 2>&1; then
  pass "gh CLI" "installed ($(gh --version 2>/dev/null | head -1))"
  if gh auth status >/dev/null 2>&1; then
    pass "gh auth" "authenticated"
    if gh copilot --version >/dev/null 2>&1; then
      pass "gh copilot" "installed ($(gh copilot --version 2>/dev/null | head -1))"
    else
      warn "gh copilot" "not installed" "Run: gh extension install github/gh-copilot"
    fi
  else
    warn "gh auth" "not authenticated" "Run: gh auth login"
  fi
else
  warn "gh CLI" "not installed" "Install: brew install gh"
fi

# ── 6. Installed Skills & Tools ───────────────────────────────────────────────
section "Installed Skills & Tools"

# react-doctor
if npx react-doctor@latest --version >/dev/null 2>&1 || command -v react-doctor >/dev/null 2>&1; then
  pass "react-doctor" "available"
else
  warn "react-doctor" "not cached" "It will auto-install via npx. Pre-install: npm install -g react-doctor"
fi

# ttyd
if command -v ttyd >/dev/null 2>&1; then
  pass "ttyd" "installed ($(ttyd --version 2>/dev/null || echo 'unknown version'))"
else
  fail "ttyd" "not installed" "Install: brew install ttyd"
fi

# node
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version)
  MAJOR=$(echo "$NODE_VER" | tr -d 'v' | cut -d. -f1)
  if [[ "$MAJOR" -ge 18 ]]; then
    pass "Node.js" "$NODE_VER"
  else
    warn "Node.js" "$NODE_VER (recommend ≥18)" "Install newer version: nvm install 20"
  fi
else
  fail "Node.js" "not found" "Install: brew install node"
fi

# git
if command -v git >/dev/null 2>&1; then
  pass "git" "$(git --version)"
else
  fail "git" "not installed" "Install: brew install git"
fi

# ── 7. Summary ───────────────────────────────────────────────────────────────

TOTAL=$((PASS + WARN + FAIL))

if $JSON_MODE; then
  # JSON output
  echo '{'
  echo "  \"version\": \"$(node -e "console.log(require('$GHOSTFORGE_ROOT/package.json').version)" 2>/dev/null || echo 'unknown')\","
  echo "  \"pass\": $PASS, \"warn\": $WARN, \"fail\": $FAIL, \"total\": $TOTAL,"
  echo '  "results": ['
  for i in "${!RESULTS[@]}"; do
    IFS='|' read -r status label detail fix <<< "${RESULTS[$i]}"
    COMMA=","
    [[ $i -eq $((${#RESULTS[@]}-1)) ]] && COMMA=""
    echo "    {\"status\":\"$status\",\"label\":\"$label\",\"detail\":\"$detail\",\"fix\":\"$fix\"}$COMMA"
  done
  echo '  ]'
  echo '}'
  exit $([[ $FAIL -eq 0 ]] && echo 0 || echo 1)
fi

echo ""
echo -e "${BOLD}── GhostForge Doctor Report ──────────────────────────────${NC}"
echo ""

# Print all results
for result in "${RESULTS[@]}"; do
  IFS='|' read -r status label detail fix <<< "$result"
  case "$status" in
    PASS) echo -e "  ${GREEN}✓${NC} ${label}  ${DIM}${detail}${NC}" ;;
    WARN) echo -e "  ${YELLOW}⚠${NC} ${label}  ${DIM}${detail}${NC}"
          [[ -n "$fix" ]] && echo -e "    ${DIM}→ ${fix}${NC}" ;;
    FAIL) echo -e "  ${RED}✗${NC} ${BOLD}${label}${NC}  ${detail}"
          [[ -n "$fix" ]] && echo -e "    ${RED}→ ${fix}${NC}" ;;
  esac
done

echo ""
echo -e "  ${DIM}──────────────────────────────────────────────────────${NC}"

if [[ $FAIL -eq 0 && $WARN -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}✅ All $TOTAL checks passed!${NC} GhostForge is fully operational."
elif [[ $FAIL -eq 0 ]]; then
  echo -e "  ${YELLOW}${BOLD}⚠ $PASS passed · $WARN warnings · 0 failures${NC}"
  echo -e "  ${DIM}GhostForge is running. Fix warnings for full functionality.${NC}"
else
  echo -e "  ${RED}${BOLD}✗ $PASS passed · $WARN warnings · $FAIL failures${NC}"
  echo -e "  ${DIM}Fix the issues above, then re-run: ghostforge doctor${NC}"
fi

echo ""
if $FIX_MODE && [[ $FAIL -gt 0 || $WARN -gt 0 ]]; then
  echo -e "${BOLD}${CYAN}── Auto-Fix ───────────────────────────────────────────${NC}"
  if ! check_url "http://localhost:4747/health" 2; then
    echo -e "  Starting bridge..."
    bash "$GHOSTFORGE_ROOT/scripts/bridge.sh" start
  fi
  if [[ ! -d "$WEBUI_DIR/node_modules" ]]; then
    echo -e "  Installing web-ui dependencies..."
    (cd "$WEBUI_DIR" && npm install --silent)
  fi
  echo -e "  ${GREEN}Auto-fix complete. Re-run: ghostforge doctor${NC}"
fi

exit $([[ $FAIL -eq 0 ]] && echo 0 || echo 1)
