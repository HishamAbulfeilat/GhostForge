#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerHealthTool } from './tools/health.js';
import { registerTicketTools } from './tools/tickets.js';
import { registerModelTools } from './tools/models.js';
import { registerSecurityTool } from './tools/security.js';
import { registerSnippetTools } from './tools/snippets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const server = new McpServer({
  name: 'ghostforge-mcp-server',
  version: '1.0.0'
});

const context = {
  repoRoot,
  githubToken: process.env.GITHUB_TOKEN ?? ''
};

registerHealthTool(server, context);
registerTicketTools(server, context);
registerModelTools(server, context);
registerSecurityTool(server, context);
registerSnippetTools(server, context);

const debugPort = Number(process.env.MCP_HTTP_PORT ?? 0);
if (debugPort > 0) {
  const app = express();
  app.use(express.json());

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      name: 'ghostforge-mcp-server',
      version: '1.0.0',
      tools: [
        'health_check',
        'get_tickets',
        'fix_ticket',
        'list_models',
        'get_best_model',
        'security_scan',
        'list_snippets',
        'get_snippet'
      ]
    });
  });

  app.listen(debugPort, () => {
    console.error(`[ghostforge-mcp] Debug HTTP endpoint listening on :${debugPort}`);
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[ghostforge-mcp] MCP server ready on stdio');
