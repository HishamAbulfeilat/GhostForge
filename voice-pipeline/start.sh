#!/usr/bin/env bash
# GhostForge Voice Pipeline launcher — port 8766.
#
# Optional model setup (print these hints by running with --hints):
#   STT:
#     pip install faster-whisper
#     # or build whisper.cpp:  git clone https://github.com/ggml-org/whisper.cpp
#     #   cd whisper.cpp && make && ./models/download-ggml-model.sh small
#     #   ln -s <that layout> ~/.ghforge/voice/whisper.cpp
#   TTS:
#     pip install kokoro-tts    # best quality (Apache-2.0)
#     # or piper:
#     #   pip install piper-tts && python -m piper_tts.download en_US-lessac-medium
#     #   mkdir -p ~/.ghforge/voice/piper && cp *.onnx ~/.ghforge/voice/piper/
#     # macOS `say` works automatically with no extra setup.
#   Wake:
#     pip install openwakeword
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
  echo "[voice] Creating virtual environment..."
  python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"

if [ "${1:-}" = "--hints" ]; then
  sed -n '1,30p' "$0" | grep '^#  ' | sed 's/^#  //'
  exit 0
fi

echo "[voice] Installing requirements..."
if [ ! -f "$VENV_DIR/.deps-ok" ]; then
  pip install -q -r requirements.txt
  # Whitelist engines are optional; only the core (fastapi/uvicorn) is required.
  touch "$VENV_DIR/.deps-ok"
else
  echo "[voice] Dependencies already installed — skipping install."
fi

# Honor a NO_RELOAD=1 env (used when spawned as a background daemon).
if [ "${NO_RELOAD:-0}" = "1" ]; then
  exec uvicorn server:app --host 127.0.0.1 --port 8766
fi

echo "[voice] Starting uvicorn on port 8766..."
exec uvicorn server:app --host 127.0.0.1 --port 8766 --reload