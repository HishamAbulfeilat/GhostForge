import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import * as z from 'zod/v4';

function asToolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

export function registerSnippetTools(server, { repoRoot }) {
  const snippetsDir = resolve(repoRoot, 'snippets');

  server.tool(
    'list_snippets',
    'List all GhostForge snippets available in the snippets/ folder.',
    {},
    async () => {
      const snippets = existsSync(snippetsDir)
        ? readdirSync(snippetsDir)
            .filter(file => file.endsWith('.md') && file !== 'README.md')
            .map(file => ({
              name: file.replace(/\.md$/, ''),
              file
            }))
        : [];

      return asToolResult({
        count: snippets.length,
        snippets
      });
    }
  );

  server.tool(
    'get_snippet',
    'Return the Markdown content of a specific GhostForge snippet.',
    {
      name: z.string().describe('Snippet name with or without .md')
    },
    async ({ name }) => {
      const normalized = name.endsWith('.md') ? name : `${name}.md`;
      const snippetPath = resolve(snippetsDir, normalized);

      if (!existsSync(snippetPath)) {
        return asToolResult({
          ok: false,
          name,
          error: `Snippet not found: ${normalized}`
        });
      }

      return asToolResult({
        ok: true,
        name: normalized.replace(/\.md$/, ''),
        content: readFileSync(snippetPath, 'utf8')
      });
    }
  );
}
