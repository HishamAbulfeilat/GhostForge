#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

ACTION="${1:-help}"
if [[ "$ACTION" != "setup" && "$ACTION" != "generate" && "$ACTION" != "list" && "$ACTION" != "help" && "$ACTION" != "--help" && "$ACTION" != "-h" ]]; then
  set -- generate "$@"
  ACTION="generate"
fi
shift || true

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🔌  GhostForge API Mock Generator${NC}"
  echo -e "${DIM}  OpenAPI / Swagger → MSW handler stubs.${NC}"
  echo ""
}

setup_cmd() {
  header
  npm install msw@latest --save-dev
  npx msw init public/
  mkdir -p src/mocks/handlers src/mocks
  [[ -f src/mocks/handlers.ts ]] || echo "export const handlers = [];" > src/mocks/handlers.ts
  cat > src/mocks/browser.ts <<'EOF'
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
EOF
  echo -e "${GREEN}✅ MSW mock setup created in src/mocks/.${NC}"
}

generate_cmd() {
  local spec="${1:-}"
  [[ -n "$spec" ]] || {
    echo -e "${RED}✖ Spec file or URL is required.${NC}"
    exit 1
  }
  mkdir -p src/mocks/handlers src/mocks
  local spec_json=".ghostforge-openapi.json"
  if [[ "$spec" =~ ^https?:// ]]; then
    curl -fsSL "$spec" -o "$spec_json"
  else
    [[ -f "$spec" ]] || {
      echo -e "${RED}✖ Spec not found: $spec${NC}"
      exit 1
    }
    python3 - <<'PY' "$spec" > "$spec_json"
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
try:
    data = json.loads(text)
except Exception:
    try:
        import yaml
        data = yaml.safe_load(text)
    except Exception:
        raise SystemExit("YAML support requires PyYAML or a JSON spec")
print(json.dumps(data))
PY
  fi
  node - <<'NODE' "$spec_json"
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const paths = spec.paths || {};
const resourceBuckets = new Map();

for (const [route, methods] of Object.entries(paths)) {
  const resource = (route.split('/').filter(Boolean)[0] || 'root').replace(/[^a-zA-Z0-9_-]/g, '-') || 'root';
  if (!resourceBuckets.has(resource)) resourceBuckets.set(resource, []);
  for (const [method, op] of Object.entries(methods || {})) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const summary = (op.summary || op.operationId || `${method.toUpperCase()} ${route}`).replace(/'/g, "\\'");
    const normalizedPath = route.replace(/\{([^}]+)\}/g, ':$1');
    resourceBuckets.get(resource).push(`  // ${summary}\n  http.${method}('${normalizedPath}', async () => {\n    return HttpResponse.json({ ok: true, route: '${normalizedPath}', method: '${method.toUpperCase()}' });\n  }),`);
  }
}

for (const [resource, handlers] of resourceBuckets) {
  const file = `src/mocks/handlers/${resource}.ts`;
  fs.writeFileSync(file, `import { http, HttpResponse } from 'msw';\n\nexport const ${resource.replace(/-/g, '_')}Handlers = [\n${handlers.join('\n\n')}\n];\n`);
}

fs.writeFileSync('src/mocks/handlers.ts', Array.from(resourceBuckets.keys()).map(r => `export { ${r.replace(/-/g, '_')}Handlers } from './handlers/${r}';`).join('\n') + '\n');
fs.writeFileSync('src/mocks/browser.ts', `import { setupWorker } from 'msw/browser';\n${Array.from(resourceBuckets.keys()).map(r => `import { ${r.replace(/-/g, '_')}Handlers } from './handlers/${r}';`).join('\n')}\n\nexport const handlers = [${Array.from(resourceBuckets.keys()).map(r => `...${r.replace(/-/g, '_')}Handlers`).join(', ')}];\nexport const worker = setupWorker(...handlers);\n`);
console.log(`Generated ${resourceBuckets.size} handler file(s).`);
NODE
  rm -f "$spec_json"
  echo -e "${GREEN}✅ MSW handlers generated in src/mocks/.${NC}"
}

list_cmd() {
  header
  find src/mocks -maxdepth 2 -type f -name '*.ts' 2>/dev/null | sort | sed 's#^#  - #'
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/api-mock.sh setup
  bash scripts/api-mock.sh generate <spec.json|spec.yaml|url>
  bash scripts/api-mock.sh list
  bash scripts/api-mock.sh help
EOF
}

case "$ACTION" in
  setup) setup_cmd ;;
  generate) generate_cmd "${1:-}" ;;
  list) list_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
