#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  ghostforge mark-liv — run the vendored Mark-LIV JARVIS engine
#
#  Mark-LIV (github.com/FatihMakes/Mark-LIV) is the Gemini Live voice
#  assistant engine that powers GhostForge's JARVIS / G.F.A.I. mode.
#  This launcher wraps vendor/mark-liv with GhostForge paths & config:
#
#    scripts/mark-liv.sh setup     # install Python deps (pip install -r)
#    scripts/mark-liv.sh doctor    # check Python + key dependencies
#    scripts/mark-liv.sh start     # launch the desktop JARVIS app (HUD + voice)
#    scripts/mark-liv.sh dashboard # start the phone/remote dashboard (port 8000)
#    scripts/mark-liv.sh stop      # stop the dashboard server
#    scripts/mark-liv.sh status    # is the dashboard running?
#
#  API key: set GEMINI_API_KEY in the environment or web-ui/.env — it is
#  forwarded to Mark-LIV, which stores it in config/api_keys.json on first run.
# ─────────────────────────────────────────────────────────────────────────────

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MARK_DIR="$ROOT_DIR/vendor/mark-liv"

GEMINI_KEY="${GEMINI_API_KEY:-${GOOGLE_GENERATIVE_AI_API_KEY:-${GOOGLE_API_KEY:-}}}"
DASH_PID_FILE="${TMPDIR:-/tmp}/ghostforge-mark-liv-dashboard.pid"

die() { echo "✗ $*" >&2; exit 1; }

[ -d "$MARK_DIR" ] || die "vendor/mark-liv not found — the engine was not vendored."

pick_python() {
  for c in python3 python py; do
    if command -v "$c" >/dev/null 2>&1; then echo "$c"; return 0; fi
  done
  return 1
}

export_keys_for_mark() {
  # Mark-LIV reads config/api_keys.json; the desktop app has a first-run GUI
  # for it, but when launched headless from GhostForge we pre-seed the key.
  if [ -n "$GEMINI_KEY" ] && [ -n "${PYTHON_BIN:-}" ]; then
    "$PYTHON_BIN" - "$GEMINI_KEY" <<'PYEOF' 2>/dev/null || true
import json, sys
from pathlib import Path
cfg = Path(__file__).resolve().parent / "config" / "api_keys.json"
cfg.parent.mkdir(parents=True, exist_ok=True)
data = {}
if cfg.exists():
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
    except Exception:
        data = {}
if data.get("gemini_api_key") != sys.argv[1]:
    data["gemini_api_key"] = sys.argv[1]
    cfg.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print("  ✓ API key synced to Mark-LIV config")
PYEOF
  fi
}

cmd_setup() {
  PYTHON_BIN="$(pick_python)" || die "Python 3.10+ required (python3/python/py not found)"
  echo "  Using $($PYTHON_BIN --version 2>&1) — installing Mark-LIV dependencies…"
  "$PYTHON_BIN" -m pip install -r "$MARK_DIR/requirements.txt" || die "pip install failed"
  echo "✅ Mark-LIV dependencies installed."
}

cmd_doctor() {
  PYTHON_BIN="$(pick_python)" || { echo "✗ Python not found — install Python 3.10+"; exit 1; }
  echo "  python: $($PYTHON_BIN --version 2>&1)"
  for mod in google.genai PyQt6 sounddevice numpy psutil requests; do
    if "$PYTHON_BIN" -c "import $mod" >/dev/null 2>&1; then
      echo "  ✓ $mod"
    else
      echo "  ✗ $mod — run: scripts/mark-liv.sh setup"
    fi
  done
  if [ -f "$MARK_DIR/config/api_keys.json" ] && grep -q '"gemini_api_key"' "$MARK_DIR/config/api_keys.json" 2>/dev/null; then
    echo "  ✓ Gemini API key configured"
  elif [ -n "$GEMINI_KEY" ]; then
    echo "  ✓ GEMINI_API_KEY found in environment (synced on start)"
  else
    echo "  ⚠ No Gemini API key — set GEMINI_API_KEY in web-ui/.env or run the app once to enter it"
  fi
}

cmd_start() {
  PYTHON_BIN="$(pick_python)" || die "Python 3.10+ required"
  export_keys_for_mark
  cd "$MARK_DIR"
  echo "  Launching Mark-LIV JARVIS (desktop HUD)…"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      # Windows: run detached via the MS Store Python launcher
      ( "$PYTHON_BIN" -m main >/dev/null 2>&1 & ) || true
      echo "  ✓ Started in background — check the system tray / taskbar."
      ;;
    Darwin)
      ( nohup "$PYTHON_BIN" -m main >/dev/null 2>&1 & ) || true
      echo "  ✓ Started in background."
      ;;
    *)
      ( nohup "$PYTHON_BIN" -m main >/dev/null 2>&1 & ) || true
      echo "  ✓ Started in background."
      ;;
  esac
}

cmd_dashboard() {
  PYTHON_BIN="$(pick_python)" || die "Python 3.10+ required"
  if [ -f "$DASH_PID_FILE" ] && kill -0 "$(cat "$DASH_PID_FILE" 2>/dev/null)" 2>/dev/null; then
    echo "  Mark-LIV dashboard already running (PID $(cat "$DASH_PID_FILE")) on port 8000"
    return 0
  fi
  export_keys_for_mark
  cd "$MARK_DIR"
  ( nohup "$PYTHON_BIN" dashboard/server.py >/dev/null 2>&1 & echo $! > "$DASH_PID_FILE" ) || true
  sleep 2
  if curl -s -o /dev/null --max-time 3 http://localhost:8000; then
    echo "  ✓ Mark-LIV dashboard online: http://localhost:8000 (PID $(cat "$DASH_PID_FILE"))"
  else
    echo "  ⚠ Dashboard start initiated but not responding yet — check deps: scripts/mark-liv.sh setup"
  fi
}

cmd_stop() {
  if [ -f "$DASH_PID_FILE" ]; then
    PID="$(cat "$DASH_PID_FILE" 2>/dev/null)"
    if [ -n "$PID" ] && kill "$PID" 2>/dev/null; then
      echo "  ✓ Mark-LIV dashboard stopped (PID $PID)"
    fi
    rm -f "$DASH_PID_FILE"
  else
    echo "  Dashboard not tracked (no PID file) — nothing to stop."
  fi
}

cmd_status() {
  if curl -s -o /dev/null --max-time 2 http://localhost:8000; then
    echo "  Mark-LIV dashboard: RUNNING (port 8000)"
  else
    echo "  Mark-LIV dashboard: NOT running"
  fi
  if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
    PYTHON_BIN="$(pick_python)"
    if "$PYTHON_BIN" -c "import google.genai, PyQt6" >/dev/null 2>&1; then
      echo "  Engine deps: installed"
    else
      echo "  Engine deps: missing — run scripts/mark-liv.sh setup"
    fi
  fi
}

case "${1:-help}" in
  setup)    cmd_setup ;;
  doctor)   cmd_doctor ;;
  start)    cmd_start ;;
  dashboard) cmd_dashboard ;;
  stop)     cmd_stop ;;
  status)   cmd_status ;;
  *)
    echo "Usage: scripts/mark-liv.sh {setup|doctor|start|dashboard|stop|status}"
    exit 1
    ;;
esac
