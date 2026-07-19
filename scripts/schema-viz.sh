#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
SELF_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/schema-viz.sh"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🗄️  GhostForge DB Schema Visualizer${NC}"
  echo -e "${DIM}  Detect Prisma or Drizzle schemas and render lightweight ER diagrams.${NC}"
  echo ""
}

detect_schemas() {
  local found=()
  [[ -f prisma/schema.prisma ]] && found+=("prisma/schema.prisma")
  while IFS= read -r file; do
    found+=("$file")
  done < <(find drizzle -type f \( -name '*.ts' -o -name '*.js' \) 2>/dev/null | sort)
  printf '%s\n' "${found[@]}"
}

resolve_schema() {
  if [[ -n "${1:-}" ]]; then
    printf '%s\n' "$1"
    return 0
  fi
  local first
  first="$(detect_schemas | head -1 || true)"
  [[ -n "$first" ]] && printf '%s\n' "$first"
}

parse_schema() {
  python3 - <<'PY' "$1"
import json
import re
import sys
from pathlib import Path
path = Path(sys.argv[1]).expanduser().resolve()
text = path.read_text(encoding='utf-8')
models = []
relations = []
scalars = {'Int','String','Boolean','DateTime','Float','Decimal','Json','Bytes','BigInt'}
if path.name == 'schema.prisma':
    for name, body in re.findall(r'model\s+(\w+)\s*\{(.*?)\n\}', text, re.S):
        fields = []
        for raw in body.splitlines():
            line = raw.strip()
            if not line or line.startswith('@@'):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            field_name, field_type = parts[0], parts[1]
            fields.append(f'{field_name}: {field_type[:8]}')
            base_type = field_type.rstrip('?').rstrip('[]')
            if base_type not in scalars and base_type != name and base_type[:1].isupper():
                relations.append((name, base_type))
        models.append({'name': name, 'fields': fields[:6]})
else:
    table_re = re.compile(r'export\s+const\s+(\w+)\s*=\s*\w*Table\(\s*["\']([^"\']+)["\']\s*,\s*\{(.*?)\}\s*\)', re.S)
    for _, table_name, body in table_re.findall(text):
        fields = []
        for col_name, rest in re.findall(r'(\w+)\s*:\s*([^,]+)', body):
            col_type_match = re.search(r'^(\w+)', rest.strip())
            col_type = col_type_match.group(1) if col_type_match else 'col'
            fields.append(f'{col_name}: {col_type[:8]}')
            ref = re.search(r'references\(\(\)\s*=>\s*(\w+)\.', rest)
            if ref:
                relations.append((table_name, ref.group(1)))
        models.append({'name': table_name, 'fields': fields[:6]})
print(json.dumps({'models': models, 'relations': relations}, indent=2))
PY
}

render_ascii() {
  python3 - <<'PY' "$1"
import json
import sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
models = payload['models']
relations = payload['relations']
for model in models:
    width = max([len(model['name'])] + [len(field) for field in model['fields']] + [13])
    print('┌' + '─' * (width + 2) + '┐')
    print('│ ' + model['name'].center(width) + ' │')
    print('├' + '─' * (width + 2) + '┤')
    for field in model['fields']:
        print('│ ' + field.ljust(width) + ' │')
    print('└' + '─' * (width + 2) + '┘')
    print('')
if relations:
    print('Relations')
    print('─────────')
    seen = set()
    for left, right in relations:
        key = (left, right)
        if key in seen:
            continue
        seen.add(key)
        print(f'{left} ────> {right}')
PY
}

viz_cmd() {
  local schema
  schema="$(resolve_schema "${1:-}")"
  header
  [[ -n "$schema" && -f "$schema" ]] || { echo -e "${YELLOW}⚠ No Prisma or Drizzle schema found.${NC}"; return 0; }
  local scratch=".ghostforge-schema-viz.json"
  parse_schema "$schema" > "$scratch"
  echo -e "${BLUE}Schema:${NC} $schema"
  echo ""
  render_ascii "$scratch"
  rm -f "$scratch"
}

html_cmd() {
  local schema
  schema="$(resolve_schema "${1:-}")"
  header
  [[ -n "$schema" && -f "$schema" ]] || { echo -e "${YELLOW}⚠ No Prisma or Drizzle schema found.${NC}"; return 0; }
  GF_SCHEMA_VIZ_SCRIPT="$SELF_SCRIPT" python3 - <<'PY' "$schema"
import json
import os
import subprocess
import sys
from pathlib import Path
schema = Path(sys.argv[1]).expanduser().resolve()
script = os.environ['GF_SCHEMA_VIZ_SCRIPT']
payload = json.loads(subprocess.check_output(['bash', script, '__internal_parse__', str(schema)], text=True))
boxes = []
for model in payload['models']:
    fields = ''.join(f'<li>{field}</li>' for field in model['fields'])
    boxes.append(f"<section class='box'><h2>{model['name']}</h2><ul>{fields}</ul></section>")
rels = ''.join(f'<li>{left} &rarr; {right}</li>' for left, right in payload['relations']) or '<li>No relations detected</li>'
out = Path('schema-diagram.html')
out.write_text(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Schema Diagram</title>
<style>
body {{ font-family: -apple-system, sans-serif; margin: 32px; background: #f8fafc; color: #0f172a; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }}
.box {{ background: white; border: 2px solid #0ea5e9; border-radius: 14px; padding: 16px; box-shadow: 0 8px 24px rgba(15,23,42,.08); }}
h2 {{ margin: 0 0 12px; color: #0369a1; }}
ul {{ margin: 0; padding-left: 18px; }}
</style></head><body>
<h1>Schema Diagram</h1>
<p><strong>Source:</strong> {schema}</p>
<div class="grid">{''.join(boxes)}</div>
<h2>Relations</h2>
<ul>{rels}</ul>
</body></html>''', encoding='utf-8')
print(out)
PY
  echo -e "${GREEN}✅ Generated schema-diagram.html${NC}"
  open schema-diagram.html >/dev/null 2>&1 || true
}

list_cmd() {
  header
  local found
  found="$(detect_schemas || true)"
  if [[ -z "$found" ]]; then
    echo -e "${YELLOW}⚠ No schema files detected.${NC}"
    return 0
  fi
  printf '%s\n' "$found"
}

help_cmd() {
  header
  cat <<EOF2
Usage:
  bash scripts/schema-viz.sh viz [schema-file]
  bash scripts/schema-viz.sh html [schema-file]
  bash scripts/schema-viz.sh list
  bash scripts/schema-viz.sh help
EOF2
}

case "$ACTION" in
  viz) viz_cmd "${1:-}" ;;
  html) html_cmd "${1:-}" ;;
  list) list_cmd ;;
  __internal_parse__) parse_schema "${1:-}" ;;
  help|--help|-h) help_cmd ;;
  *) help_cmd; exit 1 ;;
esac
