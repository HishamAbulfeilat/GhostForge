#!/usr/bin/env bash
# GhostForge Mac Bridge — executes commands from the web UI
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'

BRIDGE_DIR="$HOME/.ghostforge/bridge"
PID_FILE="$BRIDGE_DIR/bridge.pid"
TOKEN_FILE="$BRIDGE_DIR/token"
LOG_FILE="$BRIDGE_DIR/bridge.log"
PORT=4747
BRIDGE_ROOT="${BRIDGE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

mkdir -p "$BRIDGE_DIR"

# ── Port-based process discovery (self-healing) ────────────────────────────
# PID files go stale (orphaned wrappers, reboots, manual kills). The port is
# the source of truth: whatever listens on $PORT IS the bridge.
port_pids() {
  # netstat -ano works on Windows (Git Bash), macOS and Linux
  # Columns: Proto  Local  Foreign  State  PID  (state may be absent on Linux)
  netstat -ano 2>/dev/null | awk -v p="${PORT}" '$1 == "TCP" && $2 ~ ":"p"$" && ($4 == "LISTENING" || $0 ~ /LISTEN/) {print $NF}' | sort -u
}

port_listening() {
  [[ -n "$(port_pids)" ]]
}

port_owner_is_ours() {
  # Verify the port owner is a node process before killing it (defensive).
  local pid
  for pid in $(port_pids); do
    if command -v powershell >/dev/null 2>&1 && powershell -NoProfile -Command "try { \$p = Get-Process -Id $pid -ErrorAction Stop; if (\$p.ProcessName -eq 'node') { exit 0 } } catch { exit 1 }" >/dev/null 2>&1; then
      return 0
    elif ps -p "$pid" -o comm= 2>/dev/null | grep -q node; then
      return 0
    fi
  done
  return 1
}

print_header() {
  echo -e "${CYAN}${BOLD}"
  echo "  🔌  GhostForge Mac Bridge"
  echo "  Remote command execution server"
  echo -e "${NC}"
}

generate_token() {
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || \
  openssl rand -hex 32 2>/dev/null || \
  date +%s | shasum -a 256 | awk '{print $1}' | cut -c 1-64
}

# Print only a fingerprint (first 6 chars) of the token, never the full value.
token_fingerprint() {
  if [[ -f "$TOKEN_FILE" ]]; then
    printf '%s' "$(cut -c 1-6 "$TOKEN_FILE")…"
  else
    printf '%s' 'not found'
  fi
}

start_cmd() {
  print_header
  if port_listening; then
    echo -e "${YELLOW}⚠ Bridge already running on port $PORT ($(port_pids | tr '\n' ' '))${NC}"
    [[ -f "$TOKEN_FILE" ]] && echo -e "${DIM}  Token: $(token_fingerprint)${NC}"
    # Heal the PID file so stop/status work even if it went stale.
    port_pids | head -1 > "$PID_FILE"
    return
  fi

  rm -f "$PID_FILE" "$BRIDGE_DIR/server.ready"
  : > "$LOG_FILE"

  local token
  token="$(generate_token)"
  echo "$token" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"

  BRIDGE_TOKEN_FILE="$TOKEN_FILE" \
  BRIDGE_ROOT="$BRIDGE_ROOT" \
  BRIDGE_READY_FILE="$BRIDGE_DIR/server.ready" \
  BRIDGE_PORT="$PORT" \
  BRIDGE_TOKEN_FILE="$TOKEN_FILE"   BRIDGE_ROOT="$BRIDGE_ROOT"   BRIDGE_READY_FILE="$BRIDGE_DIR/server.ready"   BRIDGE_PORT="$PORT"   nohup node "$BRIDGE_ROOT/scripts/bridge-server.js" >> "$LOG_FILE" 2>&1 &

  local server_pid=$!
  printf '%s\n' "$server_pid" > "$PID_FILE"

  # Start the authenticated PTY WebSocket server used by /terminal.
  # The previous ttyd process used Basic Auth, while the web client sends the
  # bridge token as a query parameter, so quick commands never connected.
  local pty_server="$BRIDGE_ROOT/scripts/pty-server.js"
  if [[ -f "$pty_server" ]] && node -e "require('node-pty'); require('ws')" >/dev/null 2>&1; then
    nohup env \
      PTY_PORT=4748 \
      BRIDGE_ROOT="$BRIDGE_ROOT" \
      BRIDGE_TOKEN_FILE="$TOKEN_FILE" \
      node "$pty_server" >> "$LOG_FILE" 2>&1 &
    local pty_pid=$!
    printf '%s\n' "$pty_pid" >> "$PID_FILE"
    sleep 1
    echo -e "${DIM}  PTY terminal: http://localhost:4748 (PID $pty_pid)${NC}"
  else
    echo -e "${YELLOW}⚠ PTY dependencies missing — run npm install in $HOME/GhostForge${NC}"
  fi

  local waited=0
  while [[ ! -f "$BRIDGE_DIR/server.ready" ]] && [[ $waited -lt 10 ]]; do
    sleep 1
    waited=$((waited + 1))
  done

  echo -e "${GREEN}✅ Bridge server running on port $PORT (PID $server_pid)${NC}"
  echo -e "${DIM}  Token: $(token_fingerprint)${NC}"
  echo ""

  if command -v cloudflared >/dev/null 2>&1; then
    echo -e "${CYAN}🌐 Starting Cloudflare tunnel...${NC}"
    nohup cloudflared tunnel --url "http://localhost:$PORT" >> "$LOG_FILE" 2>&1 &
    local tunnel_pid=$!
    printf '%s\n' "$tunnel_pid" >> "$PID_FILE"

    echo -e "${DIM}  Waiting for tunnel URL (up to 15s)...${NC}"
    local t=0
    local tunnel_url=""
    while [[ $t -lt 15 ]] && [[ -z "$tunnel_url" ]]; do
      sleep 1
      t=$((t + 1))
      tunnel_url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -1 || true)"
    done

    if [[ -n "$tunnel_url" ]]; then
      echo ""
      echo -e "${GREEN}${BOLD}┌─────────────────────────────────────────────┐${NC}"
      echo -e "${GREEN}${BOLD}│  🌐 Tunnel URL (add to Vercel):              │${NC}"
      echo -e "${GREEN}${BOLD}│  $tunnel_url${NC}"
      echo -e "${GREEN}${BOLD}│  🔑 Bridge Token (add to Vercel):            │${NC}"
      echo -e "${GREEN}${BOLD}│  $(token_fingerprint)${NC}"
      echo -e "${GREEN}${BOLD}└─────────────────────────────────────────────┘${NC}"
      echo ""
      echo -e "${CYAN}Add to Vercel env vars:${NC}"
      echo -e "  WS_BRIDGE_URL=${tunnel_url}"
      echo -e "  WS_BRIDGE_TOKEN=$(token_fingerprint) (full token in $TOKEN_FILE)"
    else
      echo -e "${YELLOW}⚠ Tunnel URL not detected yet — check $LOG_FILE${NC}"
      echo -e "${CYAN}  Local URL: http://localhost:$PORT${NC}"
    fi
  else
    echo -e "${YELLOW}⚠ cloudflared not installed — bridge accessible locally only${NC}"
    echo -e "${CYAN}  Install: brew install cloudflared${NC}"
    echo -e "${CYAN}  Local URL: http://localhost:$PORT${NC}"
    echo -e "${DIM}  Token: $(token_fingerprint)${NC}"
  fi

  echo ""
  echo -e "${DIM}  Stop: ghostforge bridge stop${NC}"
  echo -e "${DIM}  Logs: $LOG_FILE${NC}"
}

stop_cmd() {
  print_header
  local stopped=0

  # 1) Kill whatever is actually listening on the port (source of truth).
  if port_listening; then
    local pid
    for pid in $(port_pids); do
      if port_owner_is_ours; then
        taskkill //PID "$pid" //F 2>/dev/null || kill "$pid" 2>/dev/null || true
      fi
      stopped=1
    done
  fi

  # 2) Also kill PIDs tracked in the PID file (PTY server, tunnel, etc.).
  if [[ -f "$PID_FILE" ]]; then
    local pid
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    stopped=1
  fi

  rm -f "$PID_FILE" "$BRIDGE_DIR/server.ready"

  if [[ $stopped -eq 1 ]]; then
    sleep 1
    if port_listening; then
      echo -e "${RED}✗ Bridge still responding on port $PORT — kill PID(s): $(port_pids | tr '\n' ' ')${NC}"
    else
      echo -e "${GREEN}✅ Bridge stopped${NC}"
    fi
  else
    echo -e "${YELLOW}⚠ Bridge not running${NC}"
  fi
}

status_cmd() {
  print_header
  if port_listening; then
    echo -e "${GREEN}✅ Bridge is RUNNING${NC}"
    echo -e "${DIM}  PID: $(port_pids | tr '\n' ' ')${NC}"
    [[ -f "$TOKEN_FILE" ]] && echo -e "${DIM}  Token: $(token_fingerprint)${NC}"
    local tunnel_url
    tunnel_url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -1 || true)"
    [[ -n "$tunnel_url" ]] && echo -e "${CYAN}  Tunnel: $tunnel_url${NC}"
  else
    echo -e "${RED}✗ Bridge is NOT running${NC}"
    echo -e "${DIM}  Start: ghostforge bridge start${NC}"
  fi
}

token_cmd() {
  if [[ -f "$TOKEN_FILE" ]]; then
    cat "$TOKEN_FILE"
  else
    echo -e "${RED}No token found — run: ghostforge bridge start${NC}"
  fi
}

help_cmd() {
  cat <<'HELP'
Usage: ghostforge bridge <command>

Commands:
  start     Start the Mac bridge server + Cloudflare tunnel
  stop      Stop the bridge
  status    Show bridge status + tunnel URL
  token     Print the bridge auth token
  help      Show this help

Setup:
  1. Run: ghostforge bridge start
  2. Copy the tunnel URL and token shown
  3. Add to Vercel: WS_BRIDGE_URL=https://xxx.trycloudflare.com
  4. Add to Vercel: WS_BRIDGE_TOKEN=<token>
  5. Done — web UI can now run commands on this Mac
HELP
}

ACTION="${1:-help}"
shift || true
case "$ACTION" in
  start) start_cmd ;;
  stop) stop_cmd ;;
  status) status_cmd ;;
  token) token_cmd ;;
  help|--help|-h) help_cmd ;;
  *) echo "Unknown command: $ACTION. Run: ghostforge bridge help" ;;
esac
