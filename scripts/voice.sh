#!/usr/bin/env bash
set -euo pipefail
GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; CYAN='\033[0;36m'; NC='\033[0m'

ACTION="${1:-help}"
shift 2>/dev/null || true
TEXT="$*"

echo ""
echo -e "${BLUE}${BOLD}  ╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   /voice — Free Voice Features (TTS + STT)       ║${NC}"
echo -e "${BLUE}${BOLD}  ╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── Detect available TTS ───────────────────────────────────────────────────────
detect_tts() {
  if command -v say &>/dev/null; then echo "say"         # macOS built-in
  elif command -v espeak-ng &>/dev/null; then echo "espeak-ng"
  elif command -v espeak &>/dev/null; then echo "espeak"
  elif command -v festival &>/dev/null; then echo "festival"
  else echo "none"; fi
}

# ── Detect available STT ───────────────────────────────────────────────────────
detect_stt() {
  if command -v whisper &>/dev/null; then echo "whisper"
  elif command -v whisper-cpp &>/dev/null; then echo "whisper-cpp"
  elif [[ -f "$GHOSTFORGE_DIR/.whisper/main" ]]; then echo "whisper-cpp-local"
  elif [[ -n "${GROQ_API_KEY:-}" ]]; then echo "groq"
  else echo "none"; fi
}

TTS_ENGINE="$(detect_tts)"
STT_ENGINE="$(detect_stt)"

# ── speak ──────────────────────────────────────────────────────────────────────
speak() {
  local msg="$1"
  # Strip ANSI escape codes
  msg=$(echo "$msg" | sed 's/\x1B\[[0-9;]*[mK]//g')
  case "$TTS_ENGINE" in
    say)
      say -r 180 "$msg" 2>/dev/null &
      ;;
    espeak-ng)
      espeak-ng -s 160 -v en-us "$msg" 2>/dev/null &
      ;;
    espeak)
      espeak -s 160 "$msg" 2>/dev/null &
      ;;
    festival)
      echo "$msg" | festival --tts 2>/dev/null &
      ;;
    none)
      echo -e "  ${YELLOW}⚠  No TTS engine found.${NC}"
      echo -e "  ${DIM}  macOS: built-in 'say' should work${NC}"
      echo -e "  ${DIM}  Linux: sudo apt install espeak-ng${NC}"
      ;;
  esac
}

# ── transcribe ─────────────────────────────────────────────────────────────────
transcribe() {
  local audio_file="${1:-}"
  
  case "$STT_ENGINE" in
    whisper)
      echo -e "  ${DIM}Transcribing with local Whisper...${NC}"
      whisper "$audio_file" --model base --output_format txt 2>/dev/null
      ;;
    whisper-cpp-local)
      echo -e "  ${DIM}Transcribing with whisper.cpp...${NC}"
      "$GHOSTFORGE_DIR/.whisper/main" -m "$GHOSTFORGE_DIR/.whisper/ggml-base.en.bin" -f "$audio_file" 2>/dev/null
      ;;
    groq)
      echo -e "  ${DIM}Transcribing via Groq Whisper API (free tier: 7200s/day)...${NC}"
      curl -s -X POST "https://api.groq.com/openai/v1/audio/transcriptions" \
        -H "Authorization: Bearer ${GROQ_API_KEY}" \
        -F "file=@${audio_file}" \
        -F "model=whisper-large-v3" \
        -F "response_format=text" 2>/dev/null
      ;;
    none)
      echo -e "  ${YELLOW}⚠  No STT engine found.${NC}"
      echo -e "  ${DIM}  Free options:${NC}"
      echo -e "  ${DIM}  1. Groq Whisper (7200s/day free): Set GROQ_API_KEY in .env.local${NC}"
      echo -e "  ${DIM}  2. Local whisper.cpp: bash scripts/voice.sh install-whisper${NC}"
      echo -e "  ${DIM}  3. pip install openai-whisper (local, GPU recommended)${NC}"
      ;;
  esac
}

# ── record audio (macOS / Linux) ───────────────────────────────────────────────
record_audio() {
  local out_file="${1:-/tmp/ghostforge-voice-$$.wav}"
  local duration="${2:-5}"
  
  echo -e "  ${CYAN}🎤 Recording for ${duration}s... Speak now!${NC}"
  
  if command -v sox &>/dev/null; then
    sox -d -r 16000 -c 1 "$out_file" trim 0 "$duration" 2>/dev/null
  elif command -v arecord &>/dev/null; then
    arecord -d "$duration" -f S16_LE -r 16000 "$out_file" 2>/dev/null
  elif command -v ffmpeg &>/dev/null; then
    ffmpeg -f avfoundation -i ":0" -t "$duration" -ar 16000 "$out_file" 2>/dev/null
  else
    echo -e "  ${RED}✖  No audio recorder found.${NC}"
    echo -e "  ${DIM}  macOS: brew install sox${NC}"
    echo -e "  ${DIM}  Linux: sudo apt install sox${NC}"
    return 1
  fi
  echo "$out_file"
}

# ── Commands ───────────────────────────────────────────────────────────────────
case "$ACTION" in
  speak|say|tts)
    if [[ -z "$TEXT" ]]; then
      echo -e "  ${DIM}Enter text to speak:${NC}"
      read -rp "  > " TEXT
    fi
    echo -e "  ${DIM}TTS engine: $TTS_ENGINE${NC}"
    echo -e "  ${DIM}Speaking: \"$TEXT\"${NC}"
    speak "$TEXT"
    ;;

  listen|stt|transcribe)
    DURATION="${1:-5}"
    echo -e "  ${DIM}STT engine: $STT_ENGINE${NC}"
    AUDIO_FILE=$(record_audio "/tmp/ghostforge-voice-$$.wav" "$DURATION")
    if [[ -f "$AUDIO_FILE" ]]; then
      TRANSCRIPT=$(transcribe "$AUDIO_FILE")
      rm -f "$AUDIO_FILE"
      echo ""
      echo -e "  ${GREEN}Transcript:${NC}"
      echo -e "  ${BOLD}$TRANSCRIPT${NC}"
      echo ""
      # Copy to clipboard if available
      if command -v pbcopy &>/dev/null; then echo "$TRANSCRIPT" | pbcopy && echo -e "  ${DIM}Copied to clipboard.${NC}"
      elif command -v xclip &>/dev/null; then echo "$TRANSCRIPT" | xclip -selection clipboard && echo -e "  ${DIM}Copied to clipboard.${NC}"; fi
    fi
    ;;

  read-health)
    # Speak the health summary from last run
    CACHE=$(find . -name "health.json" -path "*/.ghostforge-cache/*" 2>/dev/null | head -1 || true)
    if [[ -n "$CACHE" ]]; then
      SUMMARY=$(python3 -c "
import json, re
with open('$CACHE') as f: d = json.load(f)
score = re.search(r'(\d+)/100', json.dumps(d))
print(f'Project health score is {score.group(1)} out of 100.' if score else 'Health data found but score unclear.')
" 2>/dev/null || echo "Health check complete.")
      echo -e "  ${DIM}Speaking: $SUMMARY${NC}"
      speak "$SUMMARY"
    else
      speak "No health data found. Run the health check first."
      echo -e "  ${YELLOW}No health cache found. Run: bash scripts/health-check.sh${NC}"
    fi
    ;;

  install-whisper)
    echo -e "  ${BLUE}Installing whisper.cpp locally (free, offline STT)...${NC}"
    echo ""
    mkdir -p "$GHOSTFORGE_DIR/.whisper"
    if [[ ! -d "$GHOSTFORGE_DIR/.whisper/whisper.cpp" ]]; then
      git clone https://github.com/ggerganov/whisper.cpp "$GHOSTFORGE_DIR/.whisper/whisper.cpp" --depth=1 --quiet
    fi
    cd "$GHOSTFORGE_DIR/.whisper/whisper.cpp"
    make -j4 2>/dev/null && echo -e "  ${GREEN}✔ Built${NC}" || echo -e "  ${YELLOW}⚠  Build failed — try: brew install cmake${NC}"
    if [[ ! -f "$GHOSTFORGE_DIR/.whisper/ggml-base.en.bin" ]]; then
      echo -e "  ${DIM}Downloading base English model (~140MB)...${NC}"
      bash models/download-ggml-model.sh base.en
      cp models/ggml-base.en.bin "$GHOSTFORGE_DIR/.whisper/"
    fi
    cp main "$GHOSTFORGE_DIR/.whisper/" 2>/dev/null || true
    echo -e "  ${GREEN}✅ whisper.cpp installed at $GHOSTFORGE_DIR/.whisper/${NC}"
    echo -e "  ${DIM}  Test: bash scripts/voice.sh transcribe /path/to/audio.wav${NC}"
    ;;

  status)
    echo -e "  ${BOLD}Voice capabilities:${NC}"
    echo ""
    echo -e "  TTS (text-to-speech):"
    case "$TTS_ENGINE" in
      say) echo -e "    ${GREEN}● macOS 'say' — built-in, no setup needed${NC}" ;;
      espeak-ng|espeak) echo -e "    ${GREEN}● espeak-ng — available${NC}" ;;
      none) echo -e "    ${RED}○ No TTS engine found${NC}"; echo -e "    ${DIM}  macOS: built-in 'say' should work${NC}"; echo -e "    ${DIM}  Linux: sudo apt install espeak-ng${NC}" ;;
    esac
    echo ""
    echo -e "  STT (speech-to-text):"
    case "$STT_ENGINE" in
      whisper) echo -e "    ${GREEN}● Whisper (local) — available${NC}" ;;
      whisper-cpp-local) echo -e "    ${GREEN}● whisper.cpp (local, offline) — installed${NC}" ;;
      groq) echo -e "    ${GREEN}● Groq Whisper API — configured (7200s/day free)${NC}" ;;
      none)
        echo -e "    ${RED}○ No STT engine found${NC}"
        echo ""
        echo -e "  ${BOLD}Free STT options (choose one):${NC}"
        echo -e "    ${DIM}1. Groq Whisper API (easiest):${NC}"
        echo -e "    ${DIM}   Sign up free: https://console.groq.com${NC}"
        echo -e "    ${DIM}   Add to .env.local: GROQ_API_KEY=your_key${NC}"
        echo -e "    ${DIM}   Free: 7200 seconds/day (2 hours)${NC}"
        echo -e "    ${DIM}2. whisper.cpp (offline, local):${NC}"
        echo -e "    ${DIM}   bash scripts/voice.sh install-whisper${NC}"
        echo -e "    ${DIM}3. Python Whisper (GPU recommended):${NC}"
        echo -e "    ${DIM}   pip install openai-whisper${NC}"
        ;;
    esac
    ;;

  help|*)
    echo -e "  ${BOLD}Usage:${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh speak \"Hello world\"${NC}     ${DIM}# TTS: speak text aloud${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh listen 5${NC}                ${DIM}# STT: record 5s and transcribe${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh read-health${NC}             ${DIM}# Speak last health score${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh status${NC}                  ${DIM}# Check TTS/STT engines${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh install-whisper${NC}         ${DIM}# Install offline whisper.cpp${NC}"
    echo ""
    echo -e "  ${BOLD}Free TTS engines:${NC}"
    echo -e "  ${DIM}  macOS: 'say' (built-in, zero setup)${NC}"
    echo -e "  ${DIM}  Linux: espeak-ng (sudo apt install espeak-ng)${NC}"
    echo ""
    echo -e "  ${BOLD}Free STT options:${NC}"
    echo -e "  ${DIM}  Groq Whisper API  — 7200s/day free (GROQ_API_KEY)${NC}"
    echo -e "  ${DIM}  whisper.cpp       — 100% local, offline, free forever${NC}"
    echo -e "  ${DIM}  openai-whisper    — pip install, local, GPU recommended${NC}"
    ;;
esac
echo ""
