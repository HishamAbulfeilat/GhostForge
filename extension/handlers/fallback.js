import { sendChunk, sendDone, sendError } from '../utils/sse.js';

const SUGGESTIONS = [
  { pattern: /ticket|issue|bug/i, command: '/tickets', reason: 'You mentioned issues or bugs.' },
  { pattern: /security|vuln|owasp|secret/i, command: '/security', reason: 'You mentioned security-related work.' },
  { pattern: /deploy|release|ship|production|staging/i, command: '/deploy', reason: 'You asked about deployment or release steps.' },
  { pattern: /review|pull request|pr|diff/i, command: '/review', reason: 'You appear to be discussing code review or a PR.' },
  { pattern: /slow|performance|bundle|optimi/i, command: '/optimize', reason: 'You asked about optimization or performance.' },
  { pattern: /health|score|audit/i, command: '/health', reason: 'You asked for a project status check.' },
];

function suggestCommand(text) {
  return SUGGESTIONS.find((item) => item.pattern.test(text));
}

export default async function fallbackHandler(args, context, res) {
  try {
    const raw = args || '';
    const suggestion = suggestCommand(raw);

    sendChunk(res, '🤝 **@ghostforge is ready to help**\n\n');
    sendChunk(res, 'I did not detect a supported slash command in your last message.\n\n');

    if (suggestion) {
      sendChunk(res, `### Best next command\n\n- **Suggested command**: \`@ghostforge ${suggestion.command}\`\n- **Why**: ${suggestion.reason}\n\n`);
    }

    sendChunk(res, '### What @ghostforge can do\n\n');
    sendChunk(res, '- Quick health and security guidance\n');
    sendChunk(res, '- Assigned GitHub ticket summaries\n');
    sendChunk(res, '- PR review and deployment guidance\n');
    sendChunk(res, '- Optimization suggestions and command discovery\n\n');

    sendChunk(res, 'Try one of these:\n\n- `@ghostforge /help`\n- `@ghostforge /health`\n- `@ghostforge /tickets`\n- `@ghostforge /security`\n');
    sendDone(res);
  } catch (error) {
    sendError(res, error?.message || 'Unable to generate a fallback response.');
  }
}
