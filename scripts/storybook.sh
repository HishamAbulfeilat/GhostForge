#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

ACTION="${1:-help}"
shift || true

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  📚  GhostForge Storybook Scaffolder${NC}"
  echo -e "${DIM}  Install Storybook, generate stories, run, and build docs.${NC}"
  echo ""
}

generate_story_file() {
  local component_path="$1"
  [[ -f "$component_path" ]] || {
    echo -e "${RED}✖ File not found: $component_path${NC}"
    return 1
  }
  local component_name story_path rtl_story
  component_name="$(basename "$component_path")"
  component_name="${component_name%.tsx}"
  component_name="${component_name%.jsx}"
  story_path="${component_path%.*}.stories.tsx"
  [[ ! -f "$story_path" ]] || {
    echo -e "${YELLOW}⚠ Story already exists:${NC} $story_path"
    return 0
  }

  rtl_story=""
  if grep -qE 'dir|rtl|ltr' "$component_path" 2>/dev/null; then
    rtl_story=$'\nexport const RTL: Story = {\n  parameters: { dir: \'rtl\' },\n  decorators: [(StoryComponent) => <div dir="rtl"><StoryComponent /></div>],\n};'
  fi

  cat > "$story_path" <<EOF
import type { Meta, StoryObj } from '@storybook/react';
import ${component_name} from './${component_name}';

const meta = {
  title: 'Components/${component_name}',
  component: ${component_name},
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ${component_name}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };
export const Loading: Story = { args: {} };
export const Error: Story = { args: {} };
export const Playground: Story = { args: {} };${rtl_story}
EOF
  echo -e "${GREEN}✅ Generated:${NC} $story_path"
}

install_cmd() {
  header
  if ! npx storybook@latest init --skip-install; then
    echo -e "${YELLOW}⚠ Storybook init failed, falling back to manual install.${NC}"
    npm install -D @storybook/react @storybook/react-vite storybook
  fi
}

scaffold_cmd() {
  local target="${1:-src/components}"
  header
  if [[ -f "$target" ]]; then
    generate_story_file "$target"
    return 0
  fi
  [[ -d "$target" ]] || {
    echo -e "${RED}✖ Directory not found: $target${NC}"
    exit 1
  }
  local count=0
  while IFS= read -r file; do
    generate_story_file "$file" && count=$((count + 1)) || true
  done < <(find "$target" -type f \( -name '*.tsx' -o -name '*.jsx' \) ! -name '*.stories.*' ! -name 'index.*' | sort)
  echo -e "${GREEN}✅ Story scaffolding complete.${NC} ${count} file(s) processed."
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

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/storybook.sh install
  bash scripts/storybook.sh scaffold [dir|component.tsx]
  bash scripts/storybook.sh run
  bash scripts/storybook.sh build
  bash scripts/storybook.sh help
EOF
}

case "$ACTION" in
  install) install_cmd ;;
  scaffold|generate) scaffold_cmd "${1:-src/components}" ;;
  run) run_cmd ;;
  build) build_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
