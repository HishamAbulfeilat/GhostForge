#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  📚  GhostForge Storybook Scaffolder${NC}"
  echo -e "${DIM}  Install Storybook, generate stories, run or build docs.${NC}"
  echo ""
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/storybook.sh install
  bash scripts/storybook.sh scaffold [dir]
  bash scripts/storybook.sh run
  bash scripts/storybook.sh build
  bash scripts/storybook.sh help
EOF
}

install_cmd() {
  header
  if ! npx storybook@latest init --skip-install; then
    echo -e "${YELLOW}⚠ Storybook init failed, falling back to manual install.${NC}"
    npm install -D @storybook/react @storybook/react-vite storybook
  fi
}

scaffold_cmd() {
  local dir="${1:-src/components}"
  header
  python3 - <<'PY' "$dir"
from pathlib import Path
import sys
base = Path(sys.argv[1])
count = 0
for path in base.rglob('*.tsx'):
    if path.name.endswith('.stories.tsx') or path.name.startswith('index.'):
        continue
    story = path.with_name(path.stem + '.stories.tsx')
    if story.exists():
        continue
    component = path.stem
    story.write_text(f"""import type {{ Meta, StoryObj }} from '@storybook/react';
import {{ {component} }} from './{component}';

const meta = {{
  title: 'Components/{component}',
  component: {component},
  tags: ['autodocs'],
}} satisfies Meta<typeof {component}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {{ args: {{}} }};
export const Playground: Story = {{ args: {{}} }};
""", encoding='utf-8')
    count += 1
print(f"Generated {count} story files.")
PY
}

run_cmd() {
  header
  if npm run storybook >/dev/null 2>&1; then
    npm run storybook
  else
    npx storybook dev
  fi
}

build_cmd() {
  header
  npm run build-storybook
}

case "$ACTION" in
  install) install_cmd ;;
  scaffold) scaffold_cmd "${1:-src/components}" ;;
  run) run_cmd ;;
  build) build_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
