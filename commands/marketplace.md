# /marketplace Command

## Purpose
Browse and install **agents, commands, skills, and plugins** from trusted sources — including the GhostForge official catalog, aitmpl.com AI templates, GitHub community repos, and custom user additions.

## Usage
```bash
/marketplace                        # Open interactive marketplace
/marketplace browse                 # Browse all items by category
/marketplace search <query>         # Search by name, tag, or category
/marketplace install <id>           # Install an item from the catalog
/marketplace list-installed         # Show installed items
/marketplace add-source <url>       # Add a trusted source
/marketplace open aitmpl            # Open aitmpl.com in browser
/marketplace add-agent <file>       # Add a custom agent from file
/marketplace add-model              # Add a custom model provider
```

## Trusted Sources

| Source | Type | URL |
|---|---|---|
| **GhostForge Official** | Built-in | https://github.com/HishamAbulfeilat/GhostForge |
| **AI Templates (aitmpl.com)** | Web | https://aitmpl.com |
| **Open Source Projects** | Discovery | https://www.opensourceprojects.dev |
| **Hermes Agent (Nous Research)** | AI Agent | https://github.com/nousresearch/hermes-agent |
| **GitHub Copilot Community** | GitHub topic | https://github.com/topics/copilot-agent |
| **Awesome Copilot** | Curated | https://github.com/collections/github-copilot |
| **NVIDIA NIM Agents** | Model agents | https://build.nvidia.com/nim |
| **Anthropic Official Skills** | Claude Skills | https://github.com/anthropics/skills |
| **SkillsMP** | Claude Skills (2M+) | https://skillsmp.com |
| **Awesome Claude Skills** | Curated skills | https://awesomeclaude.ai/awesome-claude-skills |
| **Skills Collection 2026** | Community skills | https://github.com/obviousworks/Claude-AI-skills-collection-2026 |
| **scroll-world** | Landing page skill | https://github.com/oso95/scroll-world |
| **UI/UX Pro Max** | Claude Skill (161 rules) | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill |
| **PocketBase** | Backend tool | https://github.com/pocketbase/pocketbase |
| **Claude Marketplaces** | Discovery directory | https://claudemarketplaces.com |
| **find-skills (Vercel Labs)** | Skill discovery | https://github.com/vercel-labs/skills |
| **claude-mem** | Persistent memory | https://github.com/thedotmack/claude-mem |
| **frontend-design (Anthropic)** | Design skill | https://github.com/anthropics/skills |
| **extract-design-system** | Design token extractor | https://github.com/arvindrk/extract-design-system |
| **Superpowers** | AI dev methodology | https://github.com/obra/superpowers |
| **Page Agent (Alibaba)** | GUI web agent | https://github.com/alibaba/page-agent |
| **Strix** | AI pentesting | https://github.com/usestrix/strix |
| **Career Helper** | Career support (14 skills) | https://github.com/Zal4DW/career-helper |
| **Career-Ops** | Multi-agent job search (WIRED/BI) | https://github.com/santifer/career-ops |
| **Awesome Claude Design (rohitg00)** | DESIGN.md collection · prompt packs | https://github.com/rohitg00/awesome-claude-design |
| **Awesome Claude Design (VoltAgent)** | DESIGN.md → full design system scaffolding | https://github.com/VoltAgent/awesome-claude-design |
| **HackingTool** | 185+ pentesting tools, 35 categories | https://github.com/Z4nzu/hackingtool |
| **Impeccable** | 23 design cmds, 46 detector rules for AI agents | https://github.com/pbakaus/impeccable |
| **Frontend Design Plugin** | Official Anthropic Claude plugin · production UI | https://claude.com/plugins/frontend-design |
| **Agent Skills Standard** | Skills spec | https://agentskills.io/home |
| **Claude-Flow** | AI orchestration | https://github.com/edwincummins/claude-flow |

## Catalog Item Types

| Type | Description | Location |
|---|---|---|
| `agent` | Specialized AI persona | `agents/` |
| `command` | Slash command with AI behavior | `commands/` |
| `skill` | Coding agent skill | `.copilot/skills/` |
| `instruction` | Domain knowledge pack | `instructions/` |
| `template` | Project/component template | External URL |
| `plugin` | Package with multiple items | `plugins/` |
| `model-agent` | AI model configuration | `marketplace/custom-models.json` |

## aitmpl.com Integration

Browse AI component templates at **https://aitmpl.com** — a community site for AI-powered templates:

```bash
# Open in browser
/marketplace open aitmpl

# Or in TUI:
ghostforge-ai → 🏪 Marketplace → Browse aitmpl.com
```

After finding a template on aitmpl.com, use `/generate` to create a matching agent or `/scaffold` to generate it in your project.

## Installing from GitHub

```bash
# Install a skill from a GitHub repo
/marketplace install --github owner/repo

# Install from a raw URL
/marketplace install --url https://raw.githubusercontent.com/owner/repo/main/agents/my-agent.md
```

## Managing Custom Agents

### Add via TUI
```bash
ghostforge-ai → 🏪 Marketplace → Add Custom Agent
```

### Add via Copilot Chat
```
/generate agent
# → wizard creates marketplace/custom-agents/<name>.md
```

### Add manually
Drop any `.md` file into `marketplace/custom-agents/` following the agent template format.

## Managing Custom Models

```bash
# Add custom model via TUI
ghostforge-ai → 🆓 Free Models → Add Custom Model

# Via Copilot Chat
/free-models add-custom

# Manual: edit marketplace/custom-models.json
```

## Installed Items Registry

All installed items are tracked in `marketplace/registry.json`. View it:
```bash
cat marketplace/registry.json
```

## Adding a New Source

Edit `marketplace/sources.json` to add a trusted source:
```json
{
  "id": "my-source",
  "name": "My Team Source",
  "type": "github",
  "url": "https://github.com/my-team/copilot-agents",
  "trusted": true
}
```

## Examples

```bash
# Browse the marketplace
/marketplace

# Find React-related agents
/marketplace search react

# Install NVIDIA Llama agent
/marketplace install nvidia-llama-agent

# Add your company's custom agent
/generate agent
# → wizard → creates agents/custom-myagent.md
```
