# /generate Command

## Purpose
**Generate a new custom agent, command, skill, instruction, or plugin** using an interactive wizard. No templates to memorize — just answer a few questions and the file is created for you.

## Usage
```bash
/generate                        # Interactive wizard — choose type
/generate agent                  # Create a new specialized AI agent
/generate command                # Create a new slash command
/generate skill                  # Create a coding agent skill
/generate instruction            # Create a domain knowledge instruction pack
/generate plugin                 # Create a plugin package (multiple agents/commands)
```

## Item Types

### 🤖 Agent (`/generate agent`)
Creates a specialized AI persona in `marketplace/custom-agents/<name>.md`

**What the wizard asks:**
1. Agent name (e.g. "Shopify Expert", "SAP Developer")
2. Description
3. Role / area of expertise
4. Trigger phrase (e.g. "act as shopify developer")
5. Key tools / technologies

**Output file:** `marketplace/custom-agents/<name>.md`

**Example generated file:**
```markdown
# Shopify Expert Agent

## Trigger
User says: "act as shopify developer"

## Expertise
- Shopify Liquid templating
- Shopify CLI and App development
- Polaris design system
- Hydrogen (React) storefront
- Shopify APIs and webhooks
```

---

### ⚡ Command (`/generate command`)
Creates a new slash command in `marketplace/custom-commands/<name>.md`

**What the wizard asks:**
1. Command name (e.g. "analyze-bundle")
2. Description
3. Usage/flags
4. What the AI does when the command runs

**Output file:** `marketplace/custom-commands/<name>.md`

**Use in Copilot Chat:** `/analyze-bundle` (after adding to copilot-instructions.md)

---

### 🎯 Skill (`/generate skill`)
Creates a coding agent skill in `.copilot/skills/<name>/SKILL.md`

**What the wizard asks:**
1. Skill name
2. Description
3. When should the skill run? (trigger condition)
4. CLI command to execute

**Output file:** `.copilot/skills/<name>/SKILL.md`

Copilot coding agent will automatically use this skill when the trigger condition matches.

---

### 📚 Instruction (`/generate instruction`)
Creates a domain knowledge pack in `instructions/custom-<name>.md`

**What the wizard asks:**
1. Topic / framework / domain
2. Key patterns and rules
3. Description

**Output file:** `instructions/custom-<name>.md`

To wire it into Copilot, add it to `.vscode/settings.json` under `codeGeneration.instructions`.

---

### 📦 Plugin (`/generate plugin`)
Creates a complete plugin package in `plugins/<name>/`

**Structure created:**
```
plugins/<name>/
├── README.md
├── plugin.json       ← manifest
├── agents/           ← plugin agents
└── commands/         ← plugin commands
```

To install the plugin:
```bash
cp -r plugins/<name>/agents/* agents/
cp -r plugins/<name>/commands/* commands/
```

## Examples

```bash
# Create a Shopify agent
/generate agent
# Name: Shopify Expert
# Description: Shopify Liquid, CLI, Polaris, Hydrogen
# Trigger: "act as shopify developer"
# → Creates: marketplace/custom-agents/shopify-expert.md

# Create a custom analyze command
/generate command
# Name: analyze-bundle
# Description: Analyze Webpack/Vite bundle and suggest optimizations
# → Creates: marketplace/custom-commands/analyze-bundle.md

# Create a skill for a custom linter
/generate skill
# Name: my-linter
# Trigger: after editing TypeScript files
# Command: npx my-linter --fix
# → Creates: .copilot/skills/my-linter/SKILL.md

# Create a domain knowledge pack
/generate instruction
# Topic: Shopify Liquid + Hydrogen
# → Creates: instructions/custom-shopify.md

# Create a plugin package
/generate plugin
# Name: shopify-toolkit
# → Creates: plugins/shopify-toolkit/
```

## After Generating

All generated items are tracked in `marketplace/registry.json`.

To use a generated agent in Copilot Chat, tell Copilot:
```
act as [agent-name]
```

To use a generated command, add it to `.github/copilot-instructions.md`.

## TUI Access

```bash
ghostforge → ⚡ Generate New
```
