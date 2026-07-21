import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { registerChatParticipant } from './chatParticipant';
import { SnippetTreeProvider } from './snippetProvider';
import { CommandTreeProvider } from './commandProvider';
import { StatusBarManager } from './statusBar';

export function activate(context: vscode.ExtensionContext) {
  const toolkitRoot = findToolkitRoot();

  registerCommands(context, toolkitRoot);
  registerChatParticipant(context, toolkitRoot);

  const snippetProvider = new SnippetTreeProvider(toolkitRoot);
  vscode.window.registerTreeDataProvider('ghostforge.snippets', snippetProvider);
  context.subscriptions.push(
    vscode.commands.registerCommand('ghostforge.refreshSnippets', () => snippetProvider.refresh())
  );

  const commandProvider = new CommandTreeProvider(toolkitRoot);
  vscode.window.registerTreeDataProvider('ghostforge.commands', commandProvider);

  const statusBar = new StatusBarManager(context);
  statusBar.show();

  vscode.window.showInformationMessage('⚡ GhostForge AI Toolkit ready! (Cmd+Shift+E to open picker)');
}

export function deactivate() {}

function findToolkitRoot(): string {
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const fs = require('fs') as typeof import('fs');
  const candidates = [
    path.join(os.homedir(), 'GhostForge'),
    path.join(os.homedir(), 'ghostforge'),
    path.join(os.homedir(), 'Documents', 'GhostForge'),
    path.join(os.homedir(), 'Documents', 'ghostforge'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'VERSION'))) {
      return candidate;
    }
  }

  return candidates[0];
}
