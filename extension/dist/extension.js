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
var vscode6 = __toESM(require("vscode"));

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
  terminal.sendText(buildShellCommand(path.join(toolkitRoot, "scripts", "storybook.sh"), ["generate", targetUri.fsPath]));
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
  const extension = vscode.extensions.getExtension("ghostforge.ghostforge");
  return extension?.extensionPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

// src/chatParticipant.ts
var vscode2 = __toESM(require("vscode"));
var path2 = __toESM(require("path"));
var fs2 = __toESM(require("fs"));
var http = __toESM(require("http"));
var PARTICIPANT_ID = "ghostforge";
var SLASH_COMMANDS = [
  { name: "health", description: "Run project health check" },
  { name: "review", description: "Code review current file" },
  { name: "test", description: "Generate tests for current file" },
  { name: "docs", description: "Generate documentation" },
  { name: "rtl", description: "RTL audit (Tailwind LTR \u2192 RTL)" },
  { name: "bundle", description: "Bundle size analysis" },
  { name: "commit", description: "Suggest a commit message" },
  { name: "security", description: "Security audit" },
  { name: "optimize", description: "Optimize current code" },
  { name: "estimate", description: "Estimate story points for task" },
  { name: "changelog", description: "Generate CHANGELOG entry" },
  { name: "snippet", description: "Browse and insert snippets" },
  { name: "jarvis", description: "Ask G.F.A.I. (JARVIS) via GhostForge API" },
  { name: "model", description: "Switch AI model (gemini/grok/ollama/openrouter)" },
  { name: "maccontrol", description: "Control Mac via AppleScript (e.g. /maccontrol lock)" },
  { name: "models", description: "List all available AI models" },
  { name: "help", description: "List all available commands" }
];
var selectedProvider = "";
var selectedModelId = "";
var GF_API_BASE = "http://localhost:3001";
var GF_COOKIE = "gf_token=";
function getActiveFileContent() {
  const editor = vscode2.window.activeTextEditor;
  if (!editor) return null;
  const doc = editor.document;
  const content = doc.getText();
  const relativePath = vscode2.workspace.asRelativePath(doc.uri);
  return `File: ${relativePath}
\`\`\`${doc.languageId}
${content.slice(0, 8e3)}
\`\`\``;
}
function getProjectContext(toolkitRoot) {
  const lines = [];
  const versionFile = path2.join(toolkitRoot, "..", "VERSION");
  if (fs2.existsSync(versionFile)) {
    lines.push(`Toolkit version: ${fs2.readFileSync(versionFile, "utf8").trim()}`);
  }
  const instrFile = path2.join(
    vscode2.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
    ".github",
    "copilot-instructions.md"
  );
  if (fs2.existsSync(instrFile)) {
    const content = fs2.readFileSync(instrFile, "utf8");
    lines.push(`
---
Project instructions:
${content.slice(0, 3e3)}`);
  }
  return lines.join("\n");
}
function buildSystemPrompt(toolkitRoot) {
  return [
    "You are @ghostforge, the GhostForge AI Developer Toolkit assistant (G.F.A.I.).",
    "You help developers with React, Next.js, TypeScript, Tailwind CSS, RTL, Arabic localisation, AI integration, Mac automation, and all GhostForge toolkit features.",
    "You are opinionated about code quality, accessibility, and performance.",
    "",
    getProjectContext(toolkitRoot),
    "",
    "When asked to run a script (health, rtl, bundle, etc.), tell the user to use Cmd+Shift+E or run the bash script directly.",
    "Keep responses concise and actionable. Use code blocks for code examples.",
    "",
    `Active model: ${selectedModelId ? `${selectedModelId} (${selectedProvider})` : "Copilot default"}`
  ].join("\n");
}
function callGhostForgeAPI(apiPath, body) {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(body);
    const req = http.request({
      hostname: "localhost",
      port: 3001,
      path: apiPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
        "Cookie": GF_COOKIE
      }
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve(data));
    });
    req.on("error", (e) => resolve(JSON.stringify({ error: e.message })));
    req.setTimeout(3e4, () => {
      req.destroy();
      resolve(JSON.stringify({ error: "timeout" }));
    });
    req.write(bodyStr);
    req.end();
  });
}
function getGhostForgeAPI(apiPath) {
  return new Promise((resolve) => {
    const req = http.get(`${GF_API_BASE}${apiPath}`, {
      headers: { "Cookie": GF_COOKIE }
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve(data));
    });
    req.on("error", (e) => resolve(JSON.stringify({ error: e.message })));
    req.setTimeout(8e3, () => {
      req.destroy();
      resolve(JSON.stringify({ error: "timeout" }));
    });
  });
}
function renderHelp() {
  const lines = [
    "## \u26A1 @ghostforge \u2014 GhostForge AI Toolkit (G.F.A.I.)",
    "",
    "### Chat Commands",
    ...SLASH_COMMANDS.map((cmd) => `- \`/${cmd.name}\` \u2014 ${cmd.description}`),
    "",
    "### Model Selection",
    "- `@ghostforge /model gemini` \u2014 Switch to Gemini",
    "- `@ghostforge /model grok` \u2014 Switch to Grok (xAI)",
    "- `@ghostforge /model ollama` \u2014 Switch to local Ollama",
    "- `@ghostforge /model openrouter` \u2014 Switch to OpenRouter free models",
    "- `@ghostforge /model auto` \u2014 Reset to auto fallback chain",
    "",
    "### G.F.A.I. Direct Chat",
    "- `@ghostforge /jarvis what time is it?` \u2014 Ask JARVIS",
    "- `@ghostforge /jarvis lock the screen` \u2014 Mac control via JARVIS",
    "- `@ghostforge /jarvis search for React 19 features` \u2014 Web search",
    "",
    "### Mac Control",
    "- `@ghostforge /maccontrol lock` \u2014 Lock screen",
    "- `@ghostforge /maccontrol screenshot` \u2014 Take screenshot",
    "- `@ghostforge /maccontrol open Safari` \u2014 Open app",
    "",
    "### Examples",
    "- `@ghostforge /health` \u2014 Check project health score",
    "- `@ghostforge /review` \u2014 Review the current file",
    "- `@ghostforge /models` \u2014 List all available AI models"
  ];
  return lines.join("\n");
}
function registerChatParticipant(context, toolkitRoot) {
  const handler = async (request2, chatContext, stream, token) => {
    const command = request2.command ?? "";
    const prompt = request2.prompt.trim();
    if (command === "help" || !command && !prompt) {
      stream.markdown(renderHelp());
      return;
    }
    if (command === "models") {
      stream.markdown("### \u{1F916} Available AI Models\n\nFetching from GhostForge API...\n");
      try {
        const raw = await getGhostForgeAPI("/api/jarvis/models");
        const data = JSON.parse(raw);
        const lines = [
          `**Active model:** \`${data.active?.model || "auto"}\` (${data.active?.provider || "unknown"})`,
          `**Ollama:** ${data.ollama?.running ? `\u2705 Running \u2014 models: ${data.ollama.models.join(", ")}` : "\u274C Not running"}`,
          "",
          "| Provider | Model | Available | Free |",
          "|----------|-------|-----------|------|"
        ];
        for (const m of data.models || []) {
          lines.push(`| ${m.provider} | \`${m.id}\` | ${m.available ? "\u2705" : "\u274C"} | ${m.free ? "\u{1F193}" : "\u{1F4B3}"} |`);
        }
        lines.push("", `**Currently selected in chat:** \`${selectedModelId || "auto"}\` (${selectedProvider || "fallback chain"})`);
        stream.markdown(lines.join("\n"));
      } catch {
        stream.markdown("\u26A0\uFE0F GhostForge server not running at localhost:3001. Start it with `npm start -- -p 3001` in GhostForge/web-ui/");
      }
      return;
    }
    if (command === "model") {
      const target = prompt.toLowerCase().trim();
      if (!target || target === "auto") {
        selectedProvider = "";
        selectedModelId = "";
        stream.markdown("\u2705 **Model reset to auto** \u2014 GhostForge will use the best available model automatically.");
        return;
      }
      if (target.includes("grok") || target === "xai") {
        selectedProvider = "xai";
        selectedModelId = target.includes("3") && !target.includes("mini") ? "grok-3" : "grok-3-mini";
      } else if (target.includes("gemini") || target === "google") {
        selectedProvider = "google";
        selectedModelId = target.includes("2.5") ? "gemini-2.5-flash" : "gemini-2.0-flash";
      } else if (target.includes("ollama") || target.includes("llama") || target.includes("qwen")) {
        selectedProvider = "ollama";
        selectedModelId = target.includes("qwen") ? "qwen2.5-coder:7b" : "llama3.2:3b";
      } else if (target.includes("openrouter") || target.includes("gemma") || target.includes("nemotron")) {
        selectedProvider = "openrouter";
        selectedModelId = target.includes("120") ? "nvidia/nemotron-3-super-120b-a12b:free" : "google/gemma-4-26b-a4b-it:free";
      } else if (target.includes("deepseek") || target.includes("r1")) {
        selectedProvider = "openrouter";
        selectedModelId = "deepseek/deepseek-r1:free";
      } else {
        selectedModelId = prompt.trim();
        selectedProvider = prompt.includes("/") ? "openrouter" : "custom";
      }
      stream.markdown(`\u2705 **Model switched to** \`${selectedModelId}\` (${selectedProvider})

All subsequent \`@ghostforge\` messages will use this model.`);
      return;
    }
    if (command === "jarvis") {
      const message = prompt || "Hello, G.F.A.I. Status?";
      stream.markdown(`**G.F.A.I.** *(${selectedModelId || "auto"})* \u2014 asking: *"${message}"*

`);
      try {
        const raw = await callGhostForgeAPI("/api/jarvis", {
          message,
          selectedProvider: selectedProvider || void 0,
          selectedModel: selectedModelId || void 0
        });
        const data = JSON.parse(raw);
        if (data.usedModel) {
          stream.markdown(`> \u{1F916} **Model used:** \`${data.usedModel}\` (${data.usedProvider || ""})${data.domain ? ` | **Domain:** ${data.domain}` : ""}${data.confidence !== void 0 ? ` | **Confidence:** ${data.confidence}%` : ""}

`);
        }
        stream.markdown(data.speech || "G.F.A.I. returned no response.");
        if (data.tool && data.toolResult) {
          stream.markdown(`

---
**Tool used:** \`${data.tool}\`
\`\`\`
${String(data.toolResult).slice(0, 1500)}
\`\`\``);
        }
      } catch {
        stream.markdown("\u26A0\uFE0F G.F.A.I. unavailable. Make sure GhostForge web server is running on port 3001.");
      }
      return;
    }
    if (command === "maccontrol") {
      const action = prompt || "system status";
      stream.markdown(`**Mac Control** \u2014 executing: *"${action}"*

`);
      try {
        const raw = await callGhostForgeAPI("/api/jarvis", {
          message: `Execute Mac control: ${action}`,
          selectedProvider: selectedProvider || void 0,
          selectedModel: selectedModelId || void 0
        });
        const data = JSON.parse(raw);
        stream.markdown(data.speech || "Done.");
        if (data.toolResult) {
          stream.markdown(`

\`\`\`
${String(data.toolResult).slice(0, 1500)}
\`\`\``);
        }
      } catch {
        stream.markdown("\u26A0\uFE0F Mac control requires GhostForge server running on port 3001.");
      }
      return;
    }
    const messages = [
      vscode2.LanguageModelChatMessage.User(buildSystemPrompt(toolkitRoot))
    ];
    for (const turn of chatContext.history.slice(-4)) {
      if (turn instanceof vscode2.ChatRequestTurn) {
        messages.push(vscode2.LanguageModelChatMessage.User(turn.prompt));
      } else if (turn instanceof vscode2.ChatResponseTurn) {
        const text = turn.response.filter((part) => part instanceof vscode2.ChatResponseMarkdownPart).map((part) => part.value.value).join("");
        if (text) messages.push(vscode2.LanguageModelChatMessage.Assistant(text));
      }
    }
    let userMessage = "";
    if (command) userMessage = `Command: /${command}
`;
    const fileAwareCommands = ["review", "test", "docs", "optimize", "rtl", "security", "commit", "snippet"];
    if (fileAwareCommands.includes(command) || !command) {
      const fileContent = getActiveFileContent();
      if (fileContent) userMessage += `
Active file:
${fileContent}
`;
    }
    if (prompt) userMessage += `
User request: ${prompt}`;
    if (!userMessage.trim()) {
      stream.markdown(renderHelp());
      return;
    }
    messages.push(vscode2.LanguageModelChatMessage.User(userMessage));
    if (selectedModelId && selectedProvider && selectedProvider !== "copilot") {
      stream.markdown(`> \u{1F504} **Routing to GhostForge API** \u2014 model: \`${selectedModelId}\` (${selectedProvider})

`);
      try {
        const raw = await callGhostForgeAPI("/api/chat", {
          messages: messages.map((m) => ({
            role: m.role === vscode2.LanguageModelChatMessageRole.User ? "user" : "assistant",
            content: typeof m.content === "string" ? m.content : m.content.map((p) => p.value || "").join("")
          })),
          selectedProvider,
          selectedModel: selectedModelId
        });
        const data = JSON.parse(raw);
        if (data.error) {
          stream.markdown(`\u26A0\uFE0F API error: ${data.error}

*Falling back to Copilot...*
`);
        } else {
          stream.markdown(data.text || data.response || "No response from model.");
          return;
        }
      } catch {
        stream.markdown("\u26A0\uFE0F GhostForge API unreachable \u2014 falling back to Copilot.\n\n");
      }
    }
    let model;
    try {
      const models = await vscode2.lm.selectChatModels({ vendor: "copilot" });
      model = models.find((m) => m.id.includes("gpt-4") || m.id.includes("claude")) ?? models[0];
    } catch {
      stream.markdown("\u26A0\uFE0F No language model available. Make sure GitHub Copilot is active.");
      return;
    }
    if (!model) {
      stream.markdown("\u26A0\uFE0F No language model available.");
      return;
    }
    try {
      const response = await model.sendRequest(messages, {}, token);
      for await (const chunk of response.text) {
        stream.markdown(chunk);
      }
    } catch (err) {
      if (err instanceof vscode2.LanguageModelError) {
        stream.markdown(`\u26A0\uFE0F Model error: ${err.message}`);
      } else {
        stream.markdown("\u26A0\uFE0F An error occurred. Please try again.");
      }
    }
  };
  const participant = vscode2.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = vscode2.Uri.joinPath(context.extensionUri, "media", "icon.png");
  participant.followupProvider = {
    provideFollowups(_result, _context, _token) {
      return [
        { prompt: "", label: "\u{1F4CB} List all commands", command: "help" },
        { prompt: "", label: "\u2695\uFE0F Health check", command: "health" },
        { prompt: "", label: "\u{1F50D} Review this file", command: "review" },
        { prompt: "", label: "\u{1F916} List AI models", command: "models" },
        { prompt: "what time is it?", label: "\u{1F550} Ask JARVIS", command: "jarvis" }
      ];
    }
  };
  context.subscriptions.push(participant);
}

// src/snippetProvider.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var vscode3 = __toESM(require("vscode"));
var SnippetTreeProvider = class {
  constructor(toolkitRoot) {
    this.toolkitRoot = toolkitRoot;
    this.changeEmitter = new vscode3.EventEmitter();
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
    const snippetsDir = path3.join(this.toolkitRoot, "snippets");
    const descriptionMap = loadSnippetDescriptions(snippetsDir);
    const allowedExtensions = kind === "md" ? [".md"] : [".ts", ".tsx"];
    return fs3.readdirSync(snippetsDir).filter((entry) => allowedExtensions.includes(path3.extname(entry))).sort((left, right) => left.localeCompare(right)).map((entry) => {
      const filePath = path3.join(snippetsDir, entry);
      const description = descriptionMap.get(entry) ?? inferSnippetDescription(filePath);
      return new SnippetItem(entry, filePath, description, vscode3.TreeItemCollapsibleState.None);
    });
  }
};
var SnippetGroupItem = class extends vscode3.TreeItem {
  constructor(label, kind) {
    super(label, vscode3.TreeItemCollapsibleState.Expanded);
    this.label = label;
    this.kind = kind;
    this.iconPath = new vscode3.ThemeIcon(kind === "ts" ? "symbol-class" : "book");
    this.contextValue = `snippet-group-${kind}`;
  }
};
var SnippetItem = class extends vscode3.TreeItem {
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
    this.iconPath = new vscode3.ThemeIcon(filePath.endsWith(".ts") || filePath.endsWith(".tsx") ? "symbol-snippet" : "book");
  }
};
function loadSnippetDescriptions(snippetsDir) {
  const readmePath = path3.join(snippetsDir, "README.md");
  if (!fs3.existsSync(readmePath)) {
    return /* @__PURE__ */ new Map();
  }
  const lines = fs3.readFileSync(readmePath, "utf8").split(/\r?\n/);
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
  const firstMeaningfulLine = fs3.readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0 && !line.startsWith("#"));
  return firstMeaningfulLine?.slice(0, 80) ?? "GhostForge snippet";
}

// src/commandProvider.ts
var vscode4 = __toESM(require("vscode"));
var CommandTreeProvider = class {
  constructor(toolkitRoot) {
    this.toolkitRoot = toolkitRoot;
    this.changeEmitter = new vscode4.EventEmitter();
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
var CommandGroupItem = class extends vscode4.TreeItem {
  constructor(category, count) {
    super(category, vscode4.TreeItemCollapsibleState.Expanded);
    this.category = category;
    this.description = `${count}`;
    this.iconPath = new vscode4.ThemeIcon("folder-library");
  }
};
var CommandItem = class extends vscode4.TreeItem {
  constructor(label, description, slashCommand) {
    super(label, vscode4.TreeItemCollapsibleState.None);
    this.label = label;
    this.slashCommand = slashCommand;
    this.description = description;
    this.tooltip = `${slashCommand} \u2014 ${description}`;
    this.iconPath = new vscode4.ThemeIcon("terminal");
    this.command = {
      command: "ghostforge.copySlashCommand",
      title: "Copy Slash Command",
      arguments: [slashCommand]
    };
  }
};

// src/statusBar.ts
var vscode5 = __toESM(require("vscode"));
var StatusBarManager = class {
  constructor(context) {
    this.statusBarItem = vscode5.window.createStatusBarItem(vscode5.StatusBarAlignment.Right, 100);
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
  registerChatParticipant(context, toolkitRoot);
  const snippetProvider = new SnippetTreeProvider(toolkitRoot);
  vscode6.window.registerTreeDataProvider("ghostforge.snippets", snippetProvider);
  context.subscriptions.push(
    vscode6.commands.registerCommand("ghostforge.refreshSnippets", () => snippetProvider.refresh())
  );
  const commandProvider = new CommandTreeProvider(toolkitRoot);
  vscode6.window.registerTreeDataProvider("ghostforge.commands", commandProvider);
  const statusBar = new StatusBarManager(context);
  statusBar.show();
  vscode6.window.showInformationMessage("\u26A1 GhostForge AI Toolkit ready! (Cmd+Shift+E to open picker)");
}
function deactivate() {
}
function findToolkitRoot() {
  const os = require("os");
  const path4 = require("path");
  const fs4 = require("fs");
  const candidates = [
    path4.join(os.homedir(), "ghostforge"),
    path4.join(os.homedir(), "Documents", "ghostforge")
  ];
  for (const candidate of candidates) {
    if (fs4.existsSync(path4.join(candidate, "VERSION"))) {
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
