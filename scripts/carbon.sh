#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

VERSION="1.0.0"
DATA_DIR="${HOME}/.ghostforge/carbon"
SYSTEM_DATA_DIR="${HOME}/.ghostforge/carbon/system"
SYSTEM_PID_FILE="$SYSTEM_DATA_DIR/system-monitor.pid"
SYSTEM_LOG="$SYSTEM_DATA_DIR/system-monitor.log"
SYSTEM_EMISSIONS="$SYSTEM_DATA_DIR/system-emissions.csv"
SYSTEM_READY="$SYSTEM_DATA_DIR/system-monitor.ready"
EMISSIONS_FILE="$DATA_DIR/emissions.csv"
PID_FILE="$DATA_DIR/monitor.pid"
SESSION_FILE="$DATA_DIR/session.json"
LAST_SESSION_FILE="$DATA_DIR/last-session.json"
THRESHOLD_FILE="$DATA_DIR/threshold.txt"
MONITOR_LOG="$DATA_DIR/monitor.log"
REPORTS_DIR="$DATA_DIR/reports"
THROTTLE_FLAG="$DATA_DIR/throttle.enabled"
THROTTLE_PID_FILE="$DATA_DIR/throttle.pid"
THROTTLE_LOG="$DATA_DIR/throttle.log"
THROTTLE_WATCHER_SCRIPT="$DATA_DIR/throttle-watcher.sh"
BUDGET_FILE="$DATA_DIR/budget.json"
BADGE_FILE="$DATA_DIR/badge.md"
DIGESTS_DIR="$DATA_DIR/digests"

ACTION="${1:-help}"

print_header() {
  echo ""
  echo -e "${CYAN}${BOLD}  ╔══════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}${BOLD}  ║   Green Coding Monitor                      ║${NC}"
  echo -e "${CYAN}${BOLD}  ╚══════════════════════════════════════════════╝${NC}"
  echo ""
}

ensure_data_dir() {
  mkdir -p "$DATA_DIR"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_python3() {
  if ! command_exists python3; then
    echo -e "${RED}✖ Python 3 is required.${NC}"
    echo -e "${DIM}macOS: brew install python3${NC}"
    exit 1
  fi
}

require_pip3() {
  if ! command_exists pip3; then
    echo -e "${RED}✖ pip3 is required.${NC}"
    echo -e "${DIM}Install Python 3 with pip included, then re-run.${NC}"
    exit 1
  fi
}

python_pkg_ok() {
  local module="$1"
  python3 -c "import ${module}" >/dev/null 2>&1
}

ensure_runtime_deps() {
  require_python3
  require_pip3

  local missing=()
  python_pkg_ok codecarbon || missing+=(codecarbon)
  python_pkg_ok carbontracker || missing+=(carbontracker)
  python_pkg_ok pandas || missing+=(pandas)
  python_pkg_ok psutil || missing+=(psutil)

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo -e "${YELLOW}⚠ Missing Python packages: ${missing[*]}${NC}"
    echo -e "${DIM}Installing required carbon-tracking dependencies...${NC}"
    pip3 install --quiet --user codecarbon carbontracker pandas psutil
  fi
}

read_threshold_value() {
  if [[ -f "$THRESHOLD_FILE" ]]; then
    tr -d '[:space:]' < "$THRESHOLD_FILE"
  fi
}

is_pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

cleanup_stale_pid() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(tr -d '[:space:]' < "$PID_FILE")"
    if ! is_pid_running "$pid"; then
      rm -f "$PID_FILE"
    fi
  fi
}

get_last_session_emissions() {
  if [[ -f "$LAST_SESSION_FILE" ]]; then
    python3 - <<'PY' "$LAST_SESSION_FILE" 2>/dev/null || true
import json, sys
try:
    with open(sys.argv[1], 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    value = data.get('emissions')
    if value is not None:
        print(value)
except Exception:
    pass
PY
  fi
}

get_live_session_emissions() {
  if [[ ! -f "$EMISSIONS_FILE" || ! -f "$SESSION_FILE" ]]; then
    return 0
  fi

  python3 - <<'PY' "$EMISSIONS_FILE" "$SESSION_FILE" 2>/dev/null || true
import json, sys
from pathlib import Path

import pandas as pd

emissions_path = Path(sys.argv[1])
session_path = Path(sys.argv[2])
if not emissions_path.exists() or not session_path.exists():
    raise SystemExit(0)

session = json.loads(session_path.read_text())
started_at = session.get('start_time')
if not started_at:
    raise SystemExit(0)

df = pd.read_csv(emissions_path)
if df.empty:
    raise SystemExit(0)

if 'session_started_at' in df.columns:
    match = df[df['session_started_at'].astype(str) == str(started_at)]
    if not match.empty:
        print(match.iloc[-1].get('emissions', ''))
        raise SystemExit(0)

if 'timestamp' in df.columns:
    recent = df[df['timestamp'].astype(str) >= str(started_at.replace('T', ' '))]
    if not recent.empty:
        print(recent.iloc[-1].get('emissions', ''))
        raise SystemExit(0)
PY
}

threshold_label() {
  local emissions="$1"
  local threshold="$2"

  if [[ -z "$threshold" ]]; then
    echo -e "${DIM}Threshold not set${NC}"
    return 0
  fi

  if [[ -z "$emissions" ]]; then
    echo -e "${DIM}Threshold: $(printf '%.8f' "$threshold" 2>/dev/null || echo "$threshold") kg CO₂${NC}"
    return 0
  fi

  if awk -v e="$emissions" -v t="$threshold" 'BEGIN { exit !(e > t) }'; then
    echo -e "${YELLOW}⚠ Over threshold${NC}"
  else
    echo -e "${GREEN}✅ Under threshold${NC}"
  fi
}

notify_threshold_cmd() {
  local emissions="${1:-}"
  local threshold="${2:-}"
  [[ "${OSTYPE:-}" == darwin* ]] || return 0
  [[ -n "$emissions" && -n "$threshold" ]] || return 0

  if awk -v e="$emissions" -v t="$threshold" 'BEGIN { exit !(e > t) }'; then
    local message escaped
    message="$(printf 'Emissions exceeded threshold! Current: %.6f kg CO₂ (threshold: %.6f kg)' "$emissions" "$threshold")"
    escaped="$(python3 - <<'PY' "$message"
import json, sys
print(json.dumps(sys.argv[1]))
PY
)"
    osascript -e "display notification ${escaped} with title \"🌿 GhostForge Carbon Alert\" sound name \"Basso\"" >/dev/null 2>&1 || true
  fi
}

notify_cmd() {
  ensure_data_dir
  local threshold emissions
  threshold="$(read_threshold_value || true)"
  emissions="$(get_live_session_emissions)"
  [[ -n "$emissions" ]] || emissions="$(get_last_session_emissions)"

  if [[ "${OSTYPE:-}" != darwin* ]]; then
    echo -e "${YELLOW}⚠ Desktop notifications are only supported on macOS.${NC}"
    return 0
  fi
  if [[ -z "$threshold" ]]; then
    echo -e "${YELLOW}⚠ No threshold set. Run: ghostforge carbon threshold${NC}"
    return 0
  fi
  if [[ -z "$emissions" ]]; then
    echo -e "${YELLOW}⚠ No emissions value available yet.${NC}"
    return 0
  fi
  if awk -v e="$emissions" -v t="$threshold" 'BEGIN { exit !(e > t) }'; then
    notify_threshold_cmd "$emissions" "$threshold"
    echo -e "${GREEN}✅ Carbon alert notification sent.${NC}"
  else
    echo -e "${GREEN}✅ Current emissions are under the threshold — no alert sent.${NC}"
  fi
}

notify_test_cmd() {
  if [[ "${OSTYPE:-}" != darwin* ]]; then
    echo -e "${YELLOW}⚠ Desktop notifications are only supported on macOS.${NC}"
    return 0
  fi
  osascript -e 'display notification "This is a GhostForge Carbon Monitor test notification." with title "🌿 GhostForge Carbon Alert" sound name "Basso"' >/dev/null 2>&1 || true
  echo -e "${GREEN}✅ Test notification sent.${NC}"
}

sparkline_cmd() {
  ensure_data_dir
  if [[ ! -f "$EMISSIONS_FILE" ]]; then
    echo -e "${YELLOW}⚠ No emissions history found.${NC}"
    return 0
  fi

  python3 - <<'PY' "$EMISSIONS_FILE"
import csv
import sys
from pathlib import Path

blocks = '▁▂▃▄▅▆▇█'
path = Path(sys.argv[1]).expanduser()

with path.open('r', encoding='utf-8', newline='') as handle:
    rows = [row for row in csv.DictReader(handle) if row.get('emissions')]

values = []
for row in rows[-20:]:
    try:
        values.append(float(str(row.get('emissions', '0')).strip() or 0))
    except Exception:
        pass

if not values:
    print('No emissions records available yet.')
    raise SystemExit(0)

lo = min(values)
hi = max(values)
span = hi - lo
line = ''
for value in values:
    idx = 0 if span == 0 else min(7, int(((value - lo) / span) * 7))
    line += blocks[idx]

print('📈 Emissions trend (last 20 sessions):')
print(f'{line}   min: {lo:.6f} kg  max: {hi:.6f} kg  now: {values[-1]:.6f} kg')
PY
}

badge_cmd() {
  ensure_data_dir
  if [[ ! -f "$EMISSIONS_FILE" ]]; then
    echo -e "${YELLOW}⚠ No emissions history found.${NC}"
    return 0
  fi

  python3 - <<'PY' "$EMISSIONS_FILE" "$BADGE_FILE"
import csv
import sys
from pathlib import Path

emissions_path = Path(sys.argv[1]).expanduser()
badge_path = Path(sys.argv[2]).expanduser()

with emissions_path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))

total = 0.0
for row in rows:
    try:
        total += float(str(row.get('emissions', '0')).strip() or 0)
    except Exception:
        pass

if total < 0.01:
    color = 'brightgreen'
elif total < 0.05:
    color = 'green'
elif total < 0.1:
    color = 'yellow'
elif total < 0.5:
    color = 'orange'
else:
    color = 'red'

value = f'{total:.3f}'
url = f'https://img.shields.io/badge/carbon-{value}%20kg%20CO%E2%82%82-{color}?logo=leaflet'
content = f"""## Carbon Badge
![Carbon Footprint]({url})
Copy this into your README.md to show your project's carbon score.
"""
badge_path.write_text(content, encoding='utf-8')
print(content, end='')
PY
}

recommend_cmd() {
  ensure_data_dir
  if [[ ! -f "$EMISSIONS_FILE" ]]; then
    echo -e "${YELLOW}⚠ No emissions history found.${NC}"
    return 0
  fi

  python3 - <<'PY' "$EMISSIONS_FILE"
import csv
import sys
from collections import defaultdict
from pathlib import Path

path = Path(sys.argv[1]).expanduser()
with path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))

agg = defaultdict(float)
for row in rows:
    label = row.get('project_name') or row.get('session_label') or 'session'
    try:
        agg[label] += float(str(row.get('emissions', '0')).strip() or 0)
    except Exception:
        pass

ranked = sorted(agg.items(), key=lambda item: item[1], reverse=True)[:3]
if not ranked:
    print('No emissions records available yet.')
    raise SystemExit(0)

print('🌿 Carbon Recommendations')
print('')
for idx, (label, total) in enumerate(ranked, start=1):
    key = label.lower()
    if 'build' in key or 'next' in key:
        advice = 'Consider enabling Next.js incremental builds (`next build --no-lint`) or using Turbopack'
    elif 'test' in key or 'playwright' in key:
        advice = 'Run tests in parallel (`--workers=4`) or use `--shard` to split test suites'
    elif 'install' in key or 'npm' in key:
        advice = 'Use `npm ci` instead of `npm install`, or switch to pnpm for faster, lighter installs'
    elif 'lint' in key or 'eslint' in key:
        advice = 'Use `eslint --cache` to skip unchanged files'
    else:
        advice = 'Review this command for unnecessary work — consider caching or parallelization'
    print(f'{idx}. {label} — {total:.6f} kg CO₂')
    print(f'   → {advice}')

print('')
print("Jordan grid: 0.723 kg CO₂/kWh (from Hisham Abulfeilat's CRP research)")
PY
}

ci_cmd() {
  mkdir -p .github/workflows
  cat > .github/workflows/carbon-monitor.yml <<'EOF_CI'
name: Carbon Monitor
on: [push, pull_request]
jobs:
  carbon:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - name: Install carbon tools
        run: pip install codecarbon pandas
      - name: Track build emissions
        run: |
          python3 -c "
from codecarbon import EmissionsTracker
import subprocess, json
tracker = EmissionsTracker(project_name='ci-build', save_to_file=True)
tracker.start()
subprocess.run(['npm', 'ci'], check=True)
subprocess.run(['npm', 'run', 'build'], check=True)
emissions = tracker.stop()
print(f'::notice title=Carbon::Build emitted {emissions:.6f} kg CO2')
with open('carbon-report.json', 'w') as f:
    json.dump({'emissions_kg': emissions}, f)
          "
      - name: Upload carbon report
        uses: actions/upload-artifact@v4
        with:
          name: carbon-report
          path: carbon-report.json
      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = JSON.parse(fs.readFileSync('carbon-report.json', 'utf8'));
            const kg = report.emissions_kg.toFixed(6);
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## 🌿 Carbon Report\n\nThis build emitted **${kg} kg CO₂**\n\n*Tracked by GhostForge Carbon Monitor — research by Hisham Abulfeilat*`
            });
EOF_CI
  echo -e "${GREEN}✅ GitHub Actions workflow generated.${NC}"
  echo -e "${DIM}$(pwd)/.github/workflows/carbon-monitor.yml${NC}"
}

weekly_cmd() {
  ensure_data_dir
  mkdir -p "$DIGESTS_DIR"
  if [[ ! -f "$EMISSIONS_FILE" ]]; then
    echo -e "${YELLOW}⚠ No emissions history found.${NC}"
    return 0
  fi

  python3 - <<'PY' "$EMISSIONS_FILE" "$DIGESTS_DIR"
import csv
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

def parse_dt(value):
    if not value:
        return None
    text = str(value).strip().replace('Z', '+00:00')
    for candidate in (text, text.replace(' ', 'T')):
        try:
            return datetime.fromisoformat(candidate)
        except Exception:
            pass
    return None

path = Path(sys.argv[1]).expanduser()
digest_dir = Path(sys.argv[2]).expanduser()
with path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))

now = datetime.now()
week_start = now - timedelta(days=7)
last_week_start = now - timedelta(days=14)
this_week = []
last_week = []

for row in rows:
    dt = parse_dt(row.get('timestamp') or row.get('session_started_at'))
    if not dt:
        continue
    dt = dt.replace(tzinfo=None) if dt.tzinfo else dt
    if dt >= week_start:
        this_week.append(row)
    elif dt >= last_week_start:
        last_week.append(row)

def total(items):
    out = 0.0
    for item in items:
        try:
            out += float(str(item.get('emissions', '0')).strip() or 0)
        except Exception:
            pass
    return out

this_total = total(this_week)
last_total = total(last_week)
change = ((this_total - last_total) / last_total * 100) if last_total else 0.0
arrow = '↑' if change > 0 else '↓' if change < 0 else '→'
leaderboard = defaultdict(float)
for row in this_week:
    label = row.get('project_name') or row.get('session_label') or 'session'
    try:
        leaderboard[label] += float(str(row.get('emissions', '0')).strip() or 0)
    except Exception:
        pass

ranked = sorted(leaderboard.items(), key=lambda item: item[1], reverse=True)[:3]
medals = ['🥇', '🥈', '🥉']
week_of = (now - timedelta(days=now.weekday())).strftime('%a %b %d')
lines = [
    f'📊 Weekly Carbon Digest — Week of {week_of}',
    '─────────────────────────────────────────────',
    f'This week:   {this_total:.5f} kg CO₂  ({arrow} {abs(change):.0f}% vs last week)',
    f'Last week:   {last_total:.5f} kg CO₂',
    f'Sessions:    {len(this_week)} tracked',
    'Top emitters:'
]
if ranked:
    for idx, (label, value) in enumerate(ranked):
        lines.append(f'  {medals[idx]} {label:<16} {value:.5f} kg')
else:
    lines.append('  No tracked sessions this week')
lines += [
    '─────────────────────────────────────────────',
    'Tip: Enable throttle to reduce emissions automatically'
]
content = '\n'.join(lines) + '\n'
out = digest_dir / f"digest-{datetime.now().strftime('%Y-W%V')}.txt"
out.write_text(content, encoding='utf-8')
print(content, end='')
PY
}

install_cmd() {
  print_header
  ensure_data_dir
  require_python3
  require_pip3

  echo -e "${BLUE}Checking Python environment...${NC}"
  echo -e "${DIM}Installing codecarbon, carbontracker, pandas, psutil...${NC}"
  pip3 install --quiet --user codecarbon carbontracker pandas psutil

  python3 - <<'PY'
import importlib
packages = ['codecarbon', 'carbontracker', 'pandas', 'psutil']
for package in packages:
    importlib.import_module(package)
print('All imports OK')
PY

  local versions
  versions="$(python3 - <<'PY'
import codecarbon, carbontracker, pandas, psutil
print(f"codecarbon {getattr(codecarbon, '__version__', 'installed')}")
print(f"carbontracker {getattr(carbontracker, '__version__', 'installed')}")
print(f"pandas {getattr(pandas, '__version__', 'installed')}")
print(f"psutil {getattr(psutil, '__version__', 'installed')}")
PY
)"

  echo -e "${GREEN}✅ Carbon monitoring dependencies installed.${NC}"
  echo -e "${DIM}Data directory: $DATA_DIR${NC}"
  while IFS= read -r line; do
    echo -e "${DIM}$line${NC}"
  done <<< "$versions"
}

start_monitor() {
  local label="${1:-dev-session}"

  ensure_data_dir
  ensure_runtime_deps
  cleanup_stale_pid

  if [[ -f "$PID_FILE" ]]; then
    local active_pid
    active_pid="$(tr -d '[:space:]' < "$PID_FILE")"
    if is_pid_running "$active_pid"; then
      echo -e "${YELLOW}⚠ Carbon monitor already running (PID: $active_pid).${NC}"
      return 0
    fi
    rm -f "$PID_FILE"
  fi

  local start_time
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  SESSION_LABEL="$label" SESSION_STARTED_AT="$start_time" CARBON_DATA_DIR="$DATA_DIR" \
  nohup python3 -u - <<'PY' >> "$MONITOR_LOG" 2>&1 &
from codecarbon import EmissionsTracker
import json
import os
import signal
import time
from pathlib import Path

import pandas as pd

label = os.environ.get("SESSION_LABEL", "dev-session")
started_at = os.environ.get("SESSION_STARTED_AT")
data_dir = Path(os.environ["CARBON_DATA_DIR"]).expanduser()
data_dir.mkdir(parents=True, exist_ok=True)
pid_file = data_dir / "monitor.pid"
session_file = data_dir / "session.json"
last_session_file = data_dir / "last-session.json"
threshold_file = data_dir / "threshold.txt"
emissions_file = data_dir / "emissions.csv"

tracker = EmissionsTracker(
    project_name=label,
    output_dir=str(data_dir),
    output_file="emissions.csv",
    log_level="error",
)
tracker.start()

ready_file = data_dir / "monitor.ready"
ready_file.write_text("1", encoding="utf-8")

session_payload = {
    "pid": os.getpid(),
    "label": label,
    "start_time": started_at,
    "status": "running",
    "emissions_file": str(emissions_file),
}
session_file.write_text(json.dumps(session_payload, indent=2), encoding="utf-8")
pid_file.write_text(str(os.getpid()), encoding="utf-8")


def finalize(exit_code: int = 0):
    emissions = tracker.stop() or 0.0
    stopped_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    session_payload.update({
        "stop_time": stopped_at,
        "status": "stopped",
        "emissions": emissions,
    })

    if emissions_file.exists():
        try:
            df = pd.read_csv(emissions_file)
            if not df.empty:
                for col in ("project_name", "session_label", "session_started_at", "session_pid"):
                    if col not in df.columns:
                        df[col] = ""
                df.loc[df.index[-1], "project_name"] = label
                df.loc[df.index[-1], "session_label"] = label
                df.loc[df.index[-1], "session_started_at"] = started_at or ""
                df.loc[df.index[-1], "session_pid"] = os.getpid()
                df.to_csv(emissions_file, index=False)
        except Exception:
            pass

    threshold = None
    if threshold_file.exists():
        try:
            threshold = float(threshold_file.read_text(encoding="utf-8").strip())
        except Exception:
            threshold = None

    last_session_payload = {
        **session_payload,
        "threshold": threshold,
        "over_threshold": bool(threshold is not None and emissions > threshold),
    }
    last_session_file.write_text(json.dumps(last_session_payload, indent=2), encoding="utf-8")
    session_file.write_text(json.dumps(session_payload, indent=2), encoding="utf-8")
    if pid_file.exists():
        pid_file.unlink()
    if ready_file.exists():
        ready_file.unlink()
    print(f"SESSION_EMISSIONS:{emissions}", flush=True)
    raise SystemExit(exit_code)


def handle_signal(sig, frame):
    finalize(0)


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

while True:
    time.sleep(5)
PY

  local pid="$!"
  # Wait up to 15s for tracker to be ready (writes monitor.ready file)
  local waited=0
  local ready_file="$DATA_DIR/monitor.ready"
  rm -f "$ready_file"
  while [[ ! -f "$ready_file" ]] && [[ $waited -lt 15 ]]; do
    sleep 1
    waited=$((waited + 1))
    if ! is_pid_running "$pid"; then
      echo -e "${RED}✖ Failed to start carbon monitor.${NC}"
      [[ -f "$MONITOR_LOG" ]] && tail -n 20 "$MONITOR_LOG"
      exit 1
    fi
  done
  if [[ ! -f "$ready_file" ]]; then
    echo -e "${YELLOW}⚠ Carbon tracker took long to start, proceeding anyway...${NC}"
  fi

  echo "$pid" > "$PID_FILE"
  cat > "$SESSION_FILE" <<JSON
{
  "pid": $pid,
  "label": $(python3 - <<'PY' "$label"
import json, sys
print(json.dumps(sys.argv[1]))
PY
),
  "start_time": $(python3 - <<'PY' "$start_time"
import json, sys
print(json.dumps(sys.argv[1]))
PY
),
  "status": "running",
  "emissions_file": $(python3 - <<'PY' "$EMISSIONS_FILE"
import json, sys
print(json.dumps(sys.argv[1]))
PY
)
}
JSON

  echo -e "${GREEN}🟢 Carbon monitor started. PID: $pid${NC}"
  echo -e "${DIM}Session label: $label${NC}"
  echo -e "${DIM}Run 'ghostforge carbon stop' when done, or use 'ghostforge carbon track <cmd>'${NC}"
}

stop_monitor() {
  ensure_data_dir
  cleanup_stale_pid

  if [[ ! -f "$PID_FILE" ]]; then
    echo -e "${YELLOW}⚠ No active carbon monitor found.${NC}"
    return 0
  fi

  local pid
  pid="$(tr -d '[:space:]' < "$PID_FILE")"

  if ! is_pid_running "$pid"; then
    rm -f "$PID_FILE"
    echo -e "${YELLOW}⚠ Monitor PID file was stale and has been cleaned up.${NC}"
    return 0
  fi

  kill -TERM "$pid" 2>/dev/null || true

  local waited=0
  while is_pid_running "$pid" && [[ $waited -lt 20 ]]; do
    sleep 1
    waited=$((waited + 1))
  done

  rm -f "$PID_FILE"

  local emissions=""
  emissions="$(get_last_session_emissions)"
  if [[ -n "$emissions" ]]; then
    local threshold
    threshold="$(read_threshold_value || true)"
    echo -e "${GREEN}✅ Carbon monitor stopped.${NC}"
    echo -e "${BLUE}Session emissions:${NC} $(printf '%.8f' "$emissions") kg CO₂"
    echo -e "${BLUE}Threshold status:${NC} $(threshold_label "$emissions" "$threshold")"
  else
    echo -e "${GREEN}✅ Carbon monitor stopped.${NC}"
  fi
}

status_cmd() {
  ensure_data_dir
  cleanup_stale_pid
  print_header

  local threshold=""
  threshold="$(read_threshold_value || true)"

  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(tr -d '[:space:]' < "$PID_FILE")"
    if is_pid_running "$pid"; then
      echo -e "${GREEN}✅ Monitor running${NC}"
      echo -e "${BLUE}PID:${NC} $pid"
      if [[ -f "$SESSION_FILE" ]]; then
        python3 - <<'PY' "$SESSION_FILE" 2>/dev/null || true
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    data = json.load(handle)
print(f"Label: {data.get('label', 'dev-session')}")
print(f"Started: {data.get('start_time', 'unknown')}")
PY
      fi
      local live_emissions=""
      live_emissions="$(get_live_session_emissions)"
      if [[ -n "$live_emissions" ]]; then
        echo -e "${BLUE}Current session emissions:${NC} $(printf '%.8f' "$live_emissions") kg CO₂"
      else
        echo -e "${DIM}Current session emissions: awaiting tracker flush${NC}"
      fi
      echo -e "${BLUE}Threshold status:${NC} $(threshold_label "$live_emissions" "$threshold")"
      notify_threshold_cmd "$live_emissions" "$threshold"
      budget_inline_warning_cmd
      sparkline_cmd
      return 0
    fi
  fi

  echo -e "${YELLOW}⚠ Monitor is not running.${NC}"
  local last_emissions=""
  last_emissions="$(get_last_session_emissions)"
  if [[ -n "$last_emissions" ]]; then
    echo -e "${BLUE}Last session emissions:${NC} $(printf '%.8f' "$last_emissions") kg CO₂"
    echo -e "${BLUE}Threshold status:${NC} $(threshold_label "$last_emissions" "$threshold")"
    notify_threshold_cmd "$last_emissions" "$threshold"
  elif [[ -n "$threshold" ]]; then
    echo -e "${BLUE}Threshold:${NC} $(printf '%.8f' "$threshold") kg CO₂"
  else
    echo -e "${DIM}No tracked sessions yet.${NC}"
  fi
  budget_inline_warning_cmd
  sparkline_cmd
}

threshold_cmd() {
  ensure_data_dir
  ensure_runtime_deps

  if [[ ! -f "$EMISSIONS_FILE" ]]; then
    echo -e "${YELLOW}⚠ No emissions data found at $EMISSIONS_FILE${NC}"
    return 0
  fi

  python3 - <<'PY' "$EMISSIONS_FILE" "$THRESHOLD_FILE"
import os
import sys
import pandas as pd

emissions_file = os.path.expanduser(sys.argv[1])
threshold_file = os.path.expanduser(sys.argv[2])

df = pd.read_csv(emissions_file)
if df.empty or 'emissions' not in df.columns:
    print('No emissions records available yet.')
    raise SystemExit(0)

total = float(df['emissions'].fillna(0).sum())
n = int(len(df))
avg = total / n if n > 0 else 0.0
threshold = avg * 1.1
with open(threshold_file, 'w', encoding='utf-8') as handle:
    handle.write(str(threshold))
print(f"Total: {total:.8f} kg CO2")
print(f"Average/session: {avg:.8f} kg CO2")
print(f"Threshold (avg×1.1): {threshold:.8f} kg CO2")
PY

  local latest_emissions current_threshold
  latest_emissions="$(get_live_session_emissions)"
  [[ -n "$latest_emissions" ]] || latest_emissions="$(get_last_session_emissions)"
  current_threshold="$(read_threshold_value || true)"
  notify_threshold_cmd "$latest_emissions" "$current_threshold"
}

report_cmd() {
  ensure_data_dir
  ensure_runtime_deps

  if [[ ! -f "$EMISSIONS_FILE" ]]; then
    echo -e "${YELLOW}⚠ No emissions data found.${NC}"
    return 0
  fi

  local report_file
  report_file="$DATA_DIR/report-$(date +%F).md"

  python3 - <<'PY' "$EMISSIONS_FILE" "$THRESHOLD_FILE" "$report_file"
from datetime import datetime
from pathlib import Path
import sys

import pandas as pd

emissions_path = Path(sys.argv[1]).expanduser()
threshold_path = Path(sys.argv[2]).expanduser()
report_path = Path(sys.argv[3]).expanduser()

df = pd.read_csv(emissions_path)
if df.empty or 'emissions' not in df.columns:
    print('No emissions records available yet.')
    raise SystemExit(0)

emissions = df['emissions'].fillna(0).astype(float)
session_count = len(df)
total = float(emissions.sum())
avg_session = float(emissions.mean()) if session_count else 0.0
threshold = avg_session * 1.1
if threshold_path.exists():
    try:
        threshold = float(threshold_path.read_text(encoding='utf-8').strip())
    except Exception:
        pass

if 'timestamp' in df.columns:
    timestamps = pd.to_datetime(df['timestamp'], errors='coerce')
    valid_days = timestamps.dt.date.dropna()
    if not valid_days.empty:
        day_count = valid_days.nunique()
        avg_day = total / day_count if day_count else total
    else:
        avg_day = avg_session
else:
    avg_day = avg_session

latest_session = float(emissions.iloc[-1]) if session_count else 0.0
status = '⚠️ Over threshold' if latest_session > threshold else '✅ Under threshold'
km_equivalent = total / 0.21 if total else 0.0

working = df.copy()
working['emissions'] = emissions
if 'session_label' not in working.columns:
    working['session_label'] = working.get('project_name', 'session')
if 'timestamp' not in working.columns:
    working['timestamp'] = ''
if 'duration' not in working.columns:
    working['duration'] = ''

top = working.sort_values('emissions', ascending=False).head(5)
lines = []
for _, row in top.iterrows():
    label = row.get('session_label') or row.get('project_name') or 'session'
    timestamp = str(row.get('timestamp', ''))[:19] or 'unknown'
    duration = row.get('duration', '')
    duration_text = f" ({duration}s)" if str(duration).strip() not in ('', 'nan') else ''
    lines.append(f"- **{label}** — {float(row['emissions']):.8f} kg CO₂ — {timestamp}{duration_text}")

if not lines:
    lines.append('- No session data available.')

report = f"""# 🌿 Carbon Footprint Report — {datetime.now().date()}

**Project:** ghostforge-dev  
**Generated by:** GhostForge (based on CFRS research)

## Summary
| Metric | Value |
|---|---|
| Total Sessions | {session_count} |
| Total Emissions | {total:.8f} kg CO₂ |
| Avg per Session | {avg_session:.8f} kg CO₂ |
| Avg per Day | {avg_day:.8f} kg CO₂ |
| Threshold | {threshold:.8f} kg CO₂ |
| Status | {status} |

## Top 5 Highest-Emission Sessions
{chr(10).join(lines)}

## Recommendations
- Consider running builds during off-peak hours
- Use `ghostforge carbon track npm run build` to monitor individual commands
- Review the highest-emission sessions and compare them with lighter alternatives
- Compare: driving 1km ≈ 0.21 kg CO₂; your total ≈ {km_equivalent:.2f} km equivalent
"""

report_path.write_text(report, encoding='utf-8')
print(report_path)
PY

  echo -e "${GREEN}✅ Report generated.${NC}"
  echo -e "${DIM}$report_file${NC}"
}

history_cmd() {
  ensure_data_dir
  ensure_runtime_deps

  if [[ ! -f "$EMISSIONS_FILE" ]]; then
    echo -e "${YELLOW}⚠ No emissions history found.${NC}"
    return 0
  fi

  python3 - <<'PY' "$EMISSIONS_FILE"
import sys
import pandas as pd

path = sys.argv[1]
df = pd.read_csv(path)
if df.empty or 'emissions' not in df.columns:
    print('No emissions records available yet.')
    raise SystemExit(0)

work = df.copy()
if 'session_label' not in work.columns:
    work['session_label'] = work.get('project_name', 'session')
if 'timestamp' not in work.columns:
    work['timestamp'] = ''
if 'duration' not in work.columns:
    work['duration'] = ''

if 'timestamp' in work.columns:
    work = work.sort_values('timestamp', ascending=False)
else:
    work = work.iloc[::-1]

work = work.head(10)
print('')
print('  Last 10 carbon-tracked sessions')
print('')
print(f"  {'When':<20} {'Label':<24} {'Duration':<12} {'Emissions (kg CO₂)':>20}")
print('  ' + '─' * 82)
for _, row in work.iterrows():
    when = str(row.get('timestamp', ''))[:19] or 'unknown'
    label = str(row.get('session_label', 'session'))[:24]
    duration = str(row.get('duration', '')).strip()
    if duration in ('', 'nan'):
        duration = '-'
    value = float(row.get('emissions', 0) or 0)
    print(f"  {when:<20} {label:<24} {duration:<12} {value:>20.8f}")
print('')
PY
}

track_cmd() {
  if [[ $# -eq 0 ]]; then
    echo -e "${RED}✖ Usage: ghostforge carbon track <command...>${NC}"
    exit 1
  fi

  cleanup_stale_pid
  if [[ -f "$PID_FILE" ]]; then
    echo -e "${YELLOW}⚠ A carbon monitor is already running. Stop it before using track.${NC}"
    exit 1
  fi

  local label
  label="$(printf '%s ' "$@")"
  label="${label% }"

  start_monitor "$label" >/dev/null

  set +e
  "$@"
  local cmd_exit=$?
  set -e

  # Ensure tracker has at least 3s of data before stopping
  sleep 3
  stop_monitor >/dev/null || true

  local emissions=""
  emissions="$(get_last_session_emissions)"
  if [[ -n "$emissions" ]]; then
    if [[ $cmd_exit -eq 0 ]]; then
      echo -e "${GREEN}✅ Command complete. Emissions this session: $(printf '%.8f' "$emissions") kg CO₂${NC}"
    else
      echo -e "${YELLOW}⚠ Command failed (exit $cmd_exit). Emissions this session: $(printf '%.8f' "$emissions") kg CO₂${NC}"
    fi
  elif [[ $cmd_exit -eq 0 ]]; then
    echo -e "${GREEN}✅ Command complete. Emissions recorded.${NC}"
  else
    echo -e "${YELLOW}⚠ Command failed (exit $cmd_exit).${NC}"
  fi

  return "$cmd_exit"
}

clean_cmd() {
  cleanup_stale_pid
  if [[ -f "$PID_FILE" ]]; then
    stop_monitor >/dev/null || true
  fi
  rm -rf "$DATA_DIR"
  echo -e "${GREEN}✅ Carbon tracking data removed.${NC}"
}

# ─── System-wide monitor ──────────────────────────────────────────────────────

system_start_cmd() {
  ensure_runtime_deps
  mkdir -p "$SYSTEM_DATA_DIR"
  rm -f "$SYSTEM_READY"

  if [[ -f "$SYSTEM_PID_FILE" ]]; then
    local pid; pid="$(tr -d '[:space:]' < "$SYSTEM_PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "${YELLOW}⚠ System monitor already running (PID: $pid).${NC}"
      echo -e "${DIM}  Emissions file: $SYSTEM_EMISSIONS${NC}"
      return 0
    fi
    rm -f "$SYSTEM_PID_FILE"
  fi

  CARBON_SYSTEM_DIR="$SYSTEM_DATA_DIR" \
  nohup python3 -u - <<'PY_SYSTEM' >> "$SYSTEM_LOG" 2>&1 &
from codecarbon import EmissionsTracker
import json, os, signal, time
from pathlib import Path

data_dir = Path(os.environ["CARBON_SYSTEM_DIR"]).expanduser()
data_dir.mkdir(parents=True, exist_ok=True)

tracker = EmissionsTracker(
    project_name="ghostforge-system",
    output_dir=str(data_dir),
    output_file="system-emissions.csv",
    log_level="error",
    measure_power_secs=10,       # sample every 10s
    save_to_file=True,
)
tracker.start()

ready_file = data_dir / "system-monitor.ready"
ready_file.write_text("1", encoding="utf-8")
pid_file = data_dir / "system-monitor.pid"
pid_file.write_text(str(os.getpid()), encoding="utf-8")

def finalize(sig=None, frame=None):
    try:
        emissions = tracker.stop() or 0.0
    except Exception:
        emissions = 0.0
    info = {"pid": os.getpid(), "stopped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "total_emissions": emissions}
    (data_dir / "system-last.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    for f in (data_dir / "system-monitor.pid", data_dir / "system-monitor.ready"):
        try: f.unlink()
        except: pass
    raise SystemExit(0)

signal.signal(signal.SIGTERM, finalize)
signal.signal(signal.SIGINT, finalize)

while True:
    time.sleep(15)
PY_SYSTEM

  local pid="$!"
  # Wait for ready signal (up to 15s)
  local waited=0
  while [[ ! -f "$SYSTEM_READY" ]] && [[ $waited -lt 15 ]]; do
    sleep 1; waited=$((waited+1))
    if ! kill -0 "$pid" 2>/dev/null; then
      echo -e "${RED}✖ System monitor failed to start. Check: $SYSTEM_LOG${NC}"
      exit 1
    fi
  done

  echo "$pid" > "$SYSTEM_PID_FILE"
  echo -e "${GREEN}🌍 System-wide carbon monitor started! PID: $pid${NC}"
  echo -e "${DIM}  Tracking: ALL CPU/GPU/RAM usage on this machine${NC}"
  echo -e "${DIM}  Sampling every 10 seconds${NC}"
  echo -e "${DIM}  Data: $SYSTEM_EMISSIONS${NC}"
  echo -e "${DIM}  Log:  $SYSTEM_LOG${NC}"
  echo -e "${DIM}  Stop: ghostforge carbon system-stop${NC}"
}

system_stop_cmd() {
  if [[ ! -f "$SYSTEM_PID_FILE" ]]; then
    echo -e "${YELLOW}⚠ System monitor is not running.${NC}"
    return 0
  fi
  local pid; pid="$(tr -d '[:space:]' < "$SYSTEM_PID_FILE")"
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$SYSTEM_PID_FILE"
    echo -e "${YELLOW}⚠ System monitor was not running (stale PID).${NC}"
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
  local waited=0
  while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 15 ]]; do
    sleep 1; waited=$((waited+1))
  done
  rm -f "$SYSTEM_PID_FILE"

  # Show totals from system-emissions.csv
  if [[ -f "$SYSTEM_EMISSIONS" ]]; then
    python3 - <<'PY' "$SYSTEM_EMISSIONS" 2>/dev/null || true
import sys, pandas as pd
df = pd.read_csv(sys.argv[1])
if not df.empty and 'emissions' in df.columns:
    total = df['emissions'].sum()
    dur   = df['duration'].sum() if 'duration' in df.columns else 0
    print(f"  Sessions recorded : {len(df)}")
    print(f"  Total emissions   : {total:.8f} kg CO₂")
    print(f"  Total tracked time: {dur/3600:.2f} hours")
PY
  fi
  echo -e "${GREEN}✅ System monitor stopped.${NC}"
}

system_status_cmd() {
  echo ""
  if [[ -f "$SYSTEM_PID_FILE" ]]; then
    local pid; pid="$(tr -d '[:space:]' < "$SYSTEM_PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "${GREEN}🌍 System monitor: RUNNING (PID: $pid)${NC}"
    else
      rm -f "$SYSTEM_PID_FILE"
      echo -e "${YELLOW}⚠ System monitor: STOPPED (stale PID)${NC}"
    fi
  else
    echo -e "${YELLOW}⚠ System monitor: NOT running${NC}"
    echo -e "${DIM}  Run: ghostforge carbon system-start${NC}"
  fi

  if [[ -f "$SYSTEM_EMISSIONS" ]]; then
    python3 - <<'PY' "$SYSTEM_EMISSIONS" 2>/dev/null || true
import sys, pandas as pd
df = pd.read_csv(sys.argv[1])
if not df.empty and 'emissions' in df.columns:
    total = df['emissions'].sum()
    print(f"  System sessions   : {len(df)}")
    print(f"  Total emissions   : {total:.8f} kg CO₂")
    cars_km = total / 0.00021
    print(f"  ≈ {cars_km:.2f} km driven (car equivalent)")
PY
  else
    echo -e "${DIM}  No system emissions data yet.${NC}"
  fi
  echo ""
}

get_current_cpu_limit() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "unsupported"
    return 0
  fi

  local limit
  limit="$(pmset -g custom 2>/dev/null | awk '/cpulimitmax/ {print $2; exit}')"
  echo "${limit:-unknown}"
}

throttle_cmd() {
  ensure_data_dir
  local subcommand="${1:-status}"

  case "$subcommand" in
    on)
      touch "$THROTTLE_FLAG"
      cat > "$THROTTLE_WATCHER_SCRIPT" <<EOF_THROTTLE
#!/usr/bin/env bash
set -euo pipefail
DATA_DIR="${DATA_DIR}"
EMISSIONS_FILE="${EMISSIONS_FILE}"
THRESHOLD_FILE="${THRESHOLD_FILE}"
THROTTLE_FLAG="${THROTTLE_FLAG}"
THROTTLE_LOG="${THROTTLE_LOG}"
log_line() {
  printf '%s %s\n' "\$(date '+%Y-%m-%d %H:%M:%S')" "\$1" >> "$THROTTLE_LOG"
}
log_line "INFO watcher-start"
while [[ -f "$THROTTLE_FLAG" ]]; do
  if [[ -f "$EMISSIONS_FILE" && -f "$THRESHOLD_FILE" ]]; then
    result="\$(python3 - <<'PY' "$EMISSIONS_FILE" "$THRESHOLD_FILE" 2>/dev/null || true
import csv, sys
from pathlib import Path
emissions_path = Path(sys.argv[1]).expanduser()
threshold_path = Path(sys.argv[2]).expanduser()
if not emissions_path.exists() or not threshold_path.exists():
    raise SystemExit(0)
with emissions_path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))
if not rows:
    raise SystemExit(0)
try:
    threshold = float(threshold_path.read_text(encoding='utf-8').strip())
except Exception:
    raise SystemExit(0)
row = rows[-1]
try:
    emissions = float((row.get('emissions') or '0').strip() or 0)
except Exception:
    emissions = 0.0
if emissions > threshold:
    print(f"trigger:{emissions:.8f}:{threshold:.8f}")
PY
)"
    if [[ "$result" == trigger:* ]]; then
      IFS=':' read -r _ emissions_value threshold_value <<< "$result"
      current_limit="\$(pmset -g custom 2>/dev/null | awk '/cpulimitmax/ {print \$2; exit}')"
      if [[ "\${current_limit:-100}" != "50" ]]; then
        if sudo pmset -a cpulimitmax 50 >/dev/null 2>&1; then
          log_line "TRIGGER emissions=\${emissions_value} threshold=\${threshold_value} limit=50"
        else
          log_line "WARN sudo-required emissions=\${emissions_value} threshold=\${threshold_value}"
        fi
      fi
    fi
  fi
  sleep 30
done
log_line "INFO watcher-stop"
EOF_THROTTLE
      chmod +x "$THROTTLE_WATCHER_SCRIPT"

      if [[ -f "$THROTTLE_PID_FILE" ]]; then
        local existing_pid
        existing_pid="$(tr -d '[:space:]' < "$THROTTLE_PID_FILE")"
        if is_pid_running "$existing_pid"; then
          echo -e "${YELLOW}⚠ Auto-throttle already enabled (PID: $existing_pid).${NC}"
          echo -e "${DIM}Based on Hisham Abulfeilat's CRP CFRS research — 7–15% energy reduction${NC}"
          return 0
        fi
      fi

      nohup bash "$THROTTLE_WATCHER_SCRIPT" >/dev/null 2>&1 &
      local watcher_pid="$!"
      echo "$watcher_pid" > "$THROTTLE_PID_FILE"

      echo -e "${GREEN}✅ Auto-throttle enabled.${NC}"
      echo -e "${YELLOW}⚠ Uses sudo pmset -a cpulimitmax 50 on macOS when threshold is exceeded.${NC}"
      echo -e "${DIM}Watcher PID: $watcher_pid — checks emissions every 30s${NC}"
      echo -e "${DIM}Based on Hisham Abulfeilat's CRP CFRS research — 7–15% energy reduction${NC}"
      ;;
    off)
      rm -f "$THROTTLE_FLAG"
      if [[ -f "$THROTTLE_PID_FILE" ]]; then
        local watcher_pid
        watcher_pid="$(tr -d '[:space:]' < "$THROTTLE_PID_FILE")"
        if is_pid_running "$watcher_pid"; then
          kill -TERM "$watcher_pid" 2>/dev/null || true
        fi
        rm -f "$THROTTLE_PID_FILE"
      fi

      if [[ "$(uname -s)" == "Darwin" ]]; then
        if sudo pmset -a cpulimitmax 100 >/dev/null 2>&1; then
          echo -e "${GREEN}✅ CPU limit restored to 100%.${NC}"
        else
          echo -e "${YELLOW}⚠ Could not restore CPU limit automatically. Run: sudo pmset -a cpulimitmax 100${NC}"
        fi
      fi
      echo -e "${GREEN}✅ Auto-throttle disabled.${NC}"
      ;;
    status)
      local enabled="no"
      local watcher_state="stopped"
      local watcher_pid="-"
      if [[ -f "$THROTTLE_FLAG" ]]; then
        enabled="yes"
      fi
      if [[ -f "$THROTTLE_PID_FILE" ]]; then
        watcher_pid="$(tr -d '[:space:]' < "$THROTTLE_PID_FILE")"
        if is_pid_running "$watcher_pid"; then
          watcher_state="running"
        fi
      fi
      local current_limit
      current_limit="$(get_current_cpu_limit)"
      local last_trigger="Never triggered"
      if [[ -f "$THROTTLE_LOG" ]]; then
        last_trigger="$(awk '/TRIGGER/ {line=$0} END {print line}' "$THROTTLE_LOG")"
        [[ -z "$last_trigger" ]] && last_trigger="No trigger logged yet"
      fi
      echo -e "${BLUE}Auto-throttle enabled:${NC} $enabled"
      echo -e "${BLUE}Watcher:${NC} $watcher_state${DIM} (PID: $watcher_pid)${NC}"
      echo -e "${BLUE}Current CPU limit:${NC} ${current_limit}%"
      echo -e "${BLUE}Last trigger:${NC} $last_trigger"
      echo -e "${DIM}Based on Hisham Abulfeilat's CRP CFRS research — 7–15% energy reduction${NC}"
      ;;
    *)
      echo -e "${RED}✖ Usage: ghostforge carbon throttle <on|off|status>${NC}"
      exit 1
      ;;
  esac
}

equiv_cmd() {
  ensure_data_dir
  local kg="${1:-}"

  if [[ -z "$kg" ]]; then
    kg="$(python3 - <<'PY' "$EMISSIONS_FILE" "$LAST_SESSION_FILE" 2>/dev/null || true
import csv, json, sys
from pathlib import Path
emissions_path = Path(sys.argv[1]).expanduser()
last_session_path = Path(sys.argv[2]).expanduser()
if last_session_path.exists():
    try:
        data = json.loads(last_session_path.read_text(encoding='utf-8'))
        if data.get('emissions') is not None:
            print(data['emissions'])
            raise SystemExit(0)
    except Exception:
        pass
if emissions_path.exists():
    with emissions_path.open('r', encoding='utf-8', newline='') as handle:
        rows = list(csv.DictReader(handle))
    if rows:
        print(rows[-1].get('emissions', ''))
PY
)"
  fi

  if [[ -z "$kg" ]]; then
    echo -e "${YELLOW}⚠ No emissions value available. Pass a value, e.g. ghostforge carbon equiv 0.001${NC}"
    return 0
  fi

  python3 - <<'PY' "$kg"
import sys
kg = float(sys.argv[1])
rows = [
    ("🚗", "km driven", kg / 0.21, "km"),
    ("📱", "phone charges", kg / 0.008778, "charges"),
    ("🌳", "tree absorption", kg / 0.022, "hours"),
    ("✈️", "flight time", (kg / 0.255) / 900 * 3600, "seconds"),
    ("💡", "10W LED bulb", kg / 0.006, "hours"),
]
GREEN = "\033[0;32m"
CYAN = "\033[0;36m"
YELLOW = "\033[1;33m"
BOLD = "\033[1m"
NC = "\033[0m"
width = 62
print("")
print(f"{CYAN}{BOLD}╔{'═' * width}╗{NC}")
print(f"{CYAN}{BOLD}║ {'🌿 Carbon Equivalencies'.ljust(width - 1)}║{NC}")
print(f"{CYAN}{BOLD}╠{'═' * width}╣{NC}")
print(f"  Input: {kg:.8f} kg CO₂")
print(f"{CYAN}{BOLD}╟{'─' * width}╢{NC}")
for emoji, label, value, unit in rows:
    line = f" {emoji} {label:<18} {value:>14.2f} {unit:<12}"
    print(f"{GREEN}║{NC}{line.ljust(width)}{GREEN}║{NC}")
print(f"{CYAN}{BOLD}╚{'═' * width}╝{NC}")
print(f"{YELLOW}Tip:{NC} Translate raw CO₂ into impact you can feel.")
print("")
PY
}

leaderboard_cmd() {
  ensure_data_dir
  local subcommand="${1:-show}"

  if [[ "$subcommand" == "reset" ]]; then
    clean_cmd
    return 0
  fi

  if [[ ! -f "$EMISSIONS_FILE" ]]; then
    echo -e "${YELLOW}⚠ No emissions history found.${NC}"
    return 0
  fi

  python3 - <<'PY' "$EMISSIONS_FILE"
import csv
import sys
from collections import defaultdict
from pathlib import Path
path = Path(sys.argv[1]).expanduser()
with path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))
if not rows:
    print('No emissions records available yet.')
    raise SystemExit(0)
agg = defaultdict(lambda: {'total': 0.0, 'count': 0})
for row in rows:
    label = row.get('project_name') or row.get('session_label') or 'session'
    try:
        emissions = float((row.get('emissions') or '0').strip() or 0)
    except Exception:
        emissions = 0.0
    agg[label]['total'] += emissions
    agg[label]['count'] += 1
ranking = sorted(agg.items(), key=lambda item: item[1]['total'], reverse=True)[:10]
medals = ['🥇', '🥈', '🥉']
GREEN = "\033[0;32m"
CYAN = "\033[0;36m"
YELLOW = "\033[1;33m"
BOLD = "\033[1m"
NC = "\033[0m"
print('')
print(f"{CYAN}{BOLD}Per-Command Carbon Leaderboard{NC}")
print('')
print(f"{'Rank':<6} {'Command / Label':<34} {'Total kg CO₂':>14} {'Runs':>8} {'Avg/run':>14}")
print('─' * 82)
for idx, (label, values) in enumerate(ranking, start=1):
    total = values['total']
    count = values['count']
    avg = total / count if count else 0.0
    medal = medals[idx - 1] if idx <= len(medals) else f'{idx}.'
    color = YELLOW if idx == 1 else GREEN if idx <= 3 else NC
    print(f"{color}{medal:<6} {label[:34]:<34} {total:>14.8f} {count:>8} {avg:>14.8f}{NC}")
print('')
PY
}

export_cmd() {
  ensure_data_dir
  require_python3
  mkdir -p "$REPORTS_DIR"
  local format="${1:-md}"
  if [[ "$format" != "md" && "$format" != "html" ]]; then
    echo -e "${RED}✖ Usage: ghostforge carbon export [md|html]${NC}"
    exit 1
  fi
  local timestamp
  timestamp="$(date +"%Y%m%d-%H%M%S")"
  local md_file="$REPORTS_DIR/report-$timestamp.md"
  local html_file="$REPORTS_DIR/report-$timestamp.html"

  python3 - <<'PY' "$EMISSIONS_FILE" "$SYSTEM_EMISSIONS" "$THRESHOLD_FILE" "$BUDGET_FILE" "$md_file" "$html_file"
import csv
import html
import json
import platform
import socket
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

emissions_path = Path(sys.argv[1]).expanduser()
system_path = Path(sys.argv[2]).expanduser()
threshold_path = Path(sys.argv[3]).expanduser()
budget_path = Path(sys.argv[4]).expanduser()
md_path = Path(sys.argv[5]).expanduser()
html_path = Path(sys.argv[6]).expanduser()

def read_csv_rows(path: Path):
    if not path.exists():
        return []
    with path.open('r', encoding='utf-8', newline='') as handle:
        return list(csv.DictReader(handle))

def as_float(value, default=0.0):
    try:
        return float(str(value).strip())
    except Exception:
        return default

def build_equiv(kg: float):
    return {
        'km driven': kg / 0.21 if kg else 0.0,
        'phone charges': kg / 0.008778 if kg else 0.0,
        'tree absorption hours': kg / 0.022 if kg else 0.0,
        'flight seconds': ((kg / 0.255) / 900 * 3600) if kg else 0.0,
        'LED hours': kg / 0.006 if kg else 0.0,
    }

def markdown_to_html(md: str) -> str:
    lines = md.splitlines()
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith('# '):
            out.append(f"<h1>{html.escape(line[2:])}</h1>")
            i += 1
            continue
        if line.startswith('## '):
            out.append(f"<h2>{html.escape(line[3:])}</h2>")
            i += 1
            continue
        if line.startswith('- '):
            items = []
            while i < len(lines) and lines[i].startswith('- '):
                items.append(f"<li>{html.escape(lines[i][2:])}</li>")
                i += 1
            out.append('<ul>' + ''.join(items) + '</ul>')
            continue
        if '|' in line and i + 1 < len(lines) and set(lines[i + 1].replace('|', '').replace('-', '').replace(' ', '')) == set():
            headers = [html.escape(cell.strip()) for cell in line.strip('|').split('|')]
            rows_html = []
            i += 2
            while i < len(lines) and '|' in lines[i]:
                cells = [html.escape(cell.strip()) for cell in lines[i].strip('|').split('|')]
                rows_html.append('<tr>' + ''.join(f'<td>{cell}</td>' for cell in cells) + '</tr>')
                i += 1
            out.append('<table><thead><tr>' + ''.join(f'<th>{head}</th>' for head in headers) + '</tr></thead><tbody>' + ''.join(rows_html) + '</tbody></table>')
            continue
        out.append(f"<p>{html.escape(line)}</p>")
        i += 1
    return '\n'.join(out)

rows = read_csv_rows(emissions_path)
system_rows = read_csv_rows(system_path)
if not rows:
    raise SystemExit('No emissions records available yet.')
threshold = as_float(threshold_path.read_text(encoding='utf-8').strip(), 0.0) if threshold_path.exists() else 0.0
budget = {}
if budget_path.exists():
    try:
        budget = json.loads(budget_path.read_text(encoding='utf-8'))
    except Exception:
        budget = {}

total_emissions = sum(as_float(row.get('emissions')) for row in rows)
total_energy = sum(as_float(row.get('energy_consumed')) for row in rows)
count = len(rows)
avg = total_emissions / count if count else 0.0
latest = rows[-1]
last_emissions = as_float(latest.get('emissions'))
status = '🟢 below threshold' if not threshold or last_emissions <= threshold else '🔴 above threshold'

equiv = build_equiv(total_emissions)
leaderboard = defaultdict(lambda: {'total': 0.0, 'count': 0})
for row in rows:
    label = row.get('project_name') or row.get('session_label') or 'session'
    leaderboard[label]['total'] += as_float(row.get('emissions'))
    leaderboard[label]['count'] += 1
top5 = sorted(leaderboard.items(), key=lambda item: item[1]['total'], reverse=True)[:5]

history_md = ['| When | Label | Energy (kWh) | Emissions (kg CO₂) |', '|---|---|---:|---:|']
for row in rows[-10:][::-1]:
    when = (row.get('timestamp') or row.get('session_started_at') or 'unknown')[:19]
    label = row.get('session_label') or row.get('project_name') or 'session'
    history_md.append(f"| {when} | {label} | {as_float(row.get('energy_consumed')):.6f} | {as_float(row.get('emissions')):.8f} |")

leader_md = ['| Rank | Label | Total kg CO₂ | Runs | Avg/run |', '|---|---|---:|---:|---:|']
for idx, (label, values) in enumerate(top5, start=1):
    total = values['total']
    runs = values['count']
    leader_md.append(f"| {idx} | {label} | {total:.8f} | {runs} | {(total / runs if runs else 0.0):.8f} |")

system_total = sum(as_float(row.get('emissions')) for row in system_rows)
md = f"""# GhostForge Carbon Report — {datetime.now().strftime('%Y-%m-%d %H:%M')}

## Summary
| Metric | Value |
|---|---|
| Total sessions | {count} |
| Total emissions | {total_emissions:.8f} kg CO₂ |
| Total energy | {total_energy:.6f} kWh |
| Average per session | {avg:.8f} kg CO₂ |
| Last session | {last_emissions:.8f} kg CO₂ |
| Threshold status | {status} |
| Daily budget | {budget.get('daily_kg', 'not set')} |
| Weekly budget | {budget.get('weekly_kg', 'not set')} |

## System Info
| Metric | Value |
|---|---|
| Hostname | {socket.gethostname()} |
| Platform | {platform.platform()} |
| Python | {platform.python_version()} |
| Local carbon data dir | {emissions_path.parent} |
| System monitor emissions | {system_total:.8f} kg CO₂ |

## Session History
{chr(10).join(history_md)}

## Leaderboard Top-5
{chr(10).join(leader_md)}

## Equivalencies for Total Emissions
- 🚗 {equiv['km driven']:.2f} km driven
- 📱 {equiv['phone charges']:.2f} phone charges
- 🌳 {equiv['tree absorption hours']:.2f} tree absorption hours
- ✈️ {equiv['flight seconds']:.2f} seconds of flight
- 💡 {equiv['LED hours']:.2f} LED bulb hours

## Research Background (Hisham's CRP)
Based on Hisham Abulfeilat's CRP research on CFRS (Carbon Footprint Reduction System): *Reducing the Carbon Footprint of Laptops and Workstations*. The system combined real-time measurement, thresholding, and adaptive throttling to achieve 7–15% energy reduction.

## Recommendations
- Keep using `ghostforge carbon track` for heavy builds and tests.
- Turn on `ghostforge carbon throttle on` when working above your threshold.
- Review the leaderboard to target the most expensive commands first.
- Compare local runs against cleaner cloud regions with `ghostforge carbon compare-cloud`.
"""
md_path.write_text(md, encoding='utf-8')
html_body = markdown_to_html(md)
html_doc = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GhostForge Carbon Report</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f0fdf4; color:#14532d; margin:0; }}
    main {{ max-width: 980px; margin: 40px auto; background:#ffffff; border:1px solid #bbf7d0; border-radius:18px; padding:32px; box-shadow:0 20px 60px rgba(34,197,94,.12); }}
    h1,h2 {{ color:#166534; }}
    table {{ width:100%; border-collapse:collapse; margin:16px 0 24px; }}
    th,td {{ border:1px solid #bbf7d0; padding:10px; text-align:left; }}
    th {{ background:#dcfce7; }}
    ul {{ padding-left:20px; }}
    p, li {{ line-height:1.65; }}
  </style>
</head>
<body>
  <main>
    {html_body}
  </main>
</body>
</html>
"""
html_path.write_text(html_doc, encoding='utf-8')
print(md_path)
print(html_path)
PY

  echo -e "${GREEN}✅ Carbon report exported.${NC}"
  echo -e "${DIM}$md_file${NC}"
  echo -e "${DIM}$html_file${NC}"
  if [[ "$format" == "html" ]]; then
    open "$html_file" >/dev/null 2>&1 || true
  fi
}

live_cmd() {
  ensure_data_dir
  require_python3
  tput civis 2>/dev/null || true
  trap 'tput cnorm 2>/dev/null || true; echo; exit 0' INT TERM

  while true; do
    tput clear 2>/dev/null || printf '\033[2J\033[H'
    python3 - <<'PY' "$EMISSIONS_FILE" "$SESSION_FILE" "$THRESHOLD_FILE" "$SYSTEM_PID_FILE" "$THROTTLE_FLAG" "$THROTTLE_PID_FILE"
import csv
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

emissions_path = Path(sys.argv[1]).expanduser()
session_path = Path(sys.argv[2]).expanduser()
threshold_path = Path(sys.argv[3]).expanduser()
system_pid_path = Path(sys.argv[4]).expanduser()
throttle_flag = Path(sys.argv[5]).expanduser()
throttle_pid = Path(sys.argv[6]).expanduser()

def rows_from(path):
    if not path.exists():
        return []
    with path.open('r', encoding='utf-8', newline='') as handle:
        return list(csv.DictReader(handle))

def as_float(value, default=0.0):
    try:
        return float(str(value).strip())
    except Exception:
        return default

def parse_dt(value):
    if not value:
        return None
    text = str(value).strip().replace('Z', '+00:00')
    for candidate in (text, text.replace(' ', 'T')):
        try:
            return datetime.fromisoformat(candidate)
        except Exception:
            pass
    return None

def is_pid_running(path):
    try:
        pid = int(path.read_text(encoding='utf-8').strip())
    except Exception:
        return False
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False

rows = rows_from(emissions_path)
threshold = as_float(threshold_path.read_text(encoding='utf-8').strip(), 0.0) if threshold_path.exists() else 0.0
session = {}
if session_path.exists():
    try:
        session = json.loads(session_path.read_text(encoding='utf-8'))
    except Exception:
        session = {}
current_emissions = as_float(rows[-1].get('emissions')) if rows else 0.0
status = '🟢 below' if not threshold or current_emissions <= threshold else '🔴 above'
started_at = parse_dt(session.get('start_time')) if session.get('status') == 'running' else None
elapsed = 'n/a'
if started_at:
    elapsed_seconds = int((datetime.now(timezone.utc) - started_at.astimezone(timezone.utc)).total_seconds())
    hours, rem = divmod(max(elapsed_seconds, 0), 3600)
    minutes, seconds = divmod(rem, 60)
    elapsed = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
fill_ratio = 0.0 if threshold <= 0 else min(current_emissions / threshold, 1.0)
filled = int(round(fill_ratio * 10))
bar = '[' + '█' * filled + '░' * (10 - filled) + ']'
current_limit = 'unknown'
try:
    current_limit = subprocess.check_output("pmset -g custom | awk '/cpulimitmax/ {print $2; exit}'", shell=True, text=True, stderr=subprocess.DEVNULL).strip() or 'unknown'
except Exception:
    pass
last_five = rows[-5:][::-1]
print('\033[0;36m\033[1m🌿 GhostForge Carbon Live Dashboard\033[0m')
print('Updated every 10s — Ctrl+C to exit')
print('')
print(f"Current session   : elapsed {elapsed} | {current_emissions:.8f} kg CO₂ | {status}")
print(f"System monitor    : {'RUNNING' if is_pid_running(system_pid_path) else 'STOPPED'}")
print(f"Threshold bar     : {bar} {fill_ratio * 100:5.1f}%")
print(f"CPU throttle      : {'ENABLED' if throttle_flag.exists() else 'DISABLED'} | watcher {'RUNNING' if is_pid_running(throttle_pid) else 'STOPPED'} | limit {current_limit}%")
print('')
print('Last 5 sessions')
print(f"{'When':<20} {'Label':<28} {'kg CO₂':>12}")
print('─' * 64)
for row in last_five:
    when = (row.get('timestamp') or row.get('session_started_at') or 'unknown')[:19]
    label = (row.get('session_label') or row.get('project_name') or 'session')[:28]
    print(f"{when:<20} {label:<28} {as_float(row.get('emissions')):>12.8f}")
if not last_five:
    print('No session history yet.')
print('')
PY
    sleep 10
  done
}

git_track_cmd() {
  local subcommand="${1:-start}"
  case "$subcommand" in
    start)
      if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
        echo -e "${RED}✖ git-track start must be run inside a git repository.${NC}"
        exit 1
      fi
      local branch commit label
      branch="$(git branch --show-current 2>/dev/null || true)"
      commit="$(git rev-parse --short HEAD 2>/dev/null || true)"
      label="${branch:-detached}@${commit:-unknown}"
      start_monitor "$label"
      ;;
    stop)
      stop_monitor
      ;;
    log)
      if [[ ! -f "$EMISSIONS_FILE" ]]; then
        echo -e "${YELLOW}⚠ No emissions history found.${NC}"
        return 0
      fi
      python3 - <<'PY' "$EMISSIONS_FILE"
import csv
import sys
from collections import defaultdict
from pathlib import Path
path = Path(sys.argv[1]).expanduser()
with path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))
if not rows:
    print('No emissions records available yet.')
    raise SystemExit(0)
agg = defaultdict(lambda: {'total': 0.0, 'count': 0})
for row in rows:
    label = row.get('project_name') or row.get('session_label') or ''
    branch = label.split('@', 1)[0] if '@' in label else label or 'unknown'
    try:
        emissions = float((row.get('emissions') or '0').strip() or 0)
    except Exception:
        emissions = 0.0
    agg[branch]['total'] += emissions
    agg[branch]['count'] += 1
print('')
print('Git-linked carbon log')
print('')
print(f"{'Branch':<32} {'Total kg CO₂':>14} {'Runs':>8} {'Avg/run':>14}")
print('─' * 72)
for branch, values in sorted(agg.items(), key=lambda item: item[1]['total'], reverse=True):
    total = values['total']
    count = values['count']
    print(f"{branch[:32]:<32} {total:>14.8f} {count:>8} {(total / count if count else 0.0):>14.8f}")
print('')
PY
      ;;
    *)
      echo -e "${RED}✖ Usage: ghostforge carbon git-track <start|stop|log>${NC}"
      exit 1
      ;;
  esac
}

budget_inline_warning_cmd() {
  if [[ ! -f "$BUDGET_FILE" || ! -f "$EMISSIONS_FILE" ]]; then
    return 0
  fi

  python3 - <<'PY' "$EMISSIONS_FILE" "$BUDGET_FILE" 2>/dev/null || true
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

def parse_dt(value):
    if not value:
        return None
    text = str(value).strip().replace('Z', '+00:00')
    for candidate in (text, text.replace(' ', 'T')):
        try:
            return datetime.fromisoformat(candidate)
        except Exception:
            pass
    return None

def as_float(value, default=0.0):
    try:
        return float(str(value).strip())
    except Exception:
        return default

emissions_path = Path(sys.argv[1]).expanduser()
budget_path = Path(sys.argv[2]).expanduser()
with emissions_path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))
budget = json.loads(budget_path.read_text(encoding='utf-8'))
now = datetime.now().date()
week = now.isocalendar()[:2]
daily_total = 0.0
weekly_total = 0.0
for row in rows:
    dt = parse_dt(row.get('timestamp') or row.get('session_started_at'))
    if not dt:
        continue
    value = as_float(row.get('emissions'))
    if dt.date() == now:
        daily_total += value
    if dt.isocalendar()[:2] == week:
        weekly_total += value
messages = []
daily_budget = budget.get('daily_kg')
weekly_budget = budget.get('weekly_kg')
if daily_budget is not None and daily_total > float(daily_budget):
    messages.append(f"\033[1;33m⚠ Daily carbon budget exceeded: {daily_total:.8f}/{float(daily_budget):.8f} kg CO₂\033[0m")
if weekly_budget is not None and weekly_total > float(weekly_budget):
    messages.append(f"\033[1;33m⚠ Weekly carbon budget exceeded: {weekly_total:.8f}/{float(weekly_budget):.8f} kg CO₂\033[0m")
if messages:
    print('\n'.join(messages))
PY
}

budget_cmd() {
  ensure_data_dir
  local subcommand="${1:-status}"
  case "$subcommand" in
    set)
      local daily="${2:-}"
      local weekly="${3:-}"
      if [[ -z "$daily" ]]; then
        echo -e "${RED}✖ Usage: ghostforge carbon budget set <daily_kg> [weekly_kg]${NC}"
        exit 1
      fi
      if [[ -z "$weekly" ]]; then
        weekly="$(python3 - <<'PY' "$daily"
import sys
print(float(sys.argv[1]) * 7)
PY
)"
      fi
      python3 - <<'PY' "$BUDGET_FILE" "$daily" "$weekly"
import json
import sys
from datetime import datetime
from pathlib import Path
path = Path(sys.argv[1]).expanduser()
payload = {
    'daily_kg': float(sys.argv[2]),
    'weekly_kg': float(sys.argv[3]),
    'updated_at': datetime.utcnow().isoformat() + 'Z',
}
path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
PY
      echo -e "${GREEN}✅ Carbon budget saved.${NC}"
      echo -e "${DIM}Daily: $daily kg CO₂ | Weekly: $weekly kg CO₂${NC}"
      ;;
    status|week)
      if [[ ! -f "$BUDGET_FILE" ]]; then
        echo -e "${YELLOW}⚠ No budget set. Use: ghostforge carbon budget set <daily_kg> [weekly_kg]${NC}"
        return 0
      fi
      python3 - <<'PY' "$EMISSIONS_FILE" "$BUDGET_FILE" "$subcommand"
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

def parse_dt(value):
    if not value:
        return None
    text = str(value).strip().replace('Z', '+00:00')
    for candidate in (text, text.replace(' ', 'T')):
        try:
            return datetime.fromisoformat(candidate)
        except Exception:
            pass
    return None

def as_float(value, default=0.0):
    try:
        return float(str(value).strip())
    except Exception:
        return default

emissions_path = Path(sys.argv[1]).expanduser()
budget_path = Path(sys.argv[2]).expanduser()
mode = sys.argv[3]
budget = json.loads(budget_path.read_text(encoding='utf-8'))
rows = []
if emissions_path.exists():
    with emissions_path.open('r', encoding='utf-8', newline='') as handle:
        rows = list(csv.DictReader(handle))
now = datetime.now().date()
week_key = now.isocalendar()[:2]
total = 0.0
for row in rows:
    dt = parse_dt(row.get('timestamp') or row.get('session_started_at'))
    if not dt:
        continue
    if mode == 'status' and dt.date() == now:
        total += as_float(row.get('emissions'))
    if mode == 'week' and dt.isocalendar()[:2] == week_key:
        total += as_float(row.get('emissions'))
limit = float(budget['daily_kg'] if mode == 'status' else budget['weekly_kg'])
pct = 0.0 if limit <= 0 else (total / limit) * 100
filled = min(int(round((min(total / limit, 1.0) if limit > 0 else 0.0) * 20)), 20)
bar = '[' + '█' * filled + '░' * (20 - filled) + ']'
color = '\033[0;32m' if pct <= 100 else '\033[0;31m'
label = 'Today' if mode == 'status' else 'This week'
print(f"{label}: {total:.8f} / {limit:.8f} kg CO₂")
print(f"{color}{bar} {pct:.1f}% used\033[0m")
PY
      ;;
    reset)
      rm -f "$BUDGET_FILE"
      echo -e "${GREEN}✅ Carbon budget reset.${NC}"
      ;;
    *)
      echo -e "${RED}✖ Usage: ghostforge carbon budget <set|status|week|reset>${NC}"
      exit 1
      ;;
  esac
}

compare_cloud_cmd() {
  ensure_data_dir
  local provider="${1:-all}"
  if [[ ! -f "$EMISSIONS_FILE" ]]; then
    echo -e "${YELLOW}⚠ No emissions history found.${NC}"
    return 0
  fi
  python3 - <<'PY' "$EMISSIONS_FILE" "$provider"
import csv
import sys
from pathlib import Path
PROVIDERS = {
    'vercel': 0.023,
    'github-actions': 0.019,
    'netlify': 0.021,
    'aws-lambda': 0.028,
}
LOCAL_INTENSITY = 0.723
path = Path(sys.argv[1]).expanduser()
provider = sys.argv[2]
with path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))
if not rows:
    print('No emissions records available yet.')
    raise SystemExit(0)
row = rows[-1]
try:
    energy = float((row.get('energy_consumed') or '0').strip() or 0)
except Exception:
    energy = 0.0
if energy <= 0:
    print('Latest session does not include energy_consumed data yet.')
    raise SystemExit(0)
local = energy * LOCAL_INTENSITY
if provider != 'all' and provider not in PROVIDERS:
    raise SystemExit('Usage: ghostforge carbon compare-cloud [vercel|github-actions|netlify|aws-lambda]')
selected = PROVIDERS.items() if provider == 'all' else [(provider, PROVIDERS[provider])]
print('')
print(f"Cloud comparison for {energy:.6f} kWh workload")
print('')
print(f"{'Provider':<18} {'kg CO₂':>12} {'vs local':>12}")
print('─' * 46)
print(f"{'local (Jordan)':<18} {local:>12.8f} {'baseline':>12}")
for name, intensity in selected:
    emissions = energy * intensity
    diff = ((emissions - local) / local * 100) if local else 0.0
    print(f"{name:<18} {emissions:>12.8f} {diff:>+11.1f}%")
print('')
PY
}

help_cmd() {
  cat <<'EOF_HELP'
Usage:
  ghostforge carbon <command> [options]
  bash scripts/carbon.sh <command> [options]

Commands:
  install | setup         Check Python 3 + pip and install carbon packages
  start [label]           Start a background project-level monitor
  stop                    Stop the active project monitor
  status                  Show project monitor status, threshold, and budget alerts
  system-start            Start system-wide monitor (ALL CPU/GPU/RAM)
  system-stop             Stop system-wide monitor
  system-status           Show system monitor status + total emissions
  threshold               Compute threshold from history (avg × 1.1)
  report                  Generate a Markdown carbon report
  export [md|html]        Export a rich Markdown/HTML carbon report
  track <command...>      Track emissions while running a command
  git-track <subcommand>  Track by git branch@commit (start|stop|log)
  throttle <subcommand>   Auto-throttle CPU on threshold breach (on|off|status)
  live                    Open the real-time terminal dashboard
  sparkline               Show the last 20-session emissions trend
  notify                  Send a desktop alert if threshold is breached (macOS)
  notify-test             Send a test desktop alert (macOS)
  equiv [kg]              Show human-readable CO₂ equivalencies
  leaderboard [reset]     Rank commands/projects by total emissions
  badge                   Generate a Shields.io carbon badge markdown snippet
  recommend               Suggest optimizations for the top emitters
  budget <subcommand>     Manage daily/weekly carbon budgets
  ci                      Generate GitHub Actions carbon-monitor workflow
  weekly                  Generate a weekly carbon digest and save it locally
  compare-cloud [name]    Compare local workload vs cloud provider CO₂
  history                 Show the last 10 tracked sessions
  clean                   Remove all carbon tracking data
  version                 Print version
  help                    Show this help message

Examples:
  ghostforge carbon install
  ghostforge carbon system-start               # track whole computer
  ghostforge carbon track npm run build        # track a specific command
  ghostforge carbon git-track start            # label session as branch@commit
  ghostforge carbon throttle on                # enable auto-throttle watcher
  ghostforge carbon equiv 0.001                # translate raw CO₂ into impact
  ghostforge carbon leaderboard                # top emitters
  ghostforge carbon sparkline                  # trend view
  ghostforge carbon notify-test                # macOS test notification
  ghostforge carbon badge                      # README badge markdown
  ghostforge carbon recommend                  # optimization advice
  ghostforge carbon export html                # rich report + open in browser
  ghostforge carbon budget set 0.05 0.35       # set daily/weekly budget
  ghostforge carbon ci                         # GitHub Actions workflow
  ghostforge carbon weekly                     # weekly digest
  ghostforge carbon compare-cloud vercel       # local vs cloud estimate
EOF_HELP
}

case "$ACTION" in
  install|setup)
    install_cmd
    ;;
  start)
    print_header
    shift || true
    start_monitor "${*:-dev-session}"
    ;;
  stop)
    print_header
    stop_monitor
    ;;
  status)
    status_cmd
    ;;
  threshold)
    print_header
    threshold_cmd
    ;;
  report)
    print_header
    report_cmd
    ;;
  export)
    print_header
    shift || true
    export_cmd "${1:-md}"
    ;;
  track)
    print_header
    shift || true
    track_cmd "$@"
    ;;
  git-track)
    print_header
    shift || true
    git_track_cmd "${1:-start}"
    ;;
  throttle)
    print_header
    shift || true
    throttle_cmd "${1:-status}"
    ;;
  live)
    print_header
    live_cmd
    ;;
  sparkline)
    print_header
    sparkline_cmd
    ;;
  notify)
    print_header
    notify_cmd
    ;;
  notify-test)
    print_header
    notify_test_cmd
    ;;
  equiv)
    print_header
    shift || true
    equiv_cmd "${1:-}"
    ;;
  leaderboard)
    print_header
    shift || true
    leaderboard_cmd "${1:-show}"
    ;;
  badge)
    print_header
    badge_cmd
    ;;
  recommend)
    print_header
    recommend_cmd
    ;;
  budget)
    print_header
    shift || true
    budget_cmd "${1:-status}" "${2:-}" "${3:-}"
    ;;
  ci)
    print_header
    ci_cmd
    ;;
  weekly)
    print_header
    weekly_cmd
    ;;
  compare-cloud)
    print_header
    shift || true
    compare_cloud_cmd "${1:-all}"
    ;;
  history)
    print_header
    history_cmd
    ;;
  system-start)
    print_header
    system_start_cmd
    ;;
  system-stop)
    print_header
    system_stop_cmd
    ;;
  system-status)
    print_header
    system_status_cmd
    ;;
  clean)
    print_header
    clean_cmd
    ;;
  version)
    echo "$VERSION"
    ;;
  help|--help|-h)
    help_cmd
    ;;
  *)
    echo -e "${RED}✖ Unknown command: $ACTION${NC}"
    echo ""
    help_cmd
    exit 1
    ;;
esac
