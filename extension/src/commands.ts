import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type CommandCategory = '💡 Development' | '🔒 Security' | '🧪 QA' | '🎫 Tickets' | '🔀 Git' | '⚙️ Modes';

type PickerCommand = {
  id: string;
  title: string;
  description: string;
  slashCommand?: string;
  category: CommandCategory;
};

const GHOSTFORGE_TERMINAL = 'GhostForge AI';

const PICKER_COMMANDS: PickerCommand[] = [
  { id: 'ghostforge.openPicker', title: 'Open Command Picker', description: 'Browse all GhostForge actions', category: '⚙️ Modes' },
  { id: 'ghostforge.context', title: '/context', description: 'Copy the active file into the clipboard as Copilot context', slashCommand: '/context', category: '💡 Development' },
  { id: 'ghostforge.rtl', title: '/rtl', description: 'Run RTL audit in dry-run mode', slashCommand: '/rtl', category: '💡 Development' },
  { id: 'ghostforge.rtlFix', title: '/rtl --fix', description: 'Run RTL auto-fix', slashCommand: '/rtl --fix', category: '💡 Development' },
  { id: 'ghostforge.bundle', title: '/bundle', description: 'Run bundle analysis', slashCommand: '/bundle', category: '💡 Development' },
  { id: 'ghostforge.health', title: '/health', description: 'Run project health check', slashCommand: '/health', category: '🔒 Security' },
  { id: 'ghostforge.storybook', title: '/storybook', description: 'Generate stories for the active file', slashCommand: '/storybook generate', category: '💡 Development' },
  { id: 'ghostforge.ticket', title: '/ticket', description: 'Scaffold work from a ticket ID', slashCommand: '/ticket', category: '🎫 Tickets' },
  { id: 'ghostforge.snippet', title: '/snippet', description: 'Insert a snippet from the toolkit library', slashCommand: '/snippet', category: '💡 Development' },
  { id: 'ghostforge.commit', title: '/commit', description: 'Suggest a commit message prompt', slashCommand: '/commit', category: '🔀 Git' },
  { id: 'ghostforge.review', title: '/review', description: 'Suggest a code review prompt', slashCommand: '/review', category: '🔀 Git' },
  { id: 'ghostforge.test', title: '/test', description: 'Suggest a test prompt', slashCommand: '/test', category: '🧪 QA' },
  { id: 'ghostforge.security', title: '/security', description: 'Suggest a security audit prompt', slashCommand: '/security', category: '🔒 Security' },
  { id: 'ghostforge.optimize', title: '/optimize', description: 'Suggest an optimization prompt', slashCommand: '/optimize', category: '💡 Development' },
  { id: 'ghostforge.docs', title: '/docs', description: 'Suggest a documentation prompt', slashCommand: '/docs', category: '💡 Development' },
  { id: 'ghostforge.i18n', title: '/i18n', description: 'Suggest an i18n prompt', slashCommand: '/i18n', category: '💡 Development' },
  { id: 'ghostforge.refreshSnippets', title: 'Refresh Snippets', description: 'Reload snippet files from disk', category: '⚙️ Modes' },
];

export function registerCommands(context: vscode.ExtensionContext, toolkitRoot: string) {
  const disposables: vscode.Disposable[] = [
    vscode.commands.registerCommand('ghostforge.openPicker', () => openCommandPicker()),
    vscode.commands.registerCommand('ghostforge.context', async (resource?: vscode.Uri) => copyCurrentFileAsContext(resource)),
    vscode.commands.registerCommand('ghostforge.rtl', () => runToolkitScript(toolkitRoot, 'rtl.sh', ['.'])),
    vscode.commands.registerCommand('ghostforge.rtlFix', () => runToolkitScript(toolkitRoot, 'rtl.sh', ['.', '--fix'])),
    vscode.commands.registerCommand('ghostforge.bundle', () => runToolkitScript(toolkitRoot, 'bundle.sh')),
    vscode.commands.registerCommand('ghostforge.health', () => runToolkitScript(toolkitRoot, 'health-check.sh')),
    vscode.commands.registerCommand('ghostforge.storybook', async (resource?: vscode.Uri) => runStorybook(toolkitRoot, resource)),
    vscode.commands.registerCommand('ghostforge.ticket', async () => runTicket(toolkitRoot)),
    vscode.commands.registerCommand('ghostforge.snippet', async () => openSnippetPicker(toolkitRoot)),
    vscode.commands.registerCommand('ghostforge.insertSnippetFromFile', async (filePath: string) => insertSnippetFromFile(filePath)),
    vscode.commands.registerCommand('ghostforge.copySlashCommand', async (slashCommand: string) => copySlashCommand(slashCommand)),
    vscode.commands.registerCommand('ghostforge.commit', async () => openCopilotPrompt('/commit')),
    vscode.commands.registerCommand('ghostforge.review', async () => openCopilotPrompt('/review')),
    vscode.commands.registerCommand('ghostforge.test', async () => openCopilotPrompt('/test')),
    vscode.commands.registerCommand('ghostforge.security', async () => openCopilotPrompt('/security')),
    vscode.commands.registerCommand('ghostforge.optimize', async () => openCopilotPrompt('/optimize')),
    vscode.commands.registerCommand('ghostforge.docs', async () => openCopilotPrompt('/docs')),
    vscode.commands.registerCommand('ghostforge.i18n', async () => openCopilotPrompt('/i18n')),
  ];

  context.subscriptions.push(...disposables);
}

export function getPickerCommands(): PickerCommand[] {
  return PICKER_COMMANDS;
}

async function openCommandPicker() {
  const items: vscode.QuickPickItem[] = [];
  const categories = [...new Set(PICKER_COMMANDS.map((command) => command.category))];

  for (const category of categories) {
    items.push({ label: category, kind: vscode.QuickPickItemKind.Separator });
    for (const command of PICKER_COMMANDS.filter((entry) => entry.category === category)) {
      items.push({
        label: command.title,
        description: command.slashCommand,
        detail: command.description,
        alwaysShow: true,
      });
    }
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Choose an GhostForge command',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    return;
  }

  const command = PICKER_COMMANDS.find((entry) => entry.title === picked.label);
  if (command) {
    await vscode.commands.executeCommand(command.id);
  }
}

async function copyCurrentFileAsContext(resource?: vscode.Uri) {
  const targetUri = resolveResourceUri(resource);
  if (!targetUri) {
    vscode.window.showWarningMessage('GhostForge: Open a file first to build /context.');
    return;
  }

  const document = await vscode.workspace.openTextDocument(targetUri);
  const preview = document.getText().split(/\r?\n/).slice(0, 200).join('\n');
  const fileName = path.basename(targetUri.fsPath);
  const prompt = `Read and understand this file: ${fileName}. Here is the content:\n${preview}`;

  await vscode.env.clipboard.writeText(prompt);
  vscode.window.showInformationMessage(`GhostForge copied /context for ${fileName} to your clipboard.`);
}

async function runStorybook(toolkitRoot: string, resource?: vscode.Uri) {
  const targetUri = resolveResourceUri(resource);
  if (!targetUri) {
    vscode.window.showWarningMessage('GhostForge: Open or select a component file first.');
    return;
  }

  const terminal = getGhostForgeTerminal(toolkitRoot);
  terminal.show(true);
  terminal.sendText(buildShellCommand(path.join(toolkitRoot, 'scripts', 'storybook.sh'), ['generate', targetUri.fsPath]));
}

async function runTicket(toolkitRoot: string) {
  const ticketId = await vscode.window.showInputBox({
    title: 'GhostForge Ticket Scaffold',
    prompt: 'Enter a ticket ID',
    placeHolder: 'EJ-1234',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Ticket ID is required'),
  });

  if (!ticketId) {
    return;
  }

  const terminal = getGhostForgeTerminal(toolkitRoot);
  terminal.show(true);
  terminal.sendText(buildShellCommand(path.join(toolkitRoot, 'scripts', 'ticket.sh'), [ticketId.trim()]));
}

async function openSnippetPicker(toolkitRoot: string) {
  const snippetsDir = path.join(toolkitRoot, 'snippets');
  const snippetFiles = fs
    .readdirSync(snippetsDir)
    .filter((entry) => ['.md', '.ts', '.tsx'].includes(path.extname(entry)))
    .sort((left, right) => left.localeCompare(right));

  const items = snippetFiles.map((fileName) => ({
    label: fileName,
    description: snippetGroupLabel(fileName),
    detail: getSnippetDescription(path.join(snippetsDir, fileName)),
    filePath: path.join(snippetsDir, fileName),
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Choose a snippet to insert',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (picked) {
    await insertSnippetFromFile(picked.filePath);
  }
}

async function insertSnippetFromFile(filePath: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('GhostForge: Open an editor first to insert a snippet.');
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  await editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, content);
  });
}

async function openCopilotPrompt(slashCommand: string) {
  const prompt = buildPromptWithActiveFile(slashCommand);

  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
  } catch {
    const terminal = getGhostForgeTerminal(getToolkitRootFromActiveExtension());
    terminal.show(true);
    terminal.sendText(`echo ${shellQuote(`Copilot Chat prompt: ${prompt}`)}`);
  }
}

function buildPromptWithActiveFile(slashCommand: string): string {
  const activeUri = resolveResourceUri();
  if (!activeUri) {
    return slashCommand;
  }

  const relativePath = vscode.workspace.asRelativePath(activeUri, false);
  return `${slashCommand} ${relativePath}`;
}

function runToolkitScript(toolkitRoot: string, scriptName: string, args: string[] = []) {
  const terminal = getGhostForgeTerminal(toolkitRoot);
  terminal.show(true);
  terminal.sendText(buildShellCommand(path.join(toolkitRoot, 'scripts', scriptName), args));
}

function getGhostForgeTerminal(toolkitRoot: string): vscode.Terminal {
  const existing = vscode.window.terminals.find((terminal) => terminal.name === GHOSTFORGE_TERMINAL);
  if (existing) {
    return existing;
  }

  return vscode.window.createTerminal({
    name: GHOSTFORGE_TERMINAL,
    cwd: getWorkspaceRoot(toolkitRoot),
  });
}

function getWorkspaceRoot(toolkitRoot: string): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? (vscode.window.activeTextEditor ? path.dirname(vscode.window.activeTextEditor.document.uri.fsPath) : undefined)
    ?? toolkitRoot;
}

function resolveResourceUri(resource?: vscode.Uri): vscode.Uri | undefined {
  if (resource && resource.scheme === 'file') {
    return resource;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === 'file') {
    return activeUri;
  }

  return undefined;
}

function buildShellCommand(scriptPath: string, args: string[]): string {
  return `bash ${shellQuote(scriptPath)}${args.length ? ` ${args.map((arg) => shellQuote(arg)).join(' ')}` : ''}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function snippetGroupLabel(fileName: string): string {
  const extension = path.extname(fileName);
  if (extension === '.md') {
    return 'Markdown';
  }

  return 'TypeScript';
}

function getSnippetDescription(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf8');
  const firstMeaningfulLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));

  return firstMeaningfulLine?.slice(0, 120) ?? 'GhostForge snippet';
}

async function copySlashCommand(slashCommand: string) {
  await vscode.env.clipboard.writeText(slashCommand);
  vscode.window.showInformationMessage(`Copied! Paste in Copilot Chat: ${slashCommand}`);
}

function getToolkitRootFromActiveExtension(): string {
  const extension = vscode.extensions.getExtension('ghostforge.ghostforge-ai');
  return extension?.extensionPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}
