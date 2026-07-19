#!/usr/bin/env bash
set -euo pipefail
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

print_header() {
  echo -e "${CYAN}${BOLD}\n  ✨  GhostForge Gemini Integration\n  Google AI — free tier available\n${NC}"
}

setup_cmd() {
  print_header
  echo -e "${CYAN}1. Get your free Gemini API key:${NC}"
  echo "   https://aistudio.google.com/app/apikey"
  echo ""
  echo -e "${CYAN}2. Add to your project .env.local:${NC}"
  echo "   GOOGLE_GENERATIVE_AI_API_KEY=AIza..."
  echo ""
  echo -e "${CYAN}3. Available free models:${NC}"
  echo "   gemini-2.0-flash-exp  (fastest, recommended)"
  echo "   gemini-1.5-flash      (stable)"
  echo "   gemini-1.5-pro        (most capable, limited quota)"
  if command -v open >/dev/null 2>&1; then
    read -r -p "Open aistudio.google.com now? [y/N] " reply
    if [[ "$reply" =~ ^[Yy]$ ]]; then
      open "https://aistudio.google.com/app/apikey"
    fi
  fi
}

test_cmd() {
  print_header
  local key="${GOOGLE_GENERATIVE_AI_API_KEY:-}"
  [[ -z "$key" ]] && key="$(grep -s '^GOOGLE_GENERATIVE_AI_API_KEY=' .env.local 2>/dev/null | cut -d= -f2- || true)"
  if [[ -z "$key" ]]; then
    echo -e "${YELLOW}⚠ GOOGLE_GENERATIVE_AI_API_KEY not set${NC}"
    echo "  Run: ghostforge gemini setup"
    return
  fi
  echo -e "${CYAN}Testing Gemini API connection...${NC}"
  local response
  response="$(curl -s -X POST \
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=$key" \
    -H "Content-Type: application/json" \
    -d '{"contents":[{"parts":[{"text":"Reply with exactly: GhostForge Gemini OK"}]}]}' 2>/dev/null)"
  if echo "$response" | grep -q "GhostForge Gemini OK"; then
    echo -e "${GREEN}✅ Gemini API working!${NC}"
  else
    echo -e "${YELLOW}⚠ Unexpected response — check your API key${NC}"
    echo "$response" | head -5
  fi
}

ask_cmd() {
  print_header
  local key="${GOOGLE_GENERATIVE_AI_API_KEY:-}"
  [[ -z "$key" ]] && key="$(grep -s '^GOOGLE_GENERATIVE_AI_API_KEY=' .env.local 2>/dev/null | cut -d= -f2- || true)"
  if [[ -z "$key" ]]; then
    echo -e "${YELLOW}⚠ Key not set. Run: ghostforge gemini setup${NC}"
    return
  fi
  local prompt="${*:-Hello from GhostForge}"
  echo -e "${CYAN}Asking Gemini: ${prompt}${NC}\n"
  curl -s -X POST \
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=$key" \
    -H "Content-Type: application/json" \
    -d "{\"contents\":[{\"parts\":[{\"text\":\"$prompt\"}]}]}" | \
    node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(data).candidates[0].content.parts[0].text)}catch{console.log(data)}})"
}

models_cmd() {
  print_header
  echo -e "${CYAN}Free Gemini models (aistudio.google.com):${NC}\n"
  echo "  gemini-2.0-flash-exp     Fastest, best for chat (FREE)"
  echo "  gemini-1.5-flash         Stable, production-ready (FREE)"
  echo "  gemini-1.5-pro           Most capable (FREE with quota)"
  echo "  gemini-1.0-pro           Legacy (FREE)"
  echo ""
  echo -e "${CYAN}Use in GhostForge web UI:${NC}"
  echo "  Set GOOGLE_GENERATIVE_AI_API_KEY in Vercel env vars"
}

case "${1:-help}" in
  setup) shift; setup_cmd ;;
  test) shift; test_cmd ;;
  ask) shift; ask_cmd "$@" ;;
  models) models_cmd ;;
  help|*) print_header; echo "Usage: ghostforge gemini <setup|test|ask <prompt>|models>" ;;
esac
