# Custom Agents

This directory stores user-created custom agents generated via `/generate` or `ghostforge-ai` → Generate New.

## What is a Custom Agent?

A custom agent is a specialized AI persona with:
- A specific role and area of expertise
- A trigger phrase (e.g. "act as shopify expert")
- Curated guidelines and best practices for its domain
- Optional tool/command recommendations

## Creating a Custom Agent

### Option 1 — TUI
```bash
ghostforge-ai
# → Generate New → Agent
```

### Option 2 — Copilot Chat
```
/generate agent
```

### Option 3 — Manual
Create a `.md` file in this directory following this template:

```markdown
# My Agent Name

## Role
[What this agent specializes in]

## Trigger
User says: "act as [agent-name]"

## Expertise
- Technology 1
- Technology 2

## Behavior
When activated:
1. Acknowledge the role switch
2. Apply all relevant conventions
3. Follow GhostForge coding standards

## Key Guidelines
- Always [core principle]
- Follow [patterns]
```

## Loading Custom Agents

Custom agents in this folder are automatically discovered by the TUI (Marketplace → My Installed Items).

To make Copilot Chat aware of a custom agent, add it to your `.github/copilot-instructions.md` role switching table.

## Examples

| Agent | Trigger | Use Case |
|---|---|---|
| `shopify-expert.md` | "act as shopify developer" | Shopify Liquid, Apps, Polaris |
| `sap-agent.md` | "act as SAP developer" | SAP ABAP, BTP, Fiori |
| `flutter-agent.md` | "act as flutter developer" | Flutter, Dart, mobile cross-platform |
