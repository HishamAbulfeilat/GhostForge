#!/usr/bin/env bash
set -euo pipefail
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'

print_header() {
  echo -e "${CYAN}${BOLD}\n  🌐  GhostForge Tunnel\n  Cloudflare tunnel for remote access\n${NC}"
}

TUNNEL_PID="$HOME/.ghostforge/tunnel/tunnel.pid"
TUNNEL_LOG="$HOME/.ghostforge/tunnel/tunnel.log"
mkdir -p "$HOME/.ghostforge/tunnel"

start_cmd() {
  print_header
  local port="${1:-3000}"
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo -e "${YELLOW}Installing cloudflared...${NC}"
    brew install cloudflared 2>/dev/null || \
      echo -e "${YELLOW}⚠ Install manually: brew install cloudflared${NC}"
  fi
  echo -e "${CYAN}Starting tunnel for port $port...${NC}"
  nohup cloudflared tunnel --url "http://localhost:$port" >> "$TUNNEL_LOG" 2>&1 &
  echo $! > "$TUNNEL_PID"
  sleep 3
  local url
  url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1 || true)"
  if [[ -n "$url" ]]; then
    echo -e "${GREEN}✅ Tunnel active: $url${NC}"
    echo -e "${DIM}  Points to: http://localhost:$port${NC}"
  else
    echo -e "${YELLOW}⚠ URL not yet available — check: $TUNNEL_LOG${NC}"
  fi
}

stop_cmd() {
  if [[ -f "$TUNNEL_PID" ]] && kill "$(cat "$TUNNEL_PID")" 2>/dev/null; then
    rm -f "$TUNNEL_PID"
    echo -e "${GREEN}✅ Tunnel stopped${NC}"
  else
    echo -e "${YELLOW}Not running${NC}"
  fi
}

status_cmd() {
  if [[ -f "$TUNNEL_PID" ]] && kill -0 "$(cat "$TUNNEL_PID")" 2>/dev/null; then
    local url
    url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1 || echo 'unknown')"
    echo -e "${GREEN}✅ Tunnel RUNNING: $url${NC}"
  else
    echo -e "${YELLOW}Tunnel not running${NC}"
  fi
}

case "${1:-help}" in
  start) shift; start_cmd "${1:-3000}" ;;
  stop) stop_cmd ;;
  status) status_cmd ;;
  *) print_header; echo "Usage: ghostforge tunnel <start [port]|stop|status>" ;;
esac
