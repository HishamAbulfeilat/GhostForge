#!/usr/bin/env bash
# ============================================================
# Copy GhostForge to an existing project
# Usage: bash copy-to-project.sh /path/to/your/project
# ============================================================

set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$(pwd)}"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

echo -e "${BLUE}${BOLD}🔗 GhostForge Toolkit → Copy to existing project${NC}"
echo -e "   Target: ${YELLOW}$TARGET${NC}"
echo ""

mkdir -p "$TARGET/.github/workflows" "$TARGET/.vscode" "$TARGET/ghostforge"

cp "$GHOSTFORGE_DIR/.github/copilot-instructions.md" "$TARGET/.github/"
echo -e "${GREEN}✅ .github/copilot-instructions.md${NC} — Copilot now reads GhostForge instructions"

cp "$GHOSTFORGE_DIR/.github/workflows/"*.yml "$TARGET/.github/workflows/" 2>/dev/null || true
echo -e "${GREEN}✅ .github/workflows/${NC} — PR review + deploy + QA pipelines"

cp "$GHOSTFORGE_DIR/.vscode/settings.json" "$TARGET/.vscode/"
cp "$GHOSTFORGE_DIR/.vscode/extensions.json" "$TARGET/.vscode/"
echo -e "${GREEN}✅ .vscode/${NC} — VS Code settings with Copilot auto-read"

cp -r "$GHOSTFORGE_DIR/agents"       "$TARGET/ghostforge/"
cp -r "$GHOSTFORGE_DIR/commands"     "$TARGET/ghostforge/"
cp -r "$GHOSTFORGE_DIR/instructions" "$TARGET/ghostforge/"
cp -r "$GHOSTFORGE_DIR/prompts"      "$TARGET/ghostforge/"
cp -r "$GHOSTFORGE_DIR/snippets"     "$TARGET/ghostforge/"
cp "$GHOSTFORGE_DIR/ghostforge-config.schema.json" "$TARGET/"
echo -e "${GREEN}✅ ghostforge/${NC} — Agents, commands, instructions, prompts, snippets"
echo -e "${GREEN}✅ ghostforge-config.schema.json${NC} — Project config schema"

echo ""
echo -e "${BOLD}✅ Done! Open the project in VS Code:${NC}"
echo -e "   code $TARGET"
echo ""
echo -e "   Copilot Chat is now powered by the full GhostForge toolkit."
echo -e "   Try: ${YELLOW}/setup${NC}, ${YELLOW}/optimize${NC}, ${YELLOW}/security${NC}, ${YELLOW}/tickets${NC}"
