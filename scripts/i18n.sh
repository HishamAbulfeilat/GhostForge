#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🌍  GhostForge i18n / RTL Helper${NC}"
  echo -e "${DIM}  Translate, audit RTL gaps, and extract hardcoded UI strings.${NC}"
  echo ""
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/i18n.sh translate <text> [ar|en]
  bash scripts/i18n.sh audit [dir]
  bash scripts/i18n.sh extract [dir]
  bash scripts/i18n.sh help
EOF
}

translate_cmd() {
  local text="${1:-}"; shift || true
  local lang="${1:-}"
  [[ -z "$text" ]] && { echo -e "${RED}✖ Text is required.${NC}"; exit 1; }
  if [[ -z "$lang" ]]; then
    if printf '%s' "$text" | grep -Eq '^[[:space:][:alnum:][:punct:]]+$'; then lang='ar'; else lang='en'; fi
  fi
  header
  if command -v claude >/dev/null 2>&1; then
    claude -p "Translate this text to ${lang}. Output only the translated text: $text" 2>/dev/null
  else
    echo -e "${YELLOW}⚠ Claude CLI not found. Translation unavailable.${NC}"
  fi
}

audit_cmd() {
  local dir="${1:-.}"
  header
  python3 - <<'PY' "$dir"
from pathlib import Path
import re, sys
base = Path(sys.argv[1])
patterns = [
    (r'text-align\s*:\s*left', 'CSS uses text-align:left without RTL override'),
    (r'text-align\s*:\s*right', 'CSS uses text-align:right without logical fallback'),
    (r'\btext-left\b', 'Tailwind text-left found'),
    (r'\btext-right\b', 'Tailwind text-right found'),
    (r'\bml-|\bmr-|\bpl-|\bpr-', 'Physical spacing class found'),
]
issues = []
rtl_selector_seen = False
rtl_attr_seen = False
for path in base.rglob('*'):
    if path.suffix not in {'.css', '.scss', '.tsx', '.jsx', '.js', '.ts'}:
        continue
    try:
        text = path.read_text(encoding='utf-8', errors='ignore')
    except Exception:
        continue
    if '[dir="rtl"]' in text or "[dir='rtl']" in text or '[dir=rtl]' in text:
        rtl_selector_seen = True
    if 'dir="rtl"' in text or "dir='rtl'" in text:
        rtl_attr_seen = True
    for pattern, label in patterns:
        for idx, line in enumerate(text.splitlines(), start=1):
            if re.search(pattern, line):
                issues.append((str(path), idx, label, line.strip()))
if not rtl_attr_seen:
    print('  ⚠ No dir="rtl" usage found in scanned JSX/HTML files')
if not rtl_selector_seen:
    print('  ⚠ No [dir=rtl] selectors found in scanned stylesheets')
if not issues:
    print('  ✅ No obvious RTL issues found')
else:
    for file, line, label, code in issues[:60]:
        print(f'  - {file}:{line} — {label}')
        print(f'      {code[:140]}')
    print(f'\n  Total issues: {len(issues)}')
PY
}

extract_cmd() {
  local dir="${1:-.}"
  header
  python3 - <<'PY' "$dir"
from pathlib import Path
import re, sys
base = Path(sys.argv[1])
results = []
for path in base.rglob('*.tsx'):
    text = path.read_text(encoding='utf-8', errors='ignore')
    for i, line in enumerate(text.splitlines(), 1):
        if 'http' in line:
            continue
        if re.search(r'[A-Za-z\u0600-\u06FF]{3,}', line):
            if ('<' in line and '>' in line) or ('{"' in line or "{'" in line):
                results.append((str(path), i, line.strip()))
for file, line, code in results[:80]:
    print(f'  - {file}:{line}')
    print(f'      {code[:160]}')
print(f'\n  Candidate strings: {len(results)}')
PY
}

case "$ACTION" in
  translate) translate_cmd "$@" ;;
  audit)     audit_cmd "${1:-.}" ;;
  extract)   extract_cmd "${1:-.}" ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
