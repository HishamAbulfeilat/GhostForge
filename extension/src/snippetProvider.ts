import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type SnippetNode = SnippetGroupItem | SnippetItem;

export class SnippetTreeProvider implements vscode.TreeDataProvider<SnippetNode> {
  private readonly changeEmitter = new vscode.EventEmitter<SnippetNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly toolkitRoot: string) {}

  refresh() {
    this.changeEmitter.fire();
  }

  getTreeItem(element: SnippetNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SnippetNode): SnippetNode[] {
    if (!element) {
      return [
        new SnippetGroupItem('TypeScript', 'ts'),
        new SnippetGroupItem('Markdown', 'md'),
      ];
    }

    if (element instanceof SnippetGroupItem) {
      return this.loadSnippetItems(element.kind);
    }

    return [];
  }

  private loadSnippetItems(kind: 'ts' | 'md'): SnippetItem[] {
    const snippetsDir = path.join(this.toolkitRoot, 'snippets');
    const descriptionMap = loadSnippetDescriptions(snippetsDir);
    const allowedExtensions = kind === 'md' ? ['.md'] : ['.ts', '.tsx'];

    return fs
      .readdirSync(snippetsDir)
      .filter((entry) => allowedExtensions.includes(path.extname(entry)))
      .sort((left, right) => left.localeCompare(right))
      .map((entry) => {
        const filePath = path.join(snippetsDir, entry);
        const description = descriptionMap.get(entry) ?? inferSnippetDescription(filePath);
        return new SnippetItem(entry, filePath, description, vscode.TreeItemCollapsibleState.None);
      });
  }
}

class SnippetGroupItem extends vscode.TreeItem {
  constructor(public readonly label: string, public readonly kind: 'ts' | 'md') {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(kind === 'ts' ? 'symbol-class' : 'book');
    this.contextValue = `snippet-group-${kind}`;
  }
}

export class SnippetItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly filePath: string,
    description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.tooltip = description;
    this.command = {
      command: 'ghostforge.insertSnippetFromFile',
      title: 'Insert Snippet',
      arguments: [filePath],
    };
    this.iconPath = new vscode.ThemeIcon(filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'symbol-snippet' : 'book');
  }
}

function loadSnippetDescriptions(snippetsDir: string): Map<string, string> {
  const readmePath = path.join(snippetsDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    return new Map<string, string>();
  }

  const lines = fs.readFileSync(readmePath, 'utf8').split(/\r?\n/);
  const descriptions = new Map<string, string>();

  for (const line of lines) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|$/);
    if (match) {
      descriptions.set(match[1], match[2]);
    }
  }

  return descriptions;
}

function inferSnippetDescription(filePath: string): string {
  const firstMeaningfulLine = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));

  return firstMeaningfulLine?.slice(0, 80) ?? 'GhostForge snippet';
}
