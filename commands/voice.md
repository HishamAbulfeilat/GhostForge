# /voice Command

## Purpose
Add free voice features to your toolkit — **Text-to-Speech (TTS)** to hear AI responses, and **Speech-to-Text (STT)** to dictate commands.

## Usage
```bash
/voice speak "Deploy complete — health score 88/100"
/voice listen               # Record 5s and transcribe
/voice read-health          # Speak last health score aloud
/voice status               # Check available TTS/STT engines
/voice install-whisper      # Install local offline STT
```

## TTS — Text to Speech (Free)

| Engine | Platform | Setup |
|---|---|---|
| `say` | macOS | ✅ Built-in — zero setup |
| `espeak-ng` | Linux | `sudo apt install espeak-ng` |
| `espeak` | Linux/macOS | `brew install espeak` |
| `festival` | Linux | `sudo apt install festival` |

macOS users: **nothing to install** — `say` is built into every Mac.

## STT — Speech to Text (Free Options)

| Option | Cost | Setup | Quality |
|---|---|---|---|
| **Groq Whisper API** | Free (7200s/day) | Set `GROQ_API_KEY` in `.env.local` | ⭐⭐⭐⭐⭐ |
| **whisper.cpp** | Free forever | `bash scripts/voice.sh install-whisper` | ⭐⭐⭐⭐⭐ |
| **openai-whisper** | Free (local) | `pip install openai-whisper` | ⭐⭐⭐⭐⭐ |

### Groq Whisper (Easiest Free Option)
```bash
# 1. Sign up at https://console.groq.com (free)
# 2. Add to ~/ghostforge/.env.local:
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
# 3. Now /voice listen works with cloud transcription
```
Free tier: **7,200 seconds/day** (~2 hours of audio) — plenty for daily dev use.

### whisper.cpp (100% Offline)
```bash
bash ~/ghostforge/scripts/voice.sh install-whisper
# Downloads whisper.cpp + base English model (~140MB)
# Works completely offline, forever free
```

## Examples
```bash
# Hear your health score
bash ~/ghostforge/scripts/voice.sh read-health

# Speak any message
bash ~/ghostforge/scripts/voice.sh speak "Build failed on main branch"

# Transcribe 10 seconds of speech
bash ~/ghostforge/scripts/voice.sh listen 10

# Check what's available
bash ~/ghostforge/scripts/voice.sh status
```

## Notes
- TTS runs in background (non-blocking)
- Transcripts are auto-copied to clipboard when pbcopy/xclip is available
- All options listed here are free — no paid subscription required
