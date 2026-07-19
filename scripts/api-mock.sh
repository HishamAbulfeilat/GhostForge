#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🔌  GhostForge API Mock Generator${NC}"
  echo -e "${DIM}  OpenAPI → MSW handler stubs.${NC}"
  echo ""
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/api-mock.sh setup
  bash scripts/api-mock.sh generate <spec.json|spec.yaml>
  bash scripts/api-mock.sh list
  bash scripts/api-mock.sh help
EOF
}

setup_cmd() {
  header
  npm install msw@latest --save-dev
  npx msw init public/
  mkdir -p src/mocks
  cat > src/mocks/browser.ts <<'EOF'
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
EOF
  [[ -f src/mocks/handlers.ts ]] || cat > src/mocks/handlers.ts <<'EOF'
export const handlers = [];
EOF
  echo -e "${GREEN}✅ MSW mock setup created in src/mocks/.${NC}"
}

generate_cmd() {
  local spec="${1:-}"
  [[ -n "$spec" ]] || { echo -e "${RED}✖ Spec file is required.${NC}"; exit 1; }
  [[ -f "$spec" ]] || { echo -e "${RED}✖ Spec not found: $spec${NC}"; exit 1; }
  mkdir -p src/mocks/handlers src/mocks
  python3 - <<'PY' "$spec" > .ghostforge-openapi.json
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
try:
    data = json.loads(text)
except Exception:
    try:
        import yaml
        data = yaml.safe_load(text)
    except Exception:
        raise SystemExit('YAML support requires python package PyYAML or use JSON spec')
print(json.dumps(data))
PY
  node - <<'NODE'
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync('.ghostforge-openapi.json', 'utf8'));
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
fs.writeFileSync(
  'src/mocks/handlers.ts',
  Array.from(resourceBuckets.keys()).map(r => `export { ${r.replace(/-/g, '_')}Handlers } from './handlers/${r}';`).join('\n') + '\n'
);
fs.writeFileSync(
  'src/mocks/browser.ts',
  `import { setupWorker } from 'msw/browser';\n${Array.from(resourceBuckets.keys()).map(r => `import { ${r.replace(/-/g, '_')}Handlers } from './handlers/${r}';`).join('\n')}\n\nexport const handlers = [${Array.from(resourceBuckets.keys()).map(r => `...${r.replace(/-/g, '_')}Handlers`).join(', ')}];\nexport const worker = setupWorker(...handlers);\n`
);
console.log(`Generated ${resourceBuckets.size} handler files.`);
NODE
  rm -f .ghostforge-openapi.json
}

list_cmd() {
  header
  find src/mocks/handlers -maxdepth 1 -type f -name '*.ts' 2>/dev/null | sort | sed 's#^#  - #'
}

case "$ACTION" in
  setup) setup_cmd ;;
  generate) generate_cmd "${1:-}" ;;
  list) list_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
