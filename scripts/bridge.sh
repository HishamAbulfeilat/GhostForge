#!/usr/bin/env bash
# GhostForge Mac Bridge — executes commands from the web UI
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'

BRIDGE_DIR="$HOME/.ghostforge/bridge"
PID_FILE="$BRIDGE_DIR/bridge.pid"
TOKEN_FILE="$BRIDGE_DIR/token"
LOG_FILE="$BRIDGE_DIR/bridge.log"
PORT=4747

mkdir -p "$BRIDGE_DIR"

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

start_cmd() {
  print_header
  if [[ -f "$PID_FILE" ]] && kill -0 "$(head -1 "$PID_FILE")" 2>/dev/null; then
    echo -e "${YELLOW}⚠ Bridge already running (PID $(head -1 "$PID_FILE"))${NC}"
    [[ -f "$TOKEN_FILE" ]] && echo -e "${DIM}  Token: $(cat "$TOKEN_FILE")${NC}"
    return
  fi

  rm -f "$PID_FILE" "$BRIDGE_DIR/server.ready"
  : > "$LOG_FILE"

  local token
  token="$(generate_token)"
  echo "$token" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"

  BRIDGE_TOKEN_FILE="$TOKEN_FILE" \
  BRIDGE_ROOT="$HOME/GhostForge" \
  BRIDGE_READY_FILE="$BRIDGE_DIR/server.ready" \
  BRIDGE_PORT="$PORT" \
  nohup node - <<'NODESERVER' >> "$LOG_FILE" 2>&1 &
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const token = fs.readFileSync(process.env.BRIDGE_TOKEN_FILE, 'utf8').trim();
const ROOT = process.env.BRIDGE_ROOT;
const READY_FILE = process.env.BRIDGE_READY_FILE;
const PORT = Number(process.env.BRIDGE_PORT || 4747);
const FORBIDDEN_PATTERN = /[;&|><`$\n\r]/;

function respond(res, status, payload) {
  res.writeHead(status);
  res.end(JSON.stringify(payload));
}

function isAllowedCommand(command) {
  if (typeof command !== 'string') return false;
  const trimmed = command.trim();
  if (FORBIDDEN_PATTERN.test(trimmed)) return false;
  if (trimmed.startsWith('ghostforge ')) return true;
  if (trimmed.startsWith('gh copilot -p ')) return true;
  return false;
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    respond(res, 200, { status: 'online', name: 'GhostForge Mac Bridge' });
    return;
  }

  if (req.url === '/copilot' && req.method === 'POST') {
    const auth = req.headers.authorization;
    if (auth !== 'Bearer ' + token) {
      respond(res, 401, { error: 'Unauthorized' });
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const prompt = (payload.prompt || '').trim();
        const mode = (payload.mode || 'suggest').trim();
        if (!prompt || FORBIDDEN_PATTERN.test(prompt)) {
          respond(res, 400, { error: 'Invalid prompt' });
          return;
        }
        const escaped = prompt.replace(/"/g, '\\"');
        const cmd = 'gh copilot -p "' + escaped + '" --allow-all --allow-all-paths --add-dir ' + ROOT + ' -s';

        const output = execSync(cmd, {
          cwd: ROOT,
          timeout: 60000,
          input: 'exit\n',
          env: Object.assign({}, process.env, {
            PATH: (process.env.PATH || '') + ':/usr/local/bin:/opt/homebrew/bin',
            HOME: process.env.HOME || require('os').homedir(),
            GH_NO_UPDATE_NOTIFIER: '1',
            NO_COLOR: '1'
          }),
        }).toString().trim();

        respond(res, 200, { output: output, mode: mode, prompt: prompt });
      } catch (error) {
        const raw = (error && error.stdout) ? error.stdout.toString() : (error instanceof Error ? error.message : String(error));
        respond(res, 200, { output: raw.trim(), error: true });
      }
    });
    return;
  }

  if (req.url === '/execute' && req.method === 'POST') {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${token}`) {
      respond(res, 401, { error: 'Unauthorized' });
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const command = payload.command;
        if (!isAllowedCommand(command)) {
          respond(res, 403, { error: 'Only plain ghostforge commands are allowed' });
          return;
        }

        const output = execSync(command, {
          cwd: ROOT,
          timeout: 30000,
          env: { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin:/opt/homebrew/bin' },
        }).toString().trim();

        respond(res, 200, { output, command });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        respond(res, 200, { output: message, error: true });
      }
    });
    return;
  }

  respond(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  fs.writeFileSync(READY_FILE, '1');
  console.log(`GhostForge bridge listening on port ${PORT}`);
});
NODESERVER

  local server_pid=$!
  printf '%s\n' "$server_pid" > "$PID_FILE"

  # Start TTY web terminal for /terminal page
  local ttyd_bin
  ttyd_bin="$(which ttyd 2>/dev/null || echo '/opt/homebrew/bin/ttyd')"
  if command -v ttyd >/dev/null 2>&1; then
    nohup ttyd \
      --port 4748 \
      --credential "ghostforge:$token" \
      --writable \
      node "$HOME/GhostForge/tui/index.js" >> "$LOG_FILE" 2>&1 &
    local ttyd_pid=$!
    printf '%s\n' "$ttyd_pid" >> "$PID_FILE"
    sleep 1
    echo -e "${DIM}  TTY terminal: http://localhost:4748 (PID $ttyd_pid)${NC}"
  else
    echo -e "${YELLOW}⚠ ttyd not found — install: brew install ttyd${NC}"
  fi

  local waited=0
  while [[ ! -f "$BRIDGE_DIR/server.ready" ]] && [[ $waited -lt 10 ]]; do
    sleep 1
    waited=$((waited + 1))
  done

  echo -e "${GREEN}✅ Bridge server running on port $PORT (PID $server_pid)${NC}"
  echo -e "${DIM}  Token: $token${NC}"
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
      echo -e "${GREEN}${BOLD}│  $(cut -c 1-20 "$TOKEN_FILE")...${NC}"
      echo -e "${GREEN}${BOLD}└─────────────────────────────────────────────┘${NC}"
      echo ""
      echo -e "${CYAN}Add to Vercel env vars:${NC}"
      echo -e "  WS_BRIDGE_URL=${tunnel_url}"
      echo -e "  WS_BRIDGE_TOKEN=$(cat "$TOKEN_FILE")"
    else
      echo -e "${YELLOW}⚠ Tunnel URL not detected yet — check $LOG_FILE${NC}"
      echo -e "${CYAN}  Local URL: http://localhost:$PORT${NC}"
    fi
  else
    echo -e "${YELLOW}⚠ cloudflared not installed — bridge accessible locally only${NC}"
    echo -e "${CYAN}  Install: brew install cloudflared${NC}"
    echo -e "${CYAN}  Local URL: http://localhost:$PORT${NC}"
    echo -e "${DIM}  Token: $token${NC}"
  fi

  echo ""
  echo -e "${DIM}  Stop: ghostforge bridge stop${NC}"
  echo -e "${DIM}  Logs: $LOG_FILE${NC}"
}

stop_cmd() {
  print_header
  if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE" "$BRIDGE_DIR/server.ready"
    echo -e "${GREEN}✅ Bridge stopped${NC}"
  else
    echo -e "${YELLOW}⚠ Bridge not running${NC}"
  fi
}

status_cmd() {
  print_header
  if [[ -f "$PID_FILE" ]] && kill -0 "$(head -1 "$PID_FILE")" 2>/dev/null; then
    echo -e "${GREEN}✅ Bridge is RUNNING${NC}"
    echo -e "${DIM}  PID: $(tr '\n' ' ' < "$PID_FILE")${NC}"
    echo -e "${DIM}  Token: $(cat "$TOKEN_FILE" 2>/dev/null || echo 'not found')${NC}"
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
