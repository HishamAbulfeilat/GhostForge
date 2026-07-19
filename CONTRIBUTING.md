# Contributing to GhostForge AI Toolkit

This toolkit is maintained by and for GhostForge developers. Contributions are welcome!

---

## How to Add a New Agent

1. Create `agents/your-agent.md` following the template:
```markdown
# 🔤 Agent Name

**Role**: One-line description

## Capabilities
- Bullet list of what this agent can do

## Tech Stack
- List of technologies

## When to Use This Agent
- Use cases
```

2. Add the agent to the slash commands table in `.github/copilot-instructions.md`
3. Add a role-switching line: `"act as X" → Your Agent`
4. Update `README.md` agents table
5. Open a PR

---

## How to Add a New Command

1. Create `commands/your-command.md`:
```markdown
# /your-command Command

## Description
What this command does.

## Usage
/your-command [options]

## Examples
/your-command example

## Behavior
Step-by-step what the AI does when this command is triggered.
```

2. Add to the commands table in `.github/copilot-instructions.md`
3. Add to `commands/help.md` quick reference
4. Open a PR

---

## How to Update an Instruction File

1. Edit the relevant file in `instructions/`
2. Keep content factual, code-focused, and up-to-date
3. Test that Copilot uses the new instructions correctly
4. Open a PR with a description of what changed and why

---

## Getting Latest Toolkit Updates

```bash
cd ~/ghostforge
git pull origin main
```

Or run the update script:
```bash
bash ~/ghostforge/scripts/update.sh
```

---

## PR Checklist for Toolkit Changes

- [ ] New files follow existing style and format
- [ ] Copilot instructions updated if adding commands/agents
- [ ] README.md updated if adding major features
- [ ] help.md updated with new commands
- [ ] VERSION bumped (patch for fixes, minor for new agents/commands)
