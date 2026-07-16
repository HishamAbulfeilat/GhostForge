import * as vscode from 'vscode';
import { getPickerCommands } from './commands';

type CommandNode = CommandGroupItem | CommandItem;

export class CommandTreeProvider implements vscode.TreeDataProvider<CommandNode> {
  private readonly changeEmitter = new vscode.EventEmitter<CommandNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly toolkitRoot: string) {
    void this.toolkitRoot;
  }

  getTreeItem(element: CommandNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandNode): CommandNode[] {
    const commands = getPickerCommands().filter((command) => command.slashCommand);
    const grouped = new Map<string, typeof commands>();

    for (const command of commands) {
      const current = grouped.get(command.category) ?? [];
      current.push(command);
      grouped.set(command.category, current);
    }

    if (!element) {
      return [...grouped.entries()].map(
        ([category, items]) => new CommandGroupItem(category, items.length)
      );
    }

    if (element instanceof CommandGroupItem) {
      return (grouped.get(element.category) ?? []).map(
        (command) => new CommandItem(command.title, command.description, command.slashCommand ?? '')
      );
    }

    return [];
  }
}

class CommandGroupItem extends vscode.TreeItem {
  constructor(public readonly category: string, count: number) {
    super(category, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${count}`;
    this.iconPath = new vscode.ThemeIcon('folder-library');
  }
}

class CommandItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    description: string,
    private readonly slashCommand: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = `${slashCommand} — ${description}`;
    this.iconPath = new vscode.ThemeIcon('terminal');
    this.command = {
      command: 'ghostforge.copySlashCommand',
      title: 'Copy Slash Command',
      arguments: [slashCommand],
    };
  }
}
