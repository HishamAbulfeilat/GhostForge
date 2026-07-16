#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════╗
# ║   GhostForge AI — Generator                                    ║
# ║   Create new agents, commands, skills, plugins            ║
# ╚═══════════════════════════════════════════════════════════╝
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="$GHOSTFORGE_DIR/marketplace/registry.json"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; CYAN='\033[0;36m'; NC='\033[0m'

divider() { echo -e "${DIM}══════════════════════════════════════════════════════${NC}"; }
prompt()   { local var_name="$1" msg="$2" default="${3:-}"; read -rp "  $msg${default:+ [$default]}: " "$var_name"; [[ -z "${!var_name}" && -n "$default" ]] && eval "$var_name='$default'"; }

header() {
  echo -e "${BLUE}${BOLD}  ⚡ GhostForge Generator${NC}"
  divider
  echo ""
}

slugify() { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//'; }

register_item() {
  local type="$1" name="$2" file="$3"
  if command -v node >/dev/null 2>&1 && [[ -f "$REGISTRY" ]]; then
    node -e "
const fs = require('fs');
const reg = JSON.parse(fs.readFileSync('$REGISTRY', 'utf8'));
reg.installed = reg.installed || [];
reg.installed.push({ id: '$(slugify "$name")', type: '$type', name: '$name', file: '$file', createdAt: new Date().toISOString() });
fs.writeFileSync('$REGISTRY', JSON.stringify(reg, null, 2));
" 2>/dev/null || true
  fi
}

generate_agent() {
  header
  echo -e "${BLUE}${BOLD}  🤖 Creating a New Agent${NC}\n"
  
  prompt name       "Agent name (e.g. 'Shopify Expert')"
  [[ -z "${name:-}" ]] && echo -e "${RED}Name required${NC}" && exit 1
  
  local slug; slug="$(slugify "$name")"
  prompt description "Description"
  prompt role        "Role / area of expertise"
  prompt trigger     "Trigger phrase" "act as $slug"
  prompt tools       "Key technologies (comma-separated)"
  prompt tags        "Tags (comma-separated)"
  
  local output_file="$GHOSTFORGE_DIR/marketplace/custom-agents/${slug}.md"
  
  cat > "$output_file" <<EOF
# ${name} Agent

## Role
${role:-${description:-AI assistant}}

## Trigger
User says: "${trigger}"

## Expertise
$(echo "${tools:-General expertise}" | tr ',' '\n' | sed 's/^ *//' | sed 's/^/- /')

## Behavior
When activated as the ${name} agent:
1. Acknowledge the role switch: "Switching to ${name} mode 🎯"
2. Apply all ${name} conventions and best practices
3. Use ${tools:-relevant tools} effectively
4. Follow GhostForge coding standards (TypeScript strict, ESLint + Prettier)
5. Provide domain-specific recommendations and patterns

## Key Guidelines
- ${description:-Provide expert assistance}
- Always follow project conventions
- Write clean, maintainable, tested code
- Suggest ${name}-specific tools and libraries when appropriate

## Example Activation
\`\`\`
User: act as ${trigger#act as }
AI: ✅ ${name} mode active. I'll focus on ${role:-your domain}. What would you like to build?
\`\`\`

## Tags
${tags:-${slug}}
EOF

  echo -e "\n${GREEN}${BOLD}  ✅ Agent created: ${output_file#$GHOSTFORGE_DIR/}${NC}"
  echo -e "${DIM}  Use in Copilot Chat: \"${trigger}\"${NC}"
  register_item "agent" "$name" "${output_file#$GHOSTFORGE_DIR/}"
}

generate_command() {
  header
  echo -e "${BLUE}${BOLD}  ⚡ Creating a New Command${NC}\n"
  
  prompt name        "Command name (e.g. 'analyze-bundle')"
  [[ -z "${name:-}" ]] && echo -e "${RED}Name required${NC}" && exit 1
  
  local slug; slug="$(slugify "$name")"
  prompt description "Description (what does this command do?)"
  prompt usage       "Usage / flags" "/${slug}"
  prompt behavior    "What does the AI do step by step?"
  prompt tags        "Tags (comma-separated)"
  
  local output_file="$GHOSTFORGE_DIR/marketplace/custom-commands/${slug}.md"
  
  cat > "$output_file" <<EOF
# /${slug} Command

## Purpose
${description:-${name} command}

## Usage
\`\`\`bash
${usage:-/${slug}}
/${slug} --help
\`\`\`

## What AI Does
${behavior:-1. Analyzes the current project
2. Applies ${name} logic
3. Reports findings and suggestions}

## Examples
\`\`\`bash
/${slug}
/${slug} --verbose
/${slug} /path/to/project
\`\`\`

## Output
The AI provides:
- Summary of findings
- Actionable recommendations
- Code changes (when applicable)

## Tags
${tags:-${slug}}
EOF

  echo -e "\n${GREEN}${BOLD}  ✅ Command created: ${output_file#$GHOSTFORGE_DIR/}${NC}"
  echo -e "${DIM}  Use in Copilot Chat: /${slug}${NC}"
  echo -e "${DIM}  Add to .github/copilot-instructions.md to activate it${NC}"
  register_item "command" "$name" "${output_file#$GHOSTFORGE_DIR/}"
}

generate_skill() {
  header
  echo -e "${BLUE}${BOLD}  🎯 Creating a New Skill${NC}\n"
  
  prompt name        "Skill name (e.g. 'my-linter')"
  [[ -z "${name:-}" ]] && echo -e "${RED}Name required${NC}" && exit 1
  
  local slug; slug="$(slugify "$name")"
  prompt description "Description"
  prompt trigger     "When should this skill run? (e.g. 'after editing React files')"
  prompt command     "CLI command to run" "npx ${slug}"
  
  local skill_dir="$GHOSTFORGE_DIR/.copilot/skills/${slug}"
  mkdir -p "$skill_dir"
  
  cat > "$skill_dir/SKILL.md" <<EOF
---
name: ${slug}
description: ${description}. ${trigger:+Use when $trigger.}
version: "1.0.0"
---

# ${name} Skill

${description}

## When to Run
${trigger:-When the user asks to run ${name}}

## Command
\`\`\`bash
${command}
\`\`\`

## After Running
Review the output. If issues are found:
1. Read each issue carefully
2. Fix issues by severity (errors first, then warnings)
3. Re-run to verify: \`${command} --scope changed\`
4. Report what was fixed and what remains
EOF

  echo -e "\n${GREEN}${BOLD}  ✅ Skill created: .copilot/skills/${slug}/SKILL.md${NC}"
  echo -e "${DIM}  The Copilot coding agent will use this skill automatically${NC}"
  register_item "skill" "$name" ".copilot/skills/${slug}/SKILL.md"
}

generate_instruction() {
  header
  echo -e "${BLUE}${BOLD}  📚 Creating a New Instruction Pack${NC}\n"
  
  prompt name        "Topic name (e.g. 'Shopify Liquid')"
  [[ -z "${name:-}" ]] && echo -e "${RED}Name required${NC}" && exit 1
  
  local slug; slug="$(slugify "$name")"
  prompt description "Brief description"
  prompt patterns    "Key patterns / rules (comma-separated)"
  prompt tags        "Tags"
  
  local output_file="$GHOSTFORGE_DIR/instructions/custom-${slug}.md"
  
  cat > "$output_file" <<EOF
# ${name} — GhostForge Instructions

## Overview
${description:-${name} best practices and guidelines}

## Key Patterns
$(echo "${patterns:-Follow best practices}" | tr ',' '\n' | sed 's/^ *//' | sed 's/^/- /')

## Guidelines
When working with ${name}:
1. ${description:-Follow established conventions}
2. Apply GhostForge coding standards
3. Use TypeScript where possible
4. Write comprehensive tests
5. Document complex logic

## Common Patterns

### Setup
\`\`\`bash
# Installation / setup for ${name}
\`\`\`

### Usage
\`\`\`typescript
// Example usage
\`\`\`

## Anti-patterns to Avoid
- Avoid common mistakes in ${name}
- Don't bypass security checks
- Don't ignore TypeScript errors

## Tags
${tags:-${slug}}
EOF

  echo -e "\n${GREEN}${BOLD}  ✅ Instruction created: ${output_file#$GHOSTFORGE_DIR/}${NC}"
  echo -e "${DIM}  Add to .vscode/settings.json codeGeneration.instructions to activate${NC}"
  register_item "instruction" "$name" "${output_file#$GHOSTFORGE_DIR/}"
}

generate_plugin() {
  header
  echo -e "${BLUE}${BOLD}  📦 Creating a New Plugin${NC}\n"
  
  prompt name        "Plugin name (e.g. 'shopify-toolkit')"
  [[ -z "${name:-}" ]] && echo -e "${RED}Name required${NC}" && exit 1
  
  local slug; slug="$(slugify "$name")"
  prompt description "Description"
  prompt tags        "Tags"
  
  local plugin_dir="$GHOSTFORGE_DIR/plugins/${slug}"
  mkdir -p "$plugin_dir/agents" "$plugin_dir/commands" "$plugin_dir/instructions"
  
  cat > "$plugin_dir/README.md" <<EOF
# ${name} Plugin

${description:-A collection of ${name} agents, commands, and instructions}

## Contents

\`\`\`
plugins/${slug}/
├── agents/        ← Specialized agents for ${name}
├── commands/      ← Slash commands
├── instructions/  ← Domain knowledge packs
└── plugin.json    ← Plugin manifest
\`\`\`

## Installation

Copy plugin contents to ghostforge-agents root:

\`\`\`bash
# Install all components
cp -r plugins/${slug}/agents/* agents/ 2>/dev/null || true
cp -r plugins/${slug}/commands/* commands/ 2>/dev/null || true
cp -r plugins/${slug}/instructions/* instructions/ 2>/dev/null || true
\`\`\`

## Usage

After installation, activate the plugin's agents and commands in Copilot Chat.

## Tags
${tags:-${slug}}
EOF

  cat > "$plugin_dir/plugin.json" <<EOF
{
  "id": "${slug}",
  "name": "${name}",
  "description": "${description:-${name} plugin}",
  "version": "1.0.0",
  "tags": [$(echo "${tags:-${slug}}" | tr ',' '\n' | sed 's/^ *//' | sed 's/^/"/' | sed 's/$/"/' | tr '\n' ',' | sed 's/,$//')],
  "created": "$(date +%Y-%m-%d)"
}
EOF

  echo -e "\n${GREEN}${BOLD}  ✅ Plugin scaffolded: plugins/${slug}/${NC}"
  echo -e "${DIM}  Add agents, commands, and instructions to the plugin folder${NC}"
  echo -e "${DIM}  Then install with: cp -r plugins/${slug}/agents/* agents/${NC}"
  register_item "plugin" "$name" "plugins/${slug}/"
}

main() {
  local type="${1:-}"
  
  if [[ -z "$type" ]]; then
    header
    echo -e "  ${BOLD}What would you like to create?${NC}\n"
    echo -e "  ${GREEN}[1]${NC} 🤖 Agent          — specialized AI persona"
    echo -e "  ${GREEN}[2]${NC} ⚡ Command         — new /slash-command"
    echo -e "  ${GREEN}[3]${NC} 🎯 Skill           — coding agent skill"
    echo -e "  ${GREEN}[4]${NC} 📚 Instruction     — domain knowledge pack"
    echo -e "  ${GREEN}[5]${NC} 📦 Plugin          — package of agents/commands"
    echo -e "  ${GREEN}[q]${NC} Quit"
    echo ""
    read -rp "  Choice: " type
  fi
  
  case "$type" in
    1|agent)       generate_agent ;;
    2|command)     generate_command ;;
    3|skill)       generate_skill ;;
    4|instruction) generate_instruction ;;
    5|plugin)      generate_plugin ;;
    q|Q)           exit 0 ;;
    *)
      echo -e "${YELLOW}Usage: bash scripts/generate.sh [agent|command|skill|instruction|plugin]${NC}"
      exit 1
      ;;
  esac
}

main "${1:-}"
