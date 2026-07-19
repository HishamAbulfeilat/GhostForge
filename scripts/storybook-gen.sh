#!/usr/bin/env bash
# /storybook — Generate .stories.tsx for a React component
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
BOLD='\033[1m'

COMPONENT_PATH="${1:-}"

echo ""
echo -e "  ${BOLD}${CYAN}╔══════════════════════════════════╗${NC}"
echo -e "  ${BOLD}${CYAN}║   GhostForge Storybook Scaffolder      ║${NC}"
echo -e "  ${BOLD}${CYAN}╚══════════════════════════════════╝${NC}"
echo ""

if [ -z "$COMPONENT_PATH" ]; then
  echo -e "  ${YELLOW}Usage: bash scripts/storybook-gen.sh <ComponentFile.tsx>${NC}"
  echo -e "  ${YELLOW}Example: bash scripts/storybook-gen.sh src/components/Button.tsx${NC}"
  exit 1
fi

if [ ! -f "$COMPONENT_PATH" ]; then
  echo -e "  ${RED}File not found: $COMPONENT_PATH${NC}"
  exit 1
fi

COMPONENT_NAME=$(basename "$COMPONENT_PATH" .tsx)
COMPONENT_NAME=$(basename "$COMPONENT_NAME" .jsx)
STORY_PATH="${COMPONENT_PATH%.tsx}.stories.tsx"
STORY_PATH="${STORY_PATH%.jsx}.stories.tsx"
DIR=$(dirname "$COMPONENT_PATH")

if [ -f "$STORY_PATH" ]; then
  echo -e "  ${YELLOW}⚠️  Story already exists: $STORY_PATH${NC}"
  echo -e "  Delete it first to regenerate."
  exit 0
fi

echo -e "  Component: ${BOLD}$COMPONENT_NAME${NC}"
echo -e "  Output:    ${BOLD}$STORY_PATH${NC}"
echo ""

# Detect if RTL-relevant (has className or dir prop)
HAS_DIR=$(grep -c "dir\|rtl\|ltr" "$COMPONENT_PATH" 2>/dev/null || echo 0)
RTL_STORY=""
if [ "$HAS_DIR" -gt 0 ]; then
  RTL_STORY='
export const RTL: Story = {
  parameters: { dir: '"'"'rtl'"'"' },
  decorators: [
    (Story) => (
      <div dir="rtl" className="font-sans">
        <Story />
      </div>
    ),
  ],
};'
fi

cat > "$STORY_PATH" << STORY
import type { Meta, StoryObj } from '@storybook/react';
import { ${COMPONENT_NAME} } from './${COMPONENT_NAME}';

const meta = {
  title: 'Components/${COMPONENT_NAME}',
  component: ${COMPONENT_NAME},
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'TODO: Add component description',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ${COMPONENT_NAME}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    // TODO: Add default props
  },
};

export const Loading: Story = {
  args: {
    // TODO: Add loading state props
  },
};

export const Empty: Story = {
  args: {
    // TODO: Add empty state props
  },
};

export const Error: Story = {
  args: {
    // TODO: Add error state props
  },
};
${RTL_STORY}
STORY

echo -e "  ${GREEN}✅ Generated: $STORY_PATH${NC}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "  1. Fill in the ${CYAN}args${NC} for each story"
echo -e "  2. Run Storybook: ${CYAN}npx storybook dev${NC}"
echo -e "  3. Add interaction tests with ${CYAN}play${NC} functions"
echo ""
