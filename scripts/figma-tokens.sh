#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

[[ -f .env.local ]] && set -a && . ./.env.local && set +a || true

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🎨  GhostForge Figma Token Sync${NC}"
  echo -e "${DIM}  Figma variables → CSS custom properties + Tailwind hints.${NC}"
  echo ""
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/figma-tokens.sh setup
  bash scripts/figma-tokens.sh preview <file-key>
  bash scripts/figma-tokens.sh sync <file-key>
  bash scripts/figma-tokens.sh help
EOF
}

setup_cmd() {
  header
  read -r -p 'FIGMA_TOKEN: ' token
  [[ -n "$token" ]] || { echo -e "${RED}✖ Token is required.${NC}"; exit 1; }
  if [[ -f .env.local ]] && grep -q '^FIGMA_TOKEN=' .env.local; then
    python3 - <<'PY' "$token"
from pathlib import Path
import re, sys
p = Path('.env.local')
text = p.read_text()
text = re.sub(r'^FIGMA_TOKEN=.*$', f'FIGMA_TOKEN={sys.argv[1]}', text, flags=re.M)
p.write_text(text)
PY
  else
    printf '\nFIGMA_TOKEN=%s\n' "$token" >> .env.local
  fi
  echo -e "${GREEN}✅ Saved FIGMA_TOKEN to .env.local${NC}"
}

fetch_tokens() {
  local key="$1"
  [[ -n "${FIGMA_TOKEN:-}" ]] || { echo -e "${RED}✖ FIGMA_TOKEN is not set. Run setup first.${NC}"; exit 1; }
  curl -fsSL -H "X-Figma-Token: $FIGMA_TOKEN" "https://api.figma.com/v1/files/${key}/variables/local"
}

preview_cmd() {
  local key="${1:-}"
  [[ -n "$key" ]] || { echo -e "${RED}✖ file-key is required.${NC}"; exit 1; }
  header
  fetch_tokens "$key" | python3 - <<'PY'
import json, sys
raw = sys.stdin.read()
data = json.loads(raw)
vars = ((data.get('meta') or {}).get('variables') or {})
for item in list(vars.values())[:80]:
    print('  -', item.get('name', 'unnamed'))
print(f"\n  Total tokens: {len(vars)}")
PY
}

sync_cmd() {
  local key="${1:-}"
  [[ -n "$key" ]] || { echo -e "${RED}✖ file-key is required.${NC}"; exit 1; }
  mkdir -p src/styles
  header
  fetch_tokens "$key" > .ghostforge-figma.json
  python3 - <<'PY'
from pathlib import Path
import json, re

data = json.loads(Path('.ghostforge-figma.json').read_text())
meta = data.get('meta') or {}
variables = meta.get('variables') or {}

def to_css_name(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

def color_to_css(value):
    if not isinstance(value, dict):
        return None
    if {'r', 'g', 'b'}.issubset(value):
        r = round(value['r'] * 255)
        g = round(value['g'] * 255)
        b = round(value['b'] * 255)
        a = value.get('a', 1)
        return f'rgba({r}, {g}, {b}, {a:.3g})' if a != 1 else f'rgb({r}, {g}, {b})'
    return None

css_lines = [':root {']
colors, spacing = {}, {}
for variable in variables.values():
    name = variable.get('name', 'token')
    css_name = to_css_name(name)
    values = variable.get('valuesByMode') or {}
    raw_value = next(iter(values.values()), None)
    value = color_to_css(raw_value)
    if value is None and isinstance(raw_value, (int, float)):
        value = f'{raw_value}px'
    if value is None and isinstance(raw_value, str):
        value = raw_value
    if value is None:
        continue
    css_lines.append(f'  --{css_name}: {value};')
    lower = name.lower()
    if 'color' in lower:
        colors[css_name] = f'var(--{css_name})'
    if 'space' in lower or 'spacing' in lower or 'gap' in lower:
        spacing[css_name] = f'var(--{css_name})'
css_lines.append('}')
Path('src/styles/tokens.css').write_text('\n'.join(css_lines) + '\n')

config = Path('tailwind.config.js')
if config.exists():
    text = config.read_text()
    insert = "colors: {\n" + '\n'.join([f"        '{k}': '{v}'," for k, v in list(colors.items())[:20]]) + "\n      },\n      spacing: {\n" + '\n'.join([f"        '{k}': '{v}'," for k, v in list(spacing.items())[:20]]) + "\n      },\n      "
    if 'extend: {' in text and 'ghostforgeTokens' not in text:
        text = text.replace('extend: {', 'extend: {\n      ghostforgeTokens: true,\n      ' + insert, 1)
        config.write_text(text)
print(f"Wrote src/styles/tokens.css with {len(css_lines)-2} tokens")
PY
  rm -f .ghostforge-figma.json
}

case "$ACTION" in
  setup) setup_cmd ;;
  preview) preview_cmd "${1:-}" ;;
  sync) sync_cmd "${1:-}" ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
