import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const PARTICIPANT_ID = 'ghostforge';

const SLASH_COMMANDS = [
  { name: 'health',    description: 'Run project health check' },
  { name: 'review',    description: 'Code review current file' },
  { name: 'test',      description: 'Generate tests for current file' },
  { name: 'docs',      description: 'Generate documentation' },
  { name: 'rtl',       description: 'RTL audit (Tailwind LTR → RTL)' },
  { name: 'bundle',    description: 'Bundle size analysis' },
  { name: 'commit',    description: 'Suggest a commit message' },
  { name: 'security',  description: 'Security audit' },
  { name: 'optimize',  description: 'Optimize current code' },
  { name: 'estimate',  description: 'Estimate story points for task' },
  { name: 'changelog', description: 'Generate CHANGELOG entry' },
  { name: 'snippet',   description: 'Browse and insert snippets' },
  { name: 'help',      description: 'List all available commands' },
];

function getActiveFileContent(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const doc = editor.document;
  const content = doc.getText();
  const relativePath = vscode.workspace.asRelativePath(doc.uri);
  return `File: ${relativePath}\n\`\`\`${doc.languageId}\n${content.slice(0, 8000)}\n\`\`\``;
}

function getProjectContext(toolkitRoot: string): string {
  const lines: string[] = [];

  // Read VERSION
  const versionFile = path.join(toolkitRoot, '..', 'VERSION');
  if (fs.existsSync(versionFile)) {
    lines.push(`Toolkit version: ${fs.readFileSync(versionFile, 'utf8').trim()}`);
  }

  // Read copilot instructions
  const instrFile = path.join(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
    '.github',
    'copilot-instructions.md'
  );
  if (fs.existsSync(instrFile)) {
    const content = fs.readFileSync(instrFile, 'utf8');
    lines.push(`\n---\nProject instructions:\n${content.slice(0, 3000)}`);
  }

  return lines.join('\n');
}

function buildSystemPrompt(toolkitRoot: string): string {
  return [
    'You are @ghostforge, an AI developer assistant for the GhostForge AI Developer Toolkit.',
    'You help developers with React, Next.js, TypeScript, Tailwind CSS, RTL (right-to-left) support, and Arabic localisation.',
    'You are opinionated about code quality, accessibility, and performance.',
    '',
    getProjectContext(toolkitRoot),
    '',
    'When asked to run a script (health, rtl, bundle, etc.), tell the user to use the VS Code command palette (Cmd+Shift+E) or run the bash script directly.',
    'Keep responses concise and actionable. Use code blocks for code examples.',
  ].join('\n');
}

function renderHelp(): string {
  const lines = [
    '## ⚡ @ghostforge — GhostForge AI Toolkit Assistant',
    '',
    'Available slash commands:',
    '',
    ...SLASH_COMMANDS.map(cmd => `- **/${cmd.name}** — ${cmd.description}`),
    '',
    '**Examples:**',
    '- `@ghostforge /health` — Check project health score',
    '- `@ghostforge /review` — Review the current file',
    '- `@ghostforge /rtl` — Audit for RTL/LTR Tailwind issues',
    '- `@ghostforge /estimate Add dark mode` — Estimate story points',
    '- `@ghostforge /help` — Show this message',
  ];
  return lines.join('\n');
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  toolkitRoot: string
): void {
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ) => {
    const command = request.command ?? '';
    const prompt = request.prompt.trim();

    // /help or empty
    if (command === 'help' || (!command && !prompt)) {
      stream.markdown(renderHelp());
      return;
    }

    // Build messages for Copilot
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(buildSystemPrompt(toolkitRoot)),
    ];

    // Add prior turns for context (last 3)
    for (const turn of chatContext.history.slice(-3)) {
      if (turn instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      } else if (turn instanceof vscode.ChatResponseTurn) {
        const text = turn.response
          .filter((part): part is vscode.ChatResponseMarkdownPart => part instanceof vscode.ChatResponseMarkdownPart)
          .map(part => part.value.value)
          .join('');
        if (text) messages.push(vscode.LanguageModelChatMessage.Assistant(text));
      }
    }

    // Build the user turn
    let userMessage = '';

    if (command) {
      userMessage = `Command: /${command}\n`;
    }

    // Attach file context for file-aware commands
    const fileAwareCommands = ['review', 'test', 'docs', 'optimize', 'rtl', 'security', 'commit'];
    if (fileAwareCommands.includes(command) || !command) {
      const fileContent = getActiveFileContent();
      if (fileContent) {
        userMessage += `\nActive file:\n${fileContent}\n`;
      }
    }

    if (prompt) {
      userMessage += `\nUser request: ${prompt}`;
    }

    if (!userMessage.trim()) {
      stream.markdown(renderHelp());
      return;
    }

    messages.push(vscode.LanguageModelChatMessage.User(userMessage));

    // Select model (prefer GPT-4o / claude, fall back to any)
    let model: vscode.LanguageModelChat | undefined;
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      model = models.find(m => m.id.includes('gpt-4') || m.id.includes('claude')) ?? models[0];
    } catch {
      stream.markdown('⚠️ No language model available. Make sure GitHub Copilot is active.');
      return;
    }

    if (!model) {
      stream.markdown('⚠️ No language model available.');
      return;
    }

    try {
      const response = await model.sendRequest(messages, {}, token);
      for await (const chunk of response.text) {
        stream.markdown(chunk);
      }
    } catch (err: unknown) {
      if (err instanceof vscode.LanguageModelError) {
        stream.markdown(`⚠️ Model error: ${err.message}`);
      } else {
        stream.markdown('⚠️ An error occurred. Please try again.');
      }
    }
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');

  // Register slash commands for autocomplete
  participant.followupProvider = {
    provideFollowups(
      _result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken
    ) {
      return [
        { prompt: '', label: '📋 Show all commands', command: 'help' },
        { prompt: '', label: '⚕️ Run health check', command: 'health' },
        { prompt: '', label: '🔍 Review this file', command: 'review' },
      ];
    },
  };

  context.subscriptions.push(participant);
}
