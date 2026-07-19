#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
VERSION='1.0.0'
CAREER_DIR="$HOME/.career"
mkdir -p "$CAREER_DIR"

print_header() {
  echo ""
  echo -e "${BLUE}=== Career LinkedIn Coach ===${NC}"
  echo ""
}

usage() {
  cat <<USAGE
Usage:
  ghostforge career-linkedin calendar <topic|file> [--days 30]
  ghostforge career-linkedin post <topic>
  ghostforge career-linkedin list
  ghostforge career-linkedin open [date]
  ghostforge career-linkedin version
USAGE
}

open_in_editor() {
  local file="$1"
  if [[ -n "${EDITOR:-}" ]] && command -v "${EDITOR%% *}" >/dev/null 2>&1; then
    $EDITOR "$file"
  elif command -v code >/dev/null 2>&1; then
    code "$file"
  elif command -v nano >/dev/null 2>&1; then
    nano "$file"
  elif command -v vi >/dev/null 2>&1; then
    vi "$file"
  else
    echo -e "${YELLOW}No editor found. File saved at:${NC} $file"
  fi
}

print_header
ACTION="${1:-help}"

case "$ACTION" in
  calendar)
    shift
    days=30
    parts=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --days)
          days="${2:-30}"
          shift 2
          ;;
        *)
          parts+=("$1")
          shift
          ;;
      esac
    done
    input_value="${parts[*]}"
    if [[ -z "$input_value" ]]; then
      usage
      exit 1
    fi
    if ! [[ "$days" =~ ^[0-9]+$ ]] || [[ "$days" -le 0 ]]; then
      echo -e "${RED}--days must be a positive integer.${NC}"
      exit 1
    fi

    source_label="$input_value"
    source_text="$input_value"
    if [[ -f "$input_value" ]]; then
      source_label="$(basename "$input_value")"
      source_text="$(cat "$input_value")"
    fi

    output_file="$CAREER_DIR/linkedin-calendar-$(date '+%Y-%m-%d').md"
    python3 - "$source_label" "$source_text" "$days" "$output_file" <<'PY'
import re, sys
from pathlib import Path
source_label, source_text, days, output_file = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
formats = ['text', 'carousel', 'poll', 'video']
themes = [
    'career lesson', 'practical tutorial', 'opinion', 'case study', 'mistake to avoid',
    'framework insight', 'team process', 'engineering habit', 'portfolio proof', 'industry trend'
]
hooks = [
    "The biggest lesson I've learned about {topic} is not what most developers expect.",
    "If you're working with {topic}, here is the shortcut I wish I knew earlier.",
    "A lot of teams overcomplicate {topic}; this is the simpler path.",
    "One real-world {topic} challenge changed how I approach delivery.",
    "Before your next project, ask yourself this question about {topic}.",
]
skill_patterns = [
    'react', 'next.js', 'typescript', 'javascript', 'tailwind', 'azure', 'frontend', 'performance',
    'accessibility', 'testing', 'playwright', 'vitest', 'storybook', 'career growth', 'leadership',
    'code review', 'design systems', 'team collaboration', 'ai tooling', 'copilot'
]
text = source_text.lower()
topics = []
for skill in skill_patterns:
    if skill in text:
        topics.append(skill)
if not topics:
    words = re.findall(r'[a-zA-Z][a-zA-Z+.#/-]{3,}', source_text)
    stop = {'with','that','from','this','about','have','your','their','what','when','where','would','could','there','which'}
    for word in words:
        cleaned = word.lower()
        if cleaned not in stop and cleaned not in topics:
            topics.append(cleaned)
        if len(topics) >= 8:
            break
if not topics:
    topics = [source_label]
lines = [
    f'# LinkedIn Content Calendar — {source_label}',
    '',
    f'- Generated: {Path(output_file).stem.split("linkedin-calendar-")[-1]}',
    f'- Days: {days}',
    '',
]
for day in range(1, days + 1):
    topic = topics[(day - 1) % len(topics)]
    fmt = formats[(day - 1) % len(formats)]
    theme = themes[(day - 1) % len(themes)]
    hook = hooks[(day - 1) % len(hooks)].format(topic=topic)
    lines.extend([
        f'{day}. Day {day}',
        f'   - Format: {fmt}',
        f'   - Theme: {theme}',
        f'   - Hook: {hook}',
        ''
    ])
Path(output_file).write_text('\n'.join(lines), encoding='utf-8')
print(output_file)
PY
    echo -e "${GREEN}Saved LinkedIn calendar:${NC} $output_file"
    ;;

  post)
    shift
    topic="$*"
    if [[ -z "$topic" ]]; then
      usage
      exit 1
    fi
    cat <<PROMPT
Create a LinkedIn post about "$topic".

Requirements:
- Audience: frontend engineers, hiring managers, and tech leads
- Tone: credible, practical, and slightly personal
- Structure: hook, insight, short example, takeaway, CTA
- Include 1 concrete lesson and 1 opinionated point
- Keep it under 220 words
- Suggest 3 hashtags
PROMPT
    ;;

  list)
    echo -e "${BLUE}Saved calendars:${NC}"
    if find "$CAREER_DIR" -maxdepth 1 -type f -name 'linkedin-calendar-*.md' | grep -q .; then
      find "$CAREER_DIR" -maxdepth 1 -type f -name 'linkedin-calendar-*.md' -print | sort
    else
      echo -e "${YELLOW}No calendars found.${NC}"
    fi
    ;;

  open)
    date_value="${2:-}"
    if [[ -n "$date_value" ]]; then
      file="$CAREER_DIR/linkedin-calendar-$date_value.md"
    else
      file="$(find "$CAREER_DIR" -maxdepth 1 -type f -name 'linkedin-calendar-*.md' -print | sort | tail -n 1)"
    fi
    if [[ -z "$file" || ! -f "$file" ]]; then
      echo -e "${RED}Calendar not found.${NC}"
      exit 1
    fi
    open_in_editor "$file"
    ;;

  version)
    echo "$VERSION"
    ;;

  help|-h|--help)
    usage
    ;;

  *)
    usage
    exit 1
    ;;
esac
