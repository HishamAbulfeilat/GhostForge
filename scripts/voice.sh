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
  if command -v edge-tts &>/dev/null; then echo "edge-tts"  # Neural AI voices (best free)
  elif python3 -c "import edge_tts" &>/dev/null 2>&1; then echo "edge-tts-py"
  elif command -v say &>/dev/null; then echo "say"          # macOS built-in
  elif command -v espeak-ng &>/dev/null; then echo "espeak-ng"
  elif command -v espeak &>/dev/null; then echo "espeak"
  elif command -v festival &>/dev/null; then echo "festival"
  else echo "none"; fi
}

VOICE_DEFAULT="${GHOSTFORGE_VOICE:-en-US-AriaNeural}"  # Neural voice — change in .env.local

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

# ── play audio file ────────────────────────────────────────────────────────────
play_audio() {
  local file="$1"
  if command -v afplay &>/dev/null; then afplay "$file" 2>/dev/null
  elif command -v mpg123 &>/dev/null; then mpg123 -q "$file" 2>/dev/null
  elif command -v ffplay &>/dev/null; then ffplay -nodisp -autoexit -loglevel quiet "$file" 2>/dev/null
  elif command -v aplay &>/dev/null; then aplay -q "$file" 2>/dev/null
  else echo -e "  ${YELLOW}⚠  No audio player found to play the file.${NC}"; fi
}

# ── speak ──────────────────────────────────────────────────────────────────────
speak() {
  local msg="$1"
  local voice="${2:-$VOICE_DEFAULT}"
  # Strip ANSI escape codes
  msg=$(echo "$msg" | sed 's/\x1B\[[0-9;]*[mK]//g')
  case "$TTS_ENGINE" in
    edge-tts)
      local tmp_file="/tmp/ghostforge-voice-$$.mp3"
      edge-tts --voice "$voice" --text "$msg" --write-media "$tmp_file" 2>/dev/null && \
        play_audio "$tmp_file" && rm -f "$tmp_file" &
      ;;
    edge-tts-py)
      local tmp_file="/tmp/ghostforge-voice-$$.mp3"
      python3 -c "
import asyncio, edge_tts, sys
async def run():
    c = edge_tts.Communicate('$msg', '$voice')
    await c.save('$tmp_file')
asyncio.run(run())
" 2>/dev/null && play_audio "$tmp_file" && rm -f "$tmp_file" &
      ;;
    say)
      say -r 185 -v Samantha "$msg" 2>/dev/null &
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
      echo -e "  ${YELLOW}⚠  No TTS engine found. Run: bash scripts/voice.sh install-voice-model${NC}"
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

  install-voice-model)
    echo -e "  ${BLUE}${BOLD}Installing edge-tts — Free Neural AI Voice Model${NC}"
    echo -e "  ${DIM}Microsoft Edge neural voices · No API key · 400+ voices · Neural quality${NC}"
    echo ""
    if command -v pip3 &>/dev/null || command -v pip &>/dev/null; then
      PIP=$(command -v pip3 || command -v pip)
      echo -e "  ${DIM}Installing edge-tts via pip...${NC}"
      $PIP install edge-tts --quiet && echo -e "  ${GREEN}✅ edge-tts installed!${NC}" || {
        echo -e "  ${YELLOW}⚠  pip install failed, trying with --user flag...${NC}"
        $PIP install --user edge-tts --quiet
      }
      echo ""
      echo -e "  ${GREEN}${BOLD}Done! Neural voices are now active.${NC}"
      echo -e "  ${DIM}  Default voice: en-US-AriaNeural (female, natural)${NC}"
      echo -e "  ${DIM}  Change voice: add GHOSTFORGE_VOICE=en-US-GuyNeural to .env.local${NC}"
      echo -e "  ${DIM}  List all voices: bash scripts/voice.sh voices${NC}"
      echo ""
      echo -e "  ${CYAN}Try it now:${NC}"
      echo -e "  ${DIM}  bash scripts/voice.sh speak \"Hello, I am your AI developer assistant\"${NC}"
    else
      echo -e "  ${RED}✖  Python pip not found.${NC}"
      echo -e "  ${DIM}  Install Python 3: https://python.org/downloads${NC}"
      echo -e "  ${DIM}  macOS: brew install python3${NC}"
    fi
    ;;

  voices|list-voices)
    echo -e "  ${BOLD}Available neural voices (edge-tts):${NC}"
    echo ""
    if command -v edge-tts &>/dev/null || python3 -c "import edge_tts" &>/dev/null 2>&1; then
      echo -e "  ${DIM}Fetching voice list...${NC}"
      if command -v edge-tts &>/dev/null; then
        edge-tts --list-voices 2>/dev/null | grep -E "en-US|en-GB|ar-SA|ar-EG" | head -30
      else
        python3 -c "
import asyncio, edge_tts
async def run():
    voices = await edge_tts.list_voices()
    for v in voices:
        if v['Locale'].startswith('en-US') or v['Locale'].startswith('en-GB') or v['Locale'].startswith('ar-'):
            print(f\"  {v['ShortName']:<35} {v['Gender']:<8} {v['Locale']}\")
asyncio.run(run())
" 2>/dev/null
      fi
      echo ""
      echo -e "  ${DIM}Set your preferred voice: add GHOSTFORGE_VOICE=<ShortName> to .env.local${NC}"
      echo -e "  ${DIM}Popular voices:${NC}"
      echo -e "  ${DIM}  en-US-AriaNeural   — Female, conversational (default)${NC}"
      echo -e "  ${DIM}  en-US-GuyNeural    — Male, neutral${NC}"
      echo -e "  ${DIM}  en-US-JennyNeural  — Female, friendly${NC}"
      echo -e "  ${DIM}  en-GB-SoniaNeural  — Female, British${NC}"
      echo -e "  ${DIM}  ar-SA-ZariyahNeural — Female, Arabic${NC}"
      echo -e "  ${DIM}  ar-EG-SalmaNeural  — Female, Egyptian Arabic${NC}"
    else
      echo -e "  ${YELLOW}edge-tts not installed. Run: bash scripts/voice.sh install-voice-model${NC}"
    fi
    ;;

  status)
    echo -e "  ${BOLD}Voice capabilities:${NC}"
    echo ""
    echo -e "  TTS (text-to-speech):"
    case "$TTS_ENGINE" in
      edge-tts|edge-tts-py)
        echo -e "    ${GREEN}● edge-tts Microsoft Neural AI — active ⭐ best free quality${NC}"
        echo -e "    ${DIM}    Voice: $VOICE_DEFAULT${NC}"
        echo -e "    ${DIM}    List voices: bash scripts/voice.sh voices${NC}"
        ;;
      say) echo -e "    ${YELLOW}● macOS 'say' — active (robotic)${NC}"; echo -e "    ${DIM}    Upgrade to neural: bash scripts/voice.sh install-voice-model${NC}" ;;
      espeak-ng|espeak) echo -e "    ${YELLOW}● espeak — active (robotic)${NC}"; echo -e "    ${DIM}    Upgrade to neural: bash scripts/voice.sh install-voice-model${NC}" ;;
      none)
        echo -e "    ${RED}○ No TTS engine${NC}"
        echo -e "    ${DIM}    Install neural AI voice: bash scripts/voice.sh install-voice-model${NC}"
        ;;
    esac
    echo ""
    echo -e "  STT (speech-to-text):"
    case "$STT_ENGINE" in
      whisper) echo -e "    ${GREEN}● Whisper (local) — available${NC}" ;;
      whisper-cpp-local) echo -e "    ${GREEN}● whisper.cpp (local, offline) — installed${NC}" ;;
      groq) echo -e "    ${GREEN}● Groq Whisper API — configured (7200s/day free)${NC}" ;;
      none)
        echo -e "    ${RED}○ No STT engine${NC}"
        echo -e "    ${DIM}    Options: bash scripts/voice.sh install-whisper  OR  set GROQ_API_KEY${NC}"
        ;;
    esac
    ;;

  help|*)
    echo -e "  ${BOLD}Usage:${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh install-voice-model${NC}  ${DIM}# Install neural AI voices (recommended first step)${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh speak \"Hello world\"${NC}  ${DIM}# TTS: speak text with neural voice${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh voices${NC}               ${DIM}# List all 400+ neural voices${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh listen 5${NC}             ${DIM}# STT: record 5s and transcribe${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh read-health${NC}          ${DIM}# Speak last health score${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh status${NC}               ${DIM}# Check TTS/STT engines${NC}"
    echo -e "  ${CYAN}bash scripts/voice.sh install-whisper${NC}      ${DIM}# Install offline whisper.cpp (STT)${NC}"
    echo ""
    echo -e "  ${BOLD}⭐ Best free neural AI voice (recommended):${NC}"
    echo -e "  ${DIM}  edge-tts — Microsoft Edge neural voices, zero cost, no API key${NC}"
    echo -e "  ${DIM}  400+ voices · English, Arabic, 100+ languages${NC}"
    echo -e "  ${DIM}  Same engine as Azure Cognitive Services TTS (normally \$16/million chars)${NC}"
    echo -e "  ${DIM}  Install: bash scripts/voice.sh install-voice-model${NC}"
    echo ""
    echo -e "  ${BOLD}Customise voice:${NC}"
    echo -e "  ${DIM}  Add to .env.local: GHOSTFORGE_VOICE=en-US-GuyNeural${NC}"
    echo -e "  ${DIM}  Arabic female: GHOSTFORGE_VOICE=ar-SA-ZariyahNeural${NC}"
    ;;
esac
echo ""
