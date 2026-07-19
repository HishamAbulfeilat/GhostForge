#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
SELF_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/api-docs.sh"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  📖  GhostForge API Docs Generator${NC}"
  echo -e "${DIM}  Scan route files and generate Markdown or OpenAPI documentation.${NC}"
  echo ""
}

scan_python() {
  python3 - <<'PY' "$1" "$2"
import json
import re
import sys
from pathlib import Path

base = Path(sys.argv[1]).expanduser().resolve()
mode = sys.argv[2]


def first_doc(text):
    match = re.search(r'/\*\*(.*?)\*/', text, re.S)
    if not match:
        return ''
    lines = []
    for raw in match.group(1).splitlines():
        cleaned = re.sub(r'^\s*\*\s?', '', raw).strip()
        if cleaned and not cleaned.startswith('@'):
            lines.append(cleaned)
    return ' '.join(lines).strip()


def infer_description(path: Path):
    name = path.stem if path.name not in {'route.ts', 'route.js'} else path.parent.name
    return name.replace('-', ' ').replace('_', ' ').title() + ' endpoint'


def type_hints(text):
    req = re.findall(r'(?:interface|type)\s+([A-Za-z0-9_]*(?:Request|Body))\b', text)
    res = re.findall(r'(?:interface|type)\s+([A-Za-z0-9_]*(?:Response|Result))\b', text)
    return ', '.join(req[:2]) or 'Not inferred', ', '.join(res[:2]) or 'Not inferred'


def next_path(file: Path, framework: str):
    rel = file.relative_to(base).as_posix()
    if framework == 'next-app':
        segment = rel.split('app/api/', 1)[1].rsplit('/route.', 1)[0]
        return '/' + segment
    segment = rel.split('pages/api/', 1)[1]
    segment = re.sub(r'\.(t|j)sx?$', '', segment)
    segment = segment[:-6] if segment.endswith('/index') else segment
    return '/api/' + segment


routes = []
seen = set()

for file in list(base.rglob('route.ts')) + list(base.rglob('route.js')):
    if 'app/api/' not in file.as_posix():
        continue
    try:
        text = file.read_text(encoding='utf-8')
    except Exception:
        continue
    doc = first_doc(text) or infer_description(file)
    req_hint, res_hint = type_hints(text)
    methods = re.findall(r'export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b', text)
    methods += re.findall(r'export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b', text)
    methods = methods or ['GET']
    path = next_path(file, 'next-app')
    for method in methods:
        key = (method, path, str(file))
        if key in seen:
            continue
        seen.add(key)
        routes.append({'method': method, 'path': path, 'framework': 'next-app', 'file': str(file.relative_to(base)), 'description': doc, 'request': req_hint, 'response': res_hint})

for pattern in ('pages/api/**/*.ts', 'pages/api/**/*.js'):
    for file in base.glob(pattern):
        try:
            text = file.read_text(encoding='utf-8')
        except Exception:
            continue
        doc = first_doc(text) or infer_description(file)
        req_hint, res_hint = type_hints(text)
        methods = re.findall(r"req\.method\s*===\s*['\"](GET|POST|PUT|PATCH|DELETE)['\"]", text)
        methods = [m.upper() for m in methods] or ['GET']
        path = next_path(file, 'next-pages')
        for method in methods:
            key = (method, path, str(file))
            if key in seen:
                continue
            seen.add(key)
            routes.append({'method': method, 'path': path, 'framework': 'next-pages', 'file': str(file.relative_to(base)), 'description': doc, 'request': req_hint, 'response': res_hint})

for file in base.rglob('*'):
    if file.suffix not in {'.js', '.ts'}:
        continue
    try:
        text = file.read_text(encoding='utf-8')
    except Exception:
        continue
    if not re.search(r'\b(?:router|app)\.(get|post|put|patch|delete)\s*\(', text):
        continue
    doc = first_doc(text) or infer_description(file)
    req_hint, res_hint = type_hints(text)
    for method, route_path in re.findall(r"\b(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)", text, re.I):
        key = (method.upper(), route_path, str(file))
        if key in seen:
            continue
        seen.add(key)
        routes.append({'method': method.upper(), 'path': route_path, 'framework': 'express', 'file': str(file.relative_to(base)), 'description': doc, 'request': req_hint, 'response': res_hint})

routes.sort(key=lambda item: (item['path'], item['method']))
if mode == 'json':
    print(json.dumps(routes, indent=2))
else:
    print(f"Found {len(routes)} routes in {base}")
    print('')
    for route in routes:
        print(f"{route['method']:<7} {route['path']:<28} {route['framework']:<11} {route['file']}")
        print(f"         {route['description']}")
PY
}

scan_cmd() {
  local dir="${1:-.}"
  header
  scan_python "$dir" text
}

markdown_cmd() {
  local dir="${1:-.}"
  header
  GF_API_DOCS_SCRIPT="$SELF_SCRIPT" python3 - <<'PY' "$dir"
import json
import os
import subprocess
import sys
from pathlib import Path
base = Path(sys.argv[1]).expanduser().resolve()
script = os.environ['GF_API_DOCS_SCRIPT']
routes = json.loads(subprocess.check_output(['bash', script, '__internal_scan__', str(base)], text=True))
out = Path('API_DOCS.md')
lines = ['# API Docs', '', f'Generated from `{base}`.', '', '| Method | Path | Description | Request | Response |', '|---|---|---|---|---|']
for route in routes:
    lines.append(f"| {route['method']} | `{route['path']}` | {route['description']} | `{route['request']}` | `{route['response']}` |")
out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(out)
PY
  echo -e "${GREEN}✅ Generated API_DOCS.md${NC}"
}

openapi_cmd() {
  local dir="${1:-.}"
  header
  GF_API_DOCS_SCRIPT="$SELF_SCRIPT" python3 - <<'PY' "$dir"
import json
import os
import subprocess
import sys
from pathlib import Path
base = Path(sys.argv[1]).expanduser().resolve()
script = os.environ['GF_API_DOCS_SCRIPT']
routes = json.loads(subprocess.check_output(['bash', script, '__internal_scan__', str(base)], text=True))
doc = {
    'openapi': '3.0.0',
    'info': {'title': f'{base.name} API', 'version': '1.0.0'},
    'paths': {}
}
for route in routes:
    route_path = route['path']
    method = route['method'].lower()
    doc['paths'].setdefault(route_path, {})[method] = {
        'summary': route['description'],
        'operationId': f"{method}_{route_path.strip('/').replace('/', '_') or 'root'}",
        'responses': {'200': {'description': route['response']}},
    }
out = Path('openapi.json')
out.write_text(json.dumps(doc, indent=2) + '\n', encoding='utf-8')
print(out)
PY
  echo -e "${GREEN}✅ Generated openapi.json${NC}"
}

serve_cmd() {
  header
  [[ -f openapi.json ]] || { echo -e "${YELLOW}⚠ openapi.json not found. Run openapi first.${NC}"; return 0; }
  npx @redocly/cli preview-docs openapi.json
}

help_cmd() {
  header
  cat <<EOF2
Usage:
  bash scripts/api-docs.sh scan [dir]
  bash scripts/api-docs.sh openapi [dir]
  bash scripts/api-docs.sh markdown [dir]
  bash scripts/api-docs.sh serve
  bash scripts/api-docs.sh help
EOF2
}

case "$ACTION" in
  scan) scan_cmd "${1:-.}" ;;
  markdown) markdown_cmd "${1:-.}" ;;
  openapi) openapi_cmd "${1:-.}" ;;
  serve) serve_cmd ;;
  __internal_scan__) scan_python "${1:-.}" json ;;
  help|--help|-h) help_cmd ;;
  *) help_cmd; exit 1 ;;
esac
