#!/usr/bin/env bash
set -euo pipefail

ROOT="$HOME/GhostForge"
WEB_UI="$ROOT/web-ui"
TEST_DIR="${GF_TEST_DIR:-$ROOT/.gfai-test}"
BASE_URL="http://localhost:3001"
COOKIE="gf_token="

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

cleanup() {
  rm -rf "$TEST_DIR"
}

trap cleanup EXIT

print_info() {
  printf "${BLUE}%s${NC}\n" "$1"
}

print_pass() {
  printf "${GREEN}PASS${NC} %s\n" "$1"
}

print_fail() {
  printf "${RED}FAIL${NC} %s\n" "$1"
}

run_test() {
  local name="$1"
  shift
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  if "$@"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    print_pass "$name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    print_fail "$name"
  fi
}

api_request() {
  local method="$1"
  local route="$2"
  local body="${3:-}"
  node - "$method" "$route" "$body" <<'NODE'
const http = require('http')

const [method, route, body] = process.argv.slice(2)
const payload = body || ''

const request = http.request({
  hostname: 'localhost',
  port: 3001,
  path: route,
  method,
  headers: {
    'Cookie': 'gf_token=',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
}, response => {
  let data = ''
  response.on('data', chunk => {
    data += chunk
  })
  response.on('end', () => {
    process.stdout.write(JSON.stringify({
      status: response.statusCode || 0,
      headers: response.headers,
      body: data,
    }))
  })
})

request.on('error', error => {
  process.stdout.write(JSON.stringify({
    status: 0,
    headers: {},
    body: '',
    error: error.message,
  }))
})

if (payload) request.write(payload)
request.end()
NODE
}

api_stream_request() {
  local route="$1"
  node - "$route" <<'NODE'
const http = require('http')

const [route] = process.argv.slice(2)

const request = http.request({
  hostname: 'localhost',
  port: 3001,
  path: route,
  method: 'GET',
  headers: {
    'Cookie': 'gf_token=',
  },
}, response => {
  let settled = false

  const finish = data => {
    if (settled) return
    settled = true
    process.stdout.write(JSON.stringify({
      status: response.statusCode || 0,
      headers: response.headers,
      body: data,
    }))
    request.destroy()
  }

  response.on('data', chunk => {
    finish(String(chunk))
  })

  response.on('end', () => finish(''))
})

request.setTimeout(4000, () => {
  process.stdout.write(JSON.stringify({
    status: 0,
    headers: {},
    body: '',
    error: 'timeout',
  }))
  request.destroy()
})

request.on('error', error => {
  process.stdout.write(JSON.stringify({
    status: 0,
    headers: {},
    body: '',
    error: error.message,
  }))
})

request.end()
NODE
}

assert_json() {
  local response="$1"
  local script="$2"
  RESPONSE="$response" node -e "$script"
}

prepare_dummy_files() {
  mkdir -p "$TEST_DIR/docs" "$TEST_DIR/src"
  printf 'ghostforge smoke test\n' > "$TEST_DIR/docs/readme.txt"
  printf 'export const answer = 42;\n' > "$TEST_DIR/src/sample.ts"
}

test_server_up() {
  local response
  response="$(api_request GET /api/doctor)"
  assert_json "$response" '
    const res = JSON.parse(process.env.RESPONSE || "{}")
    process.exit(res.status === 200 ? 0 : 1)
  '
}

test_jarvis_time() {
  local response
  response="$(api_request POST /api/jarvis '{"message":"what time is it"}')"
  assert_json "$response" '
    const res = JSON.parse(process.env.RESPONSE || "{}")
    const body = JSON.parse(res.body || "{}")
    const ok = res.status === 200 && typeof body.speech === "string" && body.speech.length > 0
    process.exit(ok ? 0 : 1)
  '
}

test_jarvis_math() {
  local response
  response="$(api_request POST /api/jarvis '{"message":"what is 2+2"}')"
  assert_json "$response" '
    const res = JSON.parse(process.env.RESPONSE || "{}")
    const body = JSON.parse(res.body || "{}")
    const text = `${body.speech || ""} ${body.toolResult || ""}`.toLowerCase()
    const ok = res.status === 200 && (/(^|[^0-9])4([^0-9]|$)/.test(text) || text.includes("four") || text.includes("equals"))
    process.exit(ok ? 0 : 1)
  '
}

test_models() {
  local response
  response="$(api_request GET /api/jarvis/models)"
  assert_json "$response" '
    const res = JSON.parse(process.env.RESPONSE || "{}")
    const body = JSON.parse(res.body || "{}")
    const ok = res.status === 200 && Array.isArray(body.models)
    process.exit(ok ? 0 : 1)
  '
}

test_doctor() {
  local response
  response="$(api_request GET /api/doctor)"
  assert_json "$response" '
    const res = JSON.parse(process.env.RESPONSE || "{}")
    const body = JSON.parse(res.body || "{}")
    const ok = res.status === 200 && Array.isArray(body.checks) && typeof body.total === "number"
    process.exit(ok ? 0 : 1)
  '
}

test_metrics() {
  local response
  response="$(api_stream_request /api/metrics)"
  assert_json "$response" '
    const res = JSON.parse(process.env.RESPONSE || "{}")
    const contentType = String(res.headers?.["content-type"] || "")
    const ok = res.status === 200 && contentType.includes("text/event-stream") && String(res.body || "").includes("data:")
    process.exit(ok ? 0 : 1)
  '
}

test_tool_get_time() {
  local response
  response="$(api_request POST /api/jarvis '{"message":"Use get_time and tell me the exact time only."}')"
  assert_json "$response" '
    const res = JSON.parse(process.env.RESPONSE || "{}")
    const body = JSON.parse(res.body || "{}")
    const ok = res.status === 200 && body.tool === "get_time" && typeof body.toolResult === "string" && body.toolResult.length > 0
    process.exit(ok ? 0 : 1)
  '
}

test_tool_get_weather() {
  local response
  response="$(api_request POST /api/jarvis '{"message":"Use get_weather for Amman and summarize it briefly."}')"
  assert_json "$response" '
    const res = JSON.parse(process.env.RESPONSE || "{}")
    const body = JSON.parse(res.body || "{}")
    const result = String(body.toolResult || "")
    const ok = res.status === 200 && body.tool === "get_weather" && result.length > 0 && !result.includes("No city provided") && !result.includes("temporarily unavailable")
    process.exit(ok ? 0 : 1)
  '
}

test_tool_web_search() {
  local response
  response="$(api_request POST /api/jarvis '{"message":"Use web_search to search for GhostForge developer toolkit and summarize the top result."}')"
  assert_json "$response" '
    const res = JSON.parse(process.env.RESPONSE || "{}")
    const body = JSON.parse(res.body || "{}")
    const ok = res.status === 200 && ["web_search", "google_search"].includes(body.tool) && typeof body.toolResult === "string" && body.toolResult.length > 0 && !body.toolResult.includes("temporarily unavailable")
    process.exit(ok ? 0 : 1)
  '
}

test_build() {
  (
    cd "$WEB_UI" &&
    npm run build >/dev/null
  )
}

main() {
  print_info "GhostForge feature smoke test"
  print_info "Base URL: $BASE_URL"
  print_info "Scratch dir: $TEST_DIR"
  print_info "Tip: set GF_TEST_DIR=/tmp/gfai-test if you specifically want a tmp-based scratch path."
  echo

  prepare_dummy_files

  run_test "Server reachable" test_server_up
  run_test "POST /api/jarvis (what time is it)" test_jarvis_time
  run_test "POST /api/jarvis (what is 2+2)" test_jarvis_math
  run_test "GET /api/jarvis/models" test_models
  run_test "GET /api/doctor" test_doctor
  run_test "GET /api/metrics" test_metrics
  run_test "GFAI tool: get_time" test_tool_get_time
  run_test "GFAI tool: get_weather" test_tool_get_weather
  run_test "GFAI tool: web_search" test_tool_web_search
  run_test "Web UI build" test_build

  echo
  local score=0
  if [ "$TOTAL_COUNT" -gt 0 ]; then
    score=$((PASS_COUNT * 100 / TOTAL_COUNT))
  fi

  if [ "$FAIL_COUNT" -eq 0 ]; then
    printf "${GREEN}Final Score: %s%% (%s/%s passed)${NC}\n" "$score" "$PASS_COUNT" "$TOTAL_COUNT"
    return 0
  fi

  printf "${YELLOW}Final Score: %s%% (%s passed, %s failed)${NC}\n" "$score" "$PASS_COUNT" "$FAIL_COUNT"
  return 1
}

main "$@"
