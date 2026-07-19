# /open — Open Existing Project with GhostForge

## Purpose
Open an existing project and automatically wire up all GhostForge AI toolkit files so GitHub Copilot is instantly powered up with the full knowledge base, agents, commands, and CI/CD pipelines.

## Usage in Copilot Chat

```
/open
/open /path/to/my-project
/open --copy-only   (copy files without opening VS Code)
/open --check       (check if project already has toolkit)
```

## Usage from Terminal

```bash
# Interactive — asks for path
bash ~/ghostforge-agents/scripts/open-project.sh

# Direct path
bash ~/ghostforge-agents/scripts/open-project.sh /path/to/my-project

# Or via the TUI
ghostforge  →  Open Existing Project
```

## What Gets Copied

| File / Folder | Purpose |
|---------------|---------|
| `.github/copilot-instructions.md` | 🧠 Main AI brain — auto-read by Copilot |
| `.github/copilot-setup-steps.yml` | ☁️ Copilot cloud agent environment |
| `.github/workflows/pr-review.yml` | Auto PR review on every push |
| `.github/workflows/deploy-azure.yml` | Azure deployment pipeline |
| `.github/workflows/qa-pipeline.yml` | QA + Lighthouse + accessibility |
| `.vscode/settings.json` | Wires 10 instruction files to Copilot |
| `.vscode/extensions.json` | Recommended extensions prompt |
| `ghostforge-agents/agents/` | All 14 AI agent definitions |
| `ghostforge-agents/commands/` | All 27 slash command docs |
| `ghostforge-agents/instructions/` | All 19 deep-knowledge files |
| `ghostforge-agents/prompts/` | Reusable prompt templates |

## Steps the AI Follows

1. Ask for project path (if not provided)
2. Check if project already has toolkit files → ask to overwrite or skip
3. Copy all toolkit files to target project
4. Detect project type (React, React Native, Next.js, Node.js) and show relevant commands
5. Open project in VS Code
6. Show quick-start message with most useful commands for detected stack

## After Opening

Copilot Chat will immediately understand:
- The project's tech stack
- All GhostForge commands (`/optimize`, `/security`, `/test`, `/tickets`, etc.)
- Which agent to use for each task
- GhostForge coding standards and security rules

## Example Copilot Interaction After `/open`

```
You: /open /Users/hisham/projects/ghostforge-mobile

AI: ✅ Toolkit applied to ghostforge-mobile
    Detected: React Native + TypeScript + Expo

    Useful commands for this project:
    • /test           — run Detox E2E + Jest unit tests
    • /security       — OWASP mobile security audit
    • /optimize       — bundle size + performance
    • /tickets        — view your assigned bugs
    • act as mobile developer — activate mobile agent
```
