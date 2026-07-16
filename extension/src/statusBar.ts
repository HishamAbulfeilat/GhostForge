import * as vscode from 'vscode';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = '⚡ GhostForge';
    this.statusBarItem.tooltip = 'GhostForge AI Toolkit — Click to open command picker';
    this.statusBarItem.command = 'ghostforge.openPicker';
    context.subscriptions.push(this.statusBarItem);
  }

  show() {
    this.statusBarItem.show();
  }
}
