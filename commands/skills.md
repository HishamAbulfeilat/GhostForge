# /skills Command

## Purpose
Browse, install, and manage **Claude Agent Skills** (SKILL.md-based capabilities) from all trusted sources — Anthropic official, SkillsMP community, Awesome Claude, and more.

## Usage
```bash
/skills                              # Browse all skill sources
/skills list                         # List installed skills
/skills install <source-id>          # Install a skill source
/skills browse skillsmp              # Browse SkillsMP marketplace
/skills browse anthropic             # Open Anthropic official skills
/skills browse awesome               # Open Awesome Claude Skills
/skills add <path-or-url>            # Add a custom skill from file or URL
/skills claude-flow                  # Install Claude-Flow orchestration
```

## What are Agent Skills?

Skills are modular capabilities defined in a **`SKILL.md`** file. Unlike `CLAUDE.md` (loads every session), skills **load on demand** — keeping your context lean.

```
~/.claude/skills/my-skill/
  └── SKILL.md        ← instructions, description, trigger keywords
  └── scripts/        ← optional helper scripts
  └── resources/      ← optional templates, data
```

**Install for all projects:** `~/.claude/skills/<name>/`
**Install for one project:** `.claude/skills/<name>/`

## Trusted Skill Sources

| Source | Skills | Type | URL |
|---|---|---|---|
| **Anthropic Official** | docx, pdf, pptx, xlsx, web-test, MCP gen | Official | https://github.com/anthropics/skills |
| **SkillsMP** | 2M+ community skills | Marketplace | https://skillsmp.com |
| **Awesome Claude Skills** | Curated free directory | Curated | https://awesomeclaude.ai/awesome-claude-skills |
| **Skills Collection 2026** | Community + official | Curated | https://github.com/obviousworks/Claude-AI-skills-collection-2026 |
| **Agent Skills Standard** | Spec + examples | Standard | https://agentskills.io/home |
| **Claude-Flow** | AI orchestration swarm | Orchestration | https://github.com/edwincummins/claude-flow |

## Install Anthropic Official Skills (Claude Code)

```bash
# Register the official Anthropic skills marketplace
/plugin marketplace add anthropics/skills

# Or directly in Claude Code terminal:
npx @anthropic-ai/claude-code plugin add anthropics/skills
```

**Included official skills:**
| Skill | What it does |
|---|---|
| `docx` | Create/edit Word documents with formatting and comments |
| `pdf` | Extract, split, merge, and create PDFs |
| `pptx` | Generate and edit PowerPoint presentations |
| `xlsx` | Manipulate Excel: formulas, tables, charts |
| `web-test` | Test web apps with Playwright/Puppeteer |
| `mcp-server-gen` | Generate Model Context Protocol servers |

## Browse SkillsMP (2M+ Skills)

```bash
# API — search for skills
curl "https://skillsmp.com/api/search?q=react&language=typescript"

# MCP server for AI-to-AI skill discovery
https://skillsmp.com/mcp

# OpenAPI spec
https://skillsmp.com/openapi.json
```

## Claude-Flow Quick Start

Claude-Flow adds **hive-mind AI orchestration** — multiple agents working together:

```bash
# Prerequisites: install Claude Code
npm install -g @anthropic-ai/claude-code

# Initialize Claude-Flow
npx claude-flow@alpha init --force

# Run a swarm task (single objective)
npx claude-flow@alpha swarm "refactor this component for performance"

# Launch hive-mind (complex multi-agent session)
npx claude-flow@alpha hive-mind wizard
npx claude-flow@alpha hive-mind spawn "build a full auth system" --claude
```

**Key capabilities:**
- 87 MCP tools for swarm orchestration
- 84.8% SWE-Bench solve rate
- Persistent memory via SQLite (`.swarm/memory.db`)
- 2.8–4.4× speed vs single agent

## Agent Skills Standard (agentskills.io)

Skills work across multiple AI agents — not just Claude:

| Agent | Supports Skills |
|---|---|
| Claude Code | ✅ `.claude/skills/` |
| Junie (JetBrains) | ✅ IntelliJ-aware |
| Gemini CLI | ✅ Terminal |
| ZeroClaw | ✅ Open-source Rust runtime |

## Create Your Own Skill

```bash
# Create skill structure
mkdir -p ~/.claude/skills/my-skill
cat > ~/.claude/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: What this skill does (used for auto-invocation)
triggers:
  - keyword1
  - keyword2
---

# My Skill

## Instructions
Tell Claude exactly how to behave when this skill is active...
EOF
```

## Notes
- Skills are **free** — you only pay for Claude usage when they run
- Use `/reload-skills` in Claude Code to pick up new skills without restarting
- Use `/skills` to list available skills in Claude Code
- Skills can restrict which tools Claude uses for safety
