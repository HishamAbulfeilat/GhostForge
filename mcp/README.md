# GhostForge MCP Server

The **Model Context Protocol (MCP)** lets GitHub Copilot discover local tools over a standard interface. This server exposes GhostForge-specific tools for project health, tickets, model selection, security scans, and snippet lookup.

## What MCP does for Copilot

When VS Code starts an MCP server, Copilot can call its registered tools on demand. In this project, the server runs over **stdio**, so Copilot launches `node mcp/index.js`, negotiates the MCP handshake, and then uses the GhostForge tool catalog as needed.

### Included tools

- `health_check(projectPath)`
- `get_tickets(provider, repo, owner)`
- `fix_ticket(provider, repo, owner, issueNumber, projectPath?)`
- `list_models(tier?)`
- `get_best_model(taskType)`
- `security_scan(projectPath)`
- `list_snippets()`
- `get_snippet(name)`

## Install

1. Open your project in VS Code.
2. Create or update `.vscode/mcp.json`.
3. Point the server to this repository's `mcp/index.js` file.
4. Make sure `GITHUB_TOKEN` is available in your shell environment.

### VS Code config

```json
{
  "servers": {
    "ghostforge": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/ghostforge/mcp/index.js"],
      "env": { "GITHUB_TOKEN": "${env:GITHUB_TOKEN}" }
    }
  }
}
```

This repository also includes a ready-to-copy workspace config in `.vscode/mcp.json` using `${workspaceFolder}/../ghostforge/mcp/index.js`.

## Local development

```bash
cd mcp
npm install
npm run start
```

Optional debug HTTP endpoint:

```bash
MCP_HTTP_PORT=8787 npm run start
# GET http://localhost:8787/healthz
```

## Environment variables

- `GITHUB_TOKEN` — required for GitHub issue tools
- `MCP_HTTP_PORT` — optional local health/debug endpoint
