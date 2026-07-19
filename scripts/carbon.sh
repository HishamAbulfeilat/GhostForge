#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

VERSION="1.0.0"
DATA_DIR="${HOME}/.ghostforge/carbon"
EMISSIONS_FILE="$DATA_DIR/emissions.csv"
PID_FILE="$DATA_DIR/monitor.pid"
SESSION_FILE="$DATA_DIR/session.json"
LAST_SESSION_FILE="$DATA_DIR/last-session.json"
THRESHOLD_FILE="$DATA_DIR/threshold.txt"
MONITOR_LOG="$DATA_DIR/monitor.log"

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
    project_name="ghostforge-dev",
    output_dir=str(data_dir),
    output_file="emissions.csv",
    log_level="error",
)
tracker.start()

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
                for col in ("session_label", "session_started_at", "session_pid"):
                    if col not in df.columns:
                        df[col] = ""
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
  sleep 1
  if ! is_pid_running "$pid"; then
    echo -e "${RED}✖ Failed to start carbon monitor.${NC}"
    [[ -f "$MONITOR_LOG" ]] && tail -n 20 "$MONITOR_LOG"
    exit 1
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
      return 0
    fi
  fi

  echo -e "${YELLOW}⚠ Monitor is not running.${NC}"
  local last_emissions=""
  last_emissions="$(get_last_session_emissions)"
  if [[ -n "$last_emissions" ]]; then
    echo -e "${BLUE}Last session emissions:${NC} $(printf '%.8f' "$last_emissions") kg CO₂"
    echo -e "${BLUE}Threshold status:${NC} $(threshold_label "$last_emissions" "$threshold")"
  elif [[ -n "$threshold" ]]; then
    echo -e "${BLUE}Threshold:${NC} $(printf '%.8f' "$threshold") kg CO₂"
  else
    echo -e "${DIM}No tracked sessions yet.${NC}"
  fi
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
**Generated by:** GhostForge AI Toolkit (based on CFRS research)

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

help_cmd() {
  cat <<'EOF_HELP'
Usage:
  ghostforge carbon <command> [options]
  bash scripts/carbon.sh <command> [options]

Commands:
  install | setup      Check Python 3 + pip and install carbon packages
  start [label]        Start a background carbon monitor session
  stop                 Stop the active carbon monitor
  status               Show monitor status and threshold state
  threshold            Compute threshold from emissions history (avg × 1.1)
  report               Generate a Markdown carbon report
  track <command...>   Track emissions while running a command
  history              Show the last 10 tracked sessions
  clean                Remove all carbon tracking data
  version              Print version
  help                 Show this help message

Examples:
  ghostforge carbon install
  ghostforge carbon start "morning-dev"
  ghostforge carbon track npm run build
  ghostforge carbon stop && ghostforge carbon threshold
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
  track)
    print_header
    shift || true
    track_cmd "$@"
    ;;
  history)
    print_header
    history_cmd
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
