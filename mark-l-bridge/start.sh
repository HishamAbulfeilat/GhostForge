#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARK_L_PARENT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
    echo "[start.sh] Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

echo "[start.sh] Installing requirements..."
pip install -q -r requirements.txt

export PYTHONPATH="${MARK_L_PARENT}${PYTHONPATH:+:$PYTHONPATH}"

echo "[start.sh] Starting uvicorn on port 8765..."
exec uvicorn server:app --host 127.0.0.1 --port 8765 --reload
