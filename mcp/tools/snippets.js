import { existsSync, readFileSync, readdirSync, realpathSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import * as z from 'zod/v4';

// A snippet name is a single file name inside snippets/: no separators, no
// "..", nothing a path resolver could walk out of the folder with.
const SNIPPET_NAME = /^[A-Za-z0-9._-]+$/;

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Resolve a snippet name to a file inside snippetsDir, or return null.
 * Exported for tests.
 */
export function resolveSnippetPath(snippetsDir, name) {
  if (typeof name !== 'string') return null;
  const normalized = name.endsWith('.md') ? name : `${name}.md`;
  if (!SNIPPET_NAME.test(normalized) || normalized.startsWith('.')) return null;
  const candidate = resolve(snippetsDir, normalized);
  if (!isInside(resolve(snippetsDir), candidate) || !existsSync(candidate)) return null;
  // A symlink inside snippets/ may still point elsewhere: judge the real path.
  try {
    if (!isInside(realpathSync.native(snippetsDir), realpathSync.native(candidate))) return null;
  } catch {
    return null;
  }
  return candidate;
}

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
      const snippetPath = resolveSnippetPath(snippetsDir, name);

      if (!snippetPath) {
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
