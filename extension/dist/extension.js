"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode5 = __toESM(require("vscode"));

// src/commands.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var vscode = __toESM(require("vscode"));
var GHOSTFORGE_TERMINAL = "GhostForge AI";
var PICKER_COMMANDS = [
  { id: "ghostforge.openPicker", title: "Open Command Picker", description: "Browse all GhostForge actions", category: "\u2699\uFE0F Modes" },
  { id: "ghostforge.context", title: "/context", description: "Copy the active file into the clipboard as Copilot context", slashCommand: "/context", category: "\u{1F4A1} Development" },
  { id: "ghostforge.rtl", title: "/rtl", description: "Run RTL audit in dry-run mode", slashCommand: "/rtl", category: "\u{1F4A1} Development" },
  { id: "ghostforge.rtlFix", title: "/rtl --fix", description: "Run RTL auto-fix", slashCommand: "/rtl --fix", category: "\u{1F4A1} Development" },
  { id: "ghostforge.bundle", title: "/bundle", description: "Run bundle analysis", slashCommand: "/bundle", category: "\u{1F4A1} Development" },
  { id: "ghostforge.health", title: "/health", description: "Run project health check", slashCommand: "/health", category: "\u{1F512} Security" },
  { id: "ghostforge.storybook", title: "/storybook", description: "Generate stories for the active file", slashCommand: "/storybook generate", category: "\u{1F4A1} Development" },
  { id: "ghostforge.ticket", title: "/ticket", description: "Scaffold work from a ticket ID", slashCommand: "/ticket", category: "\u{1F3AB} Tickets" },
  { id: "ghostforge.snippet", title: "/snippet", description: "Insert a snippet from the toolkit library", slashCommand: "/snippet", category: "\u{1F4A1} Development" },
  { id: "ghostforge.commit", title: "/commit", description: "Suggest a commit message prompt", slashCommand: "/commit", category: "\u{1F500} Git" },
  { id: "ghostforge.review", title: "/review", description: "Suggest a code review prompt", slashCommand: "/review", category: "\u{1F500} Git" },
  { id: "ghostforge.test", title: "/test", description: "Suggest a test prompt", slashCommand: "/test", category: "\u{1F9EA} QA" },
  { id: "ghostforge.security", title: "/security", description: "Suggest a security audit prompt", slashCommand: "/security", category: "\u{1F512} Security" },
  { id: "ghostforge.optimize", title: "/optimize", description: "Suggest an optimization prompt", slashCommand: "/optimize", category: "\u{1F4A1} Development" },
  { id: "ghostforge.docs", title: "/docs", description: "Suggest a documentation prompt", slashCommand: "/docs", category: "\u{1F4A1} Development" },
  { id: "ghostforge.i18n", title: "/i18n", description: "Suggest an i18n prompt", slashCommand: "/i18n", category: "\u{1F4A1} Development" },
  { id: "ghostforge.refreshSnippets", title: "Refresh Snippets", description: "Reload snippet files from disk", category: "\u2699\uFE0F Modes" }
];
function registerCommands(context, toolkitRoot) {
  const disposables = [
    vscode.commands.registerCommand("ghostforge.openPicker", () => openCommandPicker()),
    vscode.commands.registerCommand("ghostforge.context", async (resource) => copyCurrentFileAsContext(resource)),
    vscode.commands.registerCommand("ghostforge.rtl", () => runToolkitScript(toolkitRoot, "rtl.sh", ["."])),
    vscode.commands.registerCommand("ghostforge.rtlFix", () => runToolkitScript(toolkitRoot, "rtl.sh", [".", "--fix"])),
    vscode.commands.registerCommand("ghostforge.bundle", () => runToolkitScript(toolkitRoot, "bundle.sh")),
    vscode.commands.registerCommand("ghostforge.health", () => runToolkitScript(toolkitRoot, "health-check.sh")),
    vscode.commands.registerCommand("ghostforge.storybook", async (resource) => runStorybook(toolkitRoot, resource)),
    vscode.commands.registerCommand("ghostforge.ticket", async () => runTicket(toolkitRoot)),
    vscode.commands.registerCommand("ghostforge.snippet", async () => openSnippetPicker(toolkitRoot)),
    vscode.commands.registerCommand("ghostforge.insertSnippetFromFile", async (filePath) => insertSnippetFromFile(filePath)),
    vscode.commands.registerCommand("ghostforge.copySlashCommand", async (slashCommand) => copySlashCommand(slashCommand)),
    vscode.commands.registerCommand("ghostforge.commit", async () => openCopilotPrompt("/commit")),
    vscode.commands.registerCommand("ghostforge.review", async () => openCopilotPrompt("/review")),
    vscode.commands.registerCommand("ghostforge.test", async () => openCopilotPrompt("/test")),
    vscode.commands.registerCommand("ghostforge.security", async () => openCopilotPrompt("/security")),
    vscode.commands.registerCommand("ghostforge.optimize", async () => openCopilotPrompt("/optimize")),
    vscode.commands.registerCommand("ghostforge.docs", async () => openCopilotPrompt("/docs")),
    vscode.commands.registerCommand("ghostforge.i18n", async () => openCopilotPrompt("/i18n"))
  ];
  context.subscriptions.push(...disposables);
}
function getPickerCommands() {
  return PICKER_COMMANDS;
}
async function openCommandPicker() {
  const items = [];
  const categories = [...new Set(PICKER_COMMANDS.map((command2) => command2.category))];
  for (const category of categories) {
    items.push({ label: category, kind: vscode.QuickPickItemKind.Separator });
    for (const command2 of PICKER_COMMANDS.filter((entry) => entry.category === category)) {
      items.push({
        label: command2.title,
        description: command2.slashCommand,
        detail: command2.description,
        alwaysShow: true
      });
    }
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Choose an GhostForge command",
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!picked) {
    return;
  }
  const command = PICKER_COMMANDS.find((entry) => entry.title === picked.label);
  if (command) {
    await vscode.commands.executeCommand(command.id);
  }
}
async function copyCurrentFileAsContext(resource) {
  const targetUri = resolveResourceUri(resource);
  if (!targetUri) {
    vscode.window.showWarningMessage("GhostForge: Open a file first to build /context.");
    return;
  }
  const document = await vscode.workspace.openTextDocument(targetUri);
  const preview = document.getText().split(/\r?\n/).slice(0, 200).join("\n");
  const fileName = path.basename(targetUri.fsPath);
  const prompt = `Read and understand this file: ${fileName}. Here is the content:
${preview}`;
  await vscode.env.clipboard.writeText(prompt);
  vscode.window.showInformationMessage(`GhostForge copied /context for ${fileName} to your clipboard.`);
}
async function runStorybook(toolkitRoot, resource) {
  const targetUri = resolveResourceUri(resource);
  if (!targetUri) {
    vscode.window.showWarningMessage("GhostForge: Open or select a component file first.");
    return;
  }
  const terminal = getGhostForgeTerminal(toolkitRoot);
  terminal.show(true);
  terminal.sendText(buildShellCommand(path.join(toolkitRoot, "scripts", "storybook-gen.sh"), [targetUri.fsPath]));
}
async function runTicket(toolkitRoot) {
  const ticketId = await vscode.window.showInputBox({
    title: "GhostForge Ticket Scaffold",
    prompt: "Enter a ticket ID",
    placeHolder: "EJ-1234",
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? void 0 : "Ticket ID is required"
  });
  if (!ticketId) {
    return;
  }
  const terminal = getGhostForgeTerminal(toolkitRoot);
  terminal.show(true);
  terminal.sendText(buildShellCommand(path.join(toolkitRoot, "scripts", "ticket.sh"), [ticketId.trim()]));
}
async function openSnippetPicker(toolkitRoot) {
  const snippetsDir = path.join(toolkitRoot, "snippets");
  const snippetFiles = fs.readdirSync(snippetsDir).filter((entry) => [".md", ".ts", ".tsx"].includes(path.extname(entry))).sort((left, right) => left.localeCompare(right));
  const items = snippetFiles.map((fileName) => ({
    label: fileName,
    description: snippetGroupLabel(fileName),
    detail: getSnippetDescription(path.join(snippetsDir, fileName)),
    filePath: path.join(snippetsDir, fileName)
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Choose a snippet to insert",
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (picked) {
    await insertSnippetFromFile(picked.filePath);
  }
}
async function insertSnippetFromFile(filePath) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("GhostForge: Open an editor first to insert a snippet.");
    return;
  }
  const content = fs.readFileSync(filePath, "utf8");
  await editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, content);
  });
}
async function openCopilotPrompt(slashCommand) {
  const prompt = buildPromptWithActiveFile(slashCommand);
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: prompt });
  } catch {
    const terminal = getGhostForgeTerminal(getToolkitRootFromActiveExtension());
    terminal.show(true);
    terminal.sendText(`echo ${shellQuote(`Copilot Chat prompt: ${prompt}`)}`);
  }
}
function buildPromptWithActiveFile(slashCommand) {
  const activeUri = resolveResourceUri();
  if (!activeUri) {
    return slashCommand;
  }
  const relativePath = vscode.workspace.asRelativePath(activeUri, false);
  return `${slashCommand} ${relativePath}`;
}
function runToolkitScript(toolkitRoot, scriptName, args = []) {
  const terminal = getGhostForgeTerminal(toolkitRoot);
  terminal.show(true);
  terminal.sendText(buildShellCommand(path.join(toolkitRoot, "scripts", scriptName), args));
}
function getGhostForgeTerminal(toolkitRoot) {
  const existing = vscode.window.terminals.find((terminal) => terminal.name === GHOSTFORGE_TERMINAL);
  if (existing) {
    return existing;
  }
  return vscode.window.createTerminal({
    name: GHOSTFORGE_TERMINAL,
    cwd: getWorkspaceRoot(toolkitRoot)
  });
}
function getWorkspaceRoot(toolkitRoot) {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? (vscode.window.activeTextEditor ? path.dirname(vscode.window.activeTextEditor.document.uri.fsPath) : void 0) ?? toolkitRoot;
}
function resolveResourceUri(resource) {
  if (resource && resource.scheme === "file") {
    return resource;
  }
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === "file") {
    return activeUri;
  }
  return void 0;
}
function buildShellCommand(scriptPath, args) {
  return `bash ${shellQuote(scriptPath)}${args.length ? ` ${args.map((arg) => shellQuote(arg)).join(" ")}` : ""}`;
}
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function snippetGroupLabel(fileName) {
  const extension = path.extname(fileName);
  if (extension === ".md") {
    return "Markdown";
  }
  return "TypeScript";
}
function getSnippetDescription(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const firstMeaningfulLine = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0 && !line.startsWith("#"));
  return firstMeaningfulLine?.slice(0, 120) ?? "GhostForge snippet";
}
async function copySlashCommand(slashCommand) {
  await vscode.env.clipboard.writeText(slashCommand);
  vscode.window.showInformationMessage(`Copied! Paste in Copilot Chat: ${slashCommand}`);
}
function getToolkitRootFromActiveExtension() {
  const extension = vscode.extensions.getExtension("ghostforge.ghostforge-ai");
  return extension?.extensionPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

// src/snippetProvider.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var vscode2 = __toESM(require("vscode"));
var SnippetTreeProvider = class {
  constructor(toolkitRoot) {
    this.toolkitRoot = toolkitRoot;
    this.changeEmitter = new vscode2.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
  }
  refresh() {
    this.changeEmitter.fire();
  }
  getTreeItem(element) {
    return element;
  }
  getChildren(element) {
    if (!element) {
      return [
        new SnippetGroupItem("TypeScript", "ts"),
        new SnippetGroupItem("Markdown", "md")
      ];
    }
    if (element instanceof SnippetGroupItem) {
      return this.loadSnippetItems(element.kind);
    }
    return [];
  }
  loadSnippetItems(kind) {
    const snippetsDir = path2.join(this.toolkitRoot, "snippets");
    const descriptionMap = loadSnippetDescriptions(snippetsDir);
    const allowedExtensions = kind === "md" ? [".md"] : [".ts", ".tsx"];
    return fs2.readdirSync(snippetsDir).filter((entry) => allowedExtensions.includes(path2.extname(entry))).sort((left, right) => left.localeCompare(right)).map((entry) => {
      const filePath = path2.join(snippetsDir, entry);
      const description = descriptionMap.get(entry) ?? inferSnippetDescription(filePath);
      return new SnippetItem(entry, filePath, description, vscode2.TreeItemCollapsibleState.None);
    });
  }
};
var SnippetGroupItem = class extends vscode2.TreeItem {
  constructor(label, kind) {
    super(label, vscode2.TreeItemCollapsibleState.Expanded);
    this.label = label;
    this.kind = kind;
    this.iconPath = new vscode2.ThemeIcon(kind === "ts" ? "symbol-class" : "book");
    this.contextValue = `snippet-group-${kind}`;
  }
};
var SnippetItem = class extends vscode2.TreeItem {
  constructor(label, filePath, description, collapsibleState) {
    super(label, collapsibleState);
    this.label = label;
    this.filePath = filePath;
    this.collapsibleState = collapsibleState;
    this.description = description;
    this.tooltip = description;
    this.command = {
      command: "ghostforge.insertSnippetFromFile",
      title: "Insert Snippet",
      arguments: [filePath]
    };
    this.iconPath = new vscode2.ThemeIcon(filePath.endsWith(".ts") || filePath.endsWith(".tsx") ? "symbol-snippet" : "book");
  }
};
function loadSnippetDescriptions(snippetsDir) {
  const readmePath = path2.join(snippetsDir, "README.md");
  if (!fs2.existsSync(readmePath)) {
    return /* @__PURE__ */ new Map();
  }
  const lines = fs2.readFileSync(readmePath, "utf8").split(/\r?\n/);
  const descriptions = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|$/);
    if (match) {
      descriptions.set(match[1], match[2]);
    }
  }
  return descriptions;
}
function inferSnippetDescription(filePath) {
  const firstMeaningfulLine = fs2.readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0 && !line.startsWith("#"));
  return firstMeaningfulLine?.slice(0, 80) ?? "GhostForge snippet";
}

// src/commandProvider.ts
var vscode3 = __toESM(require("vscode"));
var CommandTreeProvider = class {
  constructor(toolkitRoot) {
    this.toolkitRoot = toolkitRoot;
    this.changeEmitter = new vscode3.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
    void this.toolkitRoot;
  }
  getTreeItem(element) {
    return element;
  }
  getChildren(element) {
    const commands3 = getPickerCommands().filter((command) => command.slashCommand);
    const grouped = /* @__PURE__ */ new Map();
    for (const command of commands3) {
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
        (command) => new CommandItem(command.title, command.description, command.slashCommand ?? "")
      );
    }
    return [];
  }
};
var CommandGroupItem = class extends vscode3.TreeItem {
  constructor(category, count) {
    super(category, vscode3.TreeItemCollapsibleState.Expanded);
    this.category = category;
    this.description = `${count}`;
    this.iconPath = new vscode3.ThemeIcon("folder-library");
  }
};
var CommandItem = class extends vscode3.TreeItem {
  constructor(label, description, slashCommand) {
    super(label, vscode3.TreeItemCollapsibleState.None);
    this.label = label;
    this.slashCommand = slashCommand;
    this.description = description;
    this.tooltip = `${slashCommand} \u2014 ${description}`;
    this.iconPath = new vscode3.ThemeIcon("terminal");
    this.command = {
      command: "ghostforge.copySlashCommand",
      title: "Copy Slash Command",
      arguments: [slashCommand]
    };
  }
};

// src/statusBar.ts
var vscode4 = __toESM(require("vscode"));
var StatusBarManager = class {
  constructor(context) {
    this.statusBarItem = vscode4.window.createStatusBarItem(vscode4.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = "\u26A1 GhostForge";
    this.statusBarItem.tooltip = "GhostForge AI Toolkit \u2014 Click to open command picker";
    this.statusBarItem.command = "ghostforge.openPicker";
    context.subscriptions.push(this.statusBarItem);
  }
  show() {
    this.statusBarItem.show();
  }
};

// src/extension.ts
function activate(context) {
  const toolkitRoot = findToolkitRoot();
  registerCommands(context, toolkitRoot);
  const snippetProvider = new SnippetTreeProvider(toolkitRoot);
  vscode5.window.registerTreeDataProvider("ghostforge.snippets", snippetProvider);
  context.subscriptions.push(
    vscode5.commands.registerCommand("ghostforge.refreshSnippets", () => snippetProvider.refresh())
  );
  const commandProvider = new CommandTreeProvider(toolkitRoot);
  vscode5.window.registerTreeDataProvider("ghostforge.commands", commandProvider);
  const statusBar = new StatusBarManager(context);
  statusBar.show();
  vscode5.window.showInformationMessage("\u26A1 GhostForge AI Toolkit ready! (Cmd+Shift+E to open picker)");
}
function deactivate() {
}
function findToolkitRoot() {
  const os = require("os");
  const path3 = require("path");
  const fs3 = require("fs");
  const candidates = [
    path3.join(os.homedir(), "ghostforge-agents"),
    path3.join(os.homedir(), "Documents", "ghostforge-agents")
  ];
  for (const candidate of candidates) {
    if (fs3.existsSync(path3.join(candidate, "VERSION"))) {
      return candidate;
    }
  }
  return candidates[0];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
