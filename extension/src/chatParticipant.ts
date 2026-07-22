import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

const PARTICIPANT_ID = 'ghostforge';

const SLASH_COMMANDS = [
  { name: 'health',       description: 'Run project health check' },
  { name: 'review',       description: 'Code review current file' },
  { name: 'test',         description: 'Generate tests for current file' },
  { name: 'docs',         description: 'Generate documentation' },
  { name: 'rtl',          description: 'RTL audit (Tailwind LTR → RTL)' },
  { name: 'bundle',       description: 'Bundle size analysis' },
  { name: 'commit',       description: 'Suggest a commit message' },
  { name: 'security',     description: 'Security audit' },
  { name: 'optimize',     description: 'Optimize current code' },
  { name: 'estimate',     description: 'Estimate story points for task' },
  { name: 'changelog',    description: 'Generate CHANGELOG entry' },
  { name: 'snippet',      description: 'Browse and insert snippets' },
  { name: 'jarvis',       description: 'Ask G.F.A.I. (JARVIS) via GhostForge API' },
  { name: 'model',        description: 'Switch AI model (@ghostforge /model ollama:qwen3:14b)' },
  { name: 'models',       description: 'List all available AI models + local Ollama models' },
  { name: 'localmodel',   description: 'Use a local Ollama model in this chat session' },
  { name: 'install',      description: 'Install a local model via Ollama (e.g. /install qwen3:14b)' },
  { name: 'llmfit',       description: 'Get LLMfit best-model recommendation for your hardware' },
  { name: 'maccontrol',   description: 'Control Mac via AppleScript (e.g. /maccontrol lock)' },
  { name: 'help',         description: 'List all available commands' },
];

// ── State (per-session) ───────────────────────────────────────────────────────

let selectedProvider = '';
let selectedModelId  = '';
const GF_API_BASE    = 'http://localhost:3001';
const GF_HTTPS_BASE  = 'https://localhost:3001';
const GF_COOKIE      = 'gf_token=2001';

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const versionFile = path.join(toolkitRoot, '..', 'VERSION');
  if (fs.existsSync(versionFile)) {
    lines.push(`Toolkit version: ${fs.readFileSync(versionFile, 'utf8').trim()}`);
  }
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
    'You are @ghostforge, the GhostForge AI Developer Toolkit assistant (G.F.A.I.).',
    'You help developers with React, Next.js, TypeScript, Tailwind CSS, RTL, Arabic localisation, AI integration, Mac automation, and all GhostForge toolkit features.',
    'You are opinionated about code quality, accessibility, and performance.',
    '',
    getProjectContext(toolkitRoot),
    '',
    'When asked to run a script (health, rtl, bundle, etc.), tell the user to use Cmd+Shift+E or run the bash script directly.',
    'Keep responses concise and actionable. Use code blocks for code examples.',
    '',
    `Active model: ${selectedModelId ? `${selectedModelId} (${selectedProvider})` : 'Copilot default'}`,
  ].join('\n');
}

/** Call GhostForge API — tries HTTPS first, falls back to HTTP */
function callGhostForgeAPI(apiPath: string, body: object): Promise<string> {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(body);
    // Try HTTPS with rejectUnauthorized:false (self-signed mkcert cert)
    const https = require('https') as typeof import('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    const req = https.request({
      hostname: 'localhost',
      port: 3001,
      path: apiPath,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Cookie': GF_COOKIE,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', () => {
      // Fallback to HTTP
      const req2 = http.request({
        hostname: 'localhost', port: 3001, path: apiPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), 'Cookie': GF_COOKIE },
      }, (res) => {
        let data = ''; res.on('data', (c: Buffer) => data += c); res.on('end', () => resolve(data));
      });
      req2.on('error', (e: Error) => resolve(JSON.stringify({ error: e.message })));
      req2.setTimeout(30000, () => { req2.destroy(); resolve(JSON.stringify({ error: 'timeout' })); });
      req2.write(bodyStr); req2.end();
    });
    req.setTimeout(30000, () => { req.destroy(); resolve(JSON.stringify({ error: 'timeout' })); });
    req.write(bodyStr);
    req.end();
  });
}

/** GET GhostForge API — HTTPS with http fallback */
function getGhostForgeAPI(apiPath: string): Promise<string> {
  return new Promise((resolve) => {
    const https = require('https') as typeof import('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    const req = https.get(`${GF_HTTPS_BASE}${apiPath}`, { agent, headers: { 'Cookie': GF_COOKIE } }, (res: import('http').IncomingMessage) => {
      let data = ''; res.on('data', (c: Buffer) => data += c); res.on('end', () => resolve(data));
    });
    req.on('error', () => {
      // HTTP fallback
      const req2 = http.get(`${GF_API_BASE}${apiPath}`, { headers: { 'Cookie': GF_COOKIE } }, (res) => {
        let data = ''; res.on('data', (c: Buffer) => data += c); res.on('end', () => resolve(data));
      });
      req2.on('error', (e: Error) => resolve(JSON.stringify({ error: e.message })));
      req2.setTimeout(8000, () => { req2.destroy(); resolve(JSON.stringify({ error: 'timeout' })); });
    });
    req.setTimeout(8000, () => { req.destroy(); resolve(JSON.stringify({ error: 'timeout' })); });
  });
}

function renderHelp(): string {
  const lines = [
    '## 👻 @ghostforge — GhostForge AI Toolkit (G.F.A.I.)',
    '',
    '### Chat Commands',
    ...SLASH_COMMANDS.map(cmd => `- \`/${cmd.name}\` — ${cmd.description}`),
    '',
    '### 🤖 Local Model Selection (Ollama)',
    '- `@ghostforge /llmfit` — Scan hardware + recommend best local model',
    '- `@ghostforge /install qwen3:14b` — Install model via Ollama',
    '- `@ghostforge /install llama3.2:3b` — Install lighter model',
    '- `@ghostforge /localmodel qwen3:14b` — Use this model for chat in this session',
    '- `@ghostforge /models` — See all installed local models',
    '',
    '### Model Selection',
    '- `@ghostforge /model gemini` — Switch to Gemini',
    '- `@ghostforge /model grok` — Switch to Grok (xAI)',
    '- `@ghostforge /model ollama:qwen3:14b` — Switch to specific local Ollama model',
    '- `@ghostforge /model deepseek-r1` — Switch to DeepSeek R1 (reasoning)',
    '- `@ghostforge /model auto` — Reset to auto fallback chain',
    '',
    '### G.F.A.I. Direct Chat',
    '- `@ghostforge /jarvis what time is it?` — Ask JARVIS',
    '- `@ghostforge /jarvis lock the screen` — Mac control via JARVIS',
    '- `@ghostforge /jarvis search for React 19 features` — Web search',
    '',
    '### Mac Control',
    '- `@ghostforge /maccontrol lock` — Lock screen',
    '- `@ghostforge /maccontrol screenshot` — Take screenshot',
    '- `@ghostforge /maccontrol open Safari` — Open app',
    '',
    '### Examples',
    '- `@ghostforge /health` — Check project health score',
    '- `@ghostforge /review` — Review the current file',
    '- `@ghostforge /llmfit` — Find best AI model for your hardware',
    '- `@ghostforge /install qwen2.5-coder:7b` — Install coding model locally',
  ];
  return lines.join('\n');
}

// ── Chat participant handler ───────────────────────────────────────────────────

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
    const prompt  = request.prompt.trim();

    // ── /help ─────────────────────────────────────────────────────────────────
    if (command === 'help' || (!command && !prompt)) {
      stream.markdown(renderHelp());
      return;
    }

    // ── /models — list all models ─────────────────────────────────────────────
    if (command === 'models') {
      stream.markdown('### 🤖 Available AI Models\n\nFetching from GhostForge API...\n');
      try {
        const raw = await getGhostForgeAPI('/api/jarvis/models');
        const data = JSON.parse(raw) as {
          models: Array<{ provider: string; id: string; label: string; available: boolean; free: boolean }>;
          active: { provider: string; model: string };
          ollama: { running: boolean; models: string[] };
        };
        const lines: string[] = [
          `**Active model:** \`${data.active?.model || 'auto'}\` (${data.active?.provider || 'unknown'})`,
          `**Ollama:** ${data.ollama?.running ? `✅ Running — models: ${data.ollama.models.join(', ')}` : '❌ Not running'}`,
          '',
          '| Provider | Model | Available | Free |',
          '|----------|-------|-----------|------|',
        ];
        for (const m of data.models || []) {
          lines.push(`| ${m.provider} | \`${m.id}\` | ${m.available ? '✅' : '❌'} | ${m.free ? '🆓' : '💳'} |`);
        }
        lines.push('', `**Currently selected in chat:** \`${selectedModelId || 'auto'}\` (${selectedProvider || 'fallback chain'})`);
        stream.markdown(lines.join('\n'));
      } catch {
        stream.markdown('⚠️ GhostForge server not running at localhost:3001. Start it with `npm start -- -p 3001` in GhostForge/web-ui/');
      }
      return;
    }

    // ── /model <name> — switch model ──────────────────────────────────────────
    if (command === 'model') {
      const target = prompt.toLowerCase().trim();
      if (!target || target === 'auto') {
        selectedProvider = '';
        selectedModelId  = '';
        stream.markdown('✅ **Model reset to auto** — GhostForge will use the best available model automatically.');
        return;
      }
      // Handle ollama:<model> syntax e.g. /model ollama:qwen3:14b
      if (target.startsWith('ollama:')) {
        selectedProvider = 'ollama';
        selectedModelId  = target.slice(7); // strip "ollama:"
      } else if (target.includes('grok') || target === 'xai') {
        selectedProvider = 'xai';
        selectedModelId  = target.includes('3') && !target.includes('mini') ? 'grok-3' : 'grok-3-mini';
      } else if (target.includes('gemini') || target === 'google') {
        selectedProvider = 'google';
        selectedModelId  = target.includes('2.5') ? 'gemini-2.5-flash' : 'gemini-2.0-flash';
      } else if (target === 'ollama') {
        selectedProvider = 'ollama';
        selectedModelId  = 'qwen2.5-coder:7b';
      } else if (target.includes('openrouter') || target.includes('gemma') || target.includes('nemotron')) {
        selectedProvider = 'openrouter';
        selectedModelId  = target.includes('120') ? 'nvidia/nemotron-3-super-120b-a12b:free' : 'google/gemma-4-26b-a4b-it:free';
      } else if (target.includes('deepseek') || target.includes('r1')) {
        selectedProvider = 'openrouter';
        selectedModelId  = 'deepseek/deepseek-r1:free';
      } else {
        // Pass through as-is — could be any ollama model name
        selectedModelId  = prompt.trim();
        selectedProvider = prompt.includes('/') ? 'openrouter' : 'ollama';
      }
      stream.markdown(`✅ **Model switched to** \`${selectedModelId}\` (${selectedProvider})\n\nAll subsequent \`@ghostforge\` messages will use this model via GhostForge API.`);
      return;
    }

    // ── /localmodel <ollama-model> — use specific local Ollama model ──────────
    if (command === 'localmodel') {
      const modelName = prompt.trim();
      if (!modelName) {
        stream.markdown('**Usage:** `@ghostforge /localmodel qwen3:14b`\n\nThis sets your current session to use that local Ollama model.');
        return;
      }
      selectedProvider = 'ollama';
      selectedModelId  = modelName;
      stream.markdown([
        `✅ **Local model set:** \`${modelName}\` via Ollama`,
        '',
        'All @ghostforge queries this session will route to your local Ollama instance.',
        `Make sure it's installed: run \`ollama pull ${modelName}\` in terminal, or use \`@ghostforge /install ${modelName}\``,
      ].join('\n'));
      return;
    }

    // ── /install <model> — install via Ollama ─────────────────────────────────
    if (command === 'install') {
      const modelName = prompt.trim();
      if (!modelName) {
        stream.markdown('**Usage:** `@ghostforge /install qwen3:14b`\n\nInstalls the model via Ollama. Run `/llmfit` first to get a recommendation.');
        return;
      }
      stream.markdown(`⏳ **Installing \`${modelName}\`** via Ollama...\n\nThis runs in the background and may take several minutes depending on model size.\n`);
      try {
        const raw = await callGhostForgeAPI('/api/llmfit', { customModel: modelName });
        const data = JSON.parse(raw) as { status?: string; message?: string; error?: string };
        if (data.error) {
          stream.markdown(`❌ **Install error:** ${data.error}`);
        } else {
          stream.markdown([
            `✅ **Ollama pull started for \`${modelName}\`**`,
            '',
            `${data.message || 'Installing in background...'}`,
            '',
            'Check progress in your terminal: `ollama list`',
            `Once installed, use: \`@ghostforge /localmodel ${modelName}\``,
          ].join('\n'));
        }
      } catch {
        stream.markdown(`⚠️ GhostForge server not running. Install manually:\n\`\`\`\nollama pull ${modelName}\n\`\`\``);
      }
      return;
    }

    // ── /llmfit — get hardware-aware model recommendation ────────────────────
    if (command === 'llmfit') {
      stream.markdown('🔍 **LLMfit** — Analyzing your hardware and finding the best local model...\n');
      try {
        const raw = await getGhostForgeAPI('/api/llmfit');
        const data = JSON.parse(raw) as {
          hardware?: { ramGB: number; availableGB: number; cpuBrand: string; appleSilicon: boolean };
          recommendation?: { best: string; bestInstalled: string; pullFirst: string; summary: string };
          models?: Array<{ id: string; name: string; params: string; ramGB: number; compositeScore: number; recommendation: string; isInstalled: boolean; canRun: boolean }>;
        };
        if (data.hardware) {
          const hw = data.hardware;
          const rec = data.recommendation;
          const topModels = (data.models || []).filter(m => m.canRun).slice(0, 6);
          const lines: string[] = [
            `## 🖥️ Hardware Profile`,
            `- **CPU:** ${hw.cpuBrand}${hw.appleSilicon ? ' (Apple Silicon ✓)' : ''}`,
            `- **RAM:** ${hw.ramGB}GB total, ~${hw.availableGB}GB available for AI`,
            '',
            `## 🏆 Best Model Recommendation`,
            rec?.bestInstalled
              ? `✅ **Best installed:** \`${rec.bestInstalled}\` — ready to use now`
              : `📥 **Recommended to install:** \`${rec?.best || 'qwen2.5-coder:7b'}\``,
            rec?.pullFirst ? `\n> Install with: \`ollama pull ${rec.best}\`` : '',
            `\n> ${rec?.summary || ''}`,
            '',
            '## 📊 Top Compatible Models',
            '| Model | Params | RAM | Score | Status |',
            '|-------|--------|-----|-------|--------|',
            ...topModels.map(m => `| \`${m.id}\` | ${m.params}B | ${m.ramGB}GB | ${m.compositeScore}/100 | ${m.isInstalled ? '✅ installed' : '📥 install'} |`),
            '',
            '**Quick install:** `@ghostforge /install ' + (rec?.best || 'qwen2.5-coder:7b') + '`',
            '**Use in chat:** `@ghostforge /localmodel ' + (rec?.bestInstalled || rec?.best || 'qwen2.5-coder:7b') + '`',
          ];
          stream.markdown(lines.join('\n'));
        } else {
          stream.markdown('⚠️ Could not reach GhostForge API. Make sure server is running at https://localhost:3001');
        }
      } catch {
        stream.markdown('⚠️ LLMfit analysis failed. Is GhostForge running on port 3001?');
      }
      return;
    }

    // ── /jarvis <message> — send directly to G.F.A.I. ────────────────────────
    if (command === 'jarvis') {
      const message = prompt || 'Hello, G.F.A.I. Status?';
      stream.markdown(`**G.F.A.I.** *(${selectedModelId || 'auto'})* — asking: *"${message}"*\n\n`);

      try {
        const raw = await callGhostForgeAPI('/api/jarvis', {
          message,
          selectedProvider: selectedProvider || undefined,
          selectedModel:    selectedModelId  || undefined,
        });
        const data = JSON.parse(raw) as {
          speech: string; tool: string | null; toolResult: string | null;
          usedModel?: string; usedProvider?: string; domain?: string; confidence?: number;
        };

        if (data.usedModel) {
          stream.markdown(`> 🤖 **Model used:** \`${data.usedModel}\` (${data.usedProvider || ''})${data.domain ? ` | **Domain:** ${data.domain}` : ''}${data.confidence !== undefined ? ` | **Confidence:** ${data.confidence}%` : ''}\n\n`);
        }
        stream.markdown(data.speech || 'G.F.A.I. returned no response.');
        if (data.tool && data.toolResult) {
          stream.markdown(`\n\n---\n**Tool used:** \`${data.tool}\`\n\`\`\`\n${String(data.toolResult).slice(0, 1500)}\n\`\`\``);
        }
      } catch {
        stream.markdown('⚠️ G.F.A.I. unavailable. Make sure GhostForge web server is running on port 3001.');
      }
      return;
    }

    // ── /maccontrol <action> — Mac automation ─────────────────────────────────
    if (command === 'maccontrol') {
      const action = prompt || 'system status';
      stream.markdown(`**Mac Control** — executing: *"${action}"*\n\n`);
      try {
        const raw = await callGhostForgeAPI('/api/jarvis', {
          message: `Execute Mac control: ${action}`,
          selectedProvider: selectedProvider || undefined,
          selectedModel:    selectedModelId  || undefined,
        });
        const data = JSON.parse(raw) as { speech: string; tool: string | null; toolResult: string | null };
        stream.markdown(data.speech || 'Done.');
        if (data.toolResult) {
          stream.markdown(`\n\n\`\`\`\n${String(data.toolResult).slice(0, 1500)}\n\`\`\``);
        }
      } catch {
        stream.markdown('⚠️ Mac control requires GhostForge server running on port 3001.');
      }
      return;
    }

    // ── Build Copilot chat messages ───────────────────────────────────────────

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(buildSystemPrompt(toolkitRoot)),
    ];

    // Prior context (last 4 turns)
    for (const turn of chatContext.history.slice(-4)) {
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

    let userMessage = '';
    if (command) userMessage = `Command: /${command}\n`;

    const fileAwareCommands = ['review', 'test', 'docs', 'optimize', 'rtl', 'security', 'commit', 'snippet'];
    if (fileAwareCommands.includes(command) || !command) {
      const fileContent = getActiveFileContent();
      if (fileContent) userMessage += `\nActive file:\n${fileContent}\n`;
    }

    if (prompt) userMessage += `\nUser request: ${prompt}`;
    if (!userMessage.trim()) { stream.markdown(renderHelp()); return; }

    messages.push(vscode.LanguageModelChatMessage.User(userMessage));

    // ── Route to GhostForge API if a custom model is selected ─────────────────
    if (selectedModelId && selectedProvider && selectedProvider !== 'copilot') {
      stream.markdown(`> 🔄 **Routing to GhostForge API** — model: \`${selectedModelId}\` (${selectedProvider})\n\n`);
      try {
        const raw = await callGhostForgeAPI('/api/chat', {
          messages: messages.map(m => ({
            role: m.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant',
            content: typeof m.content === 'string' ? m.content : (m.content as Array<{ value?: string }>).map(p => p.value || '').join(''),
          })),
          selectedProvider,
          selectedModel: selectedModelId,
        });
        const data = JSON.parse(raw) as { text?: string; response?: string; error?: string };
        if (data.error) {
          stream.markdown(`⚠️ API error: ${data.error}\n\n*Falling back to Copilot...*\n`);
          // Fall through to Copilot
        } else {
          stream.markdown(data.text || data.response || 'No response from model.');
          return;
        }
      } catch {
        stream.markdown('⚠️ GhostForge API unreachable — falling back to Copilot.\n\n');
        // Fall through
      }
    }

    // ── Default: use GitHub Copilot LM API ────────────────────────────────────
    let model: vscode.LanguageModelChat | undefined;
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      model = models.find(m => m.id.includes('gpt-4') || m.id.includes('claude')) ?? models[0];
    } catch {
      stream.markdown('⚠️ No language model available. Make sure GitHub Copilot is active.');
      return;
    }

    if (!model) { stream.markdown('⚠️ No language model available.'); return; }

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

  // Guard: vscode.chat is only available when GitHub Copilot Chat is installed.
  // Without the guard the whole extension activation crashes, breaking the
  // command picker and status bar even for users without Copilot Chat.
  if (!vscode.chat?.createChatParticipant) {
    console.log('[GhostForge] GitHub Copilot Chat not available — @ghostforge participant skipped');
    return;
  }

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);

  // Use assets/icon.png (the real location); gracefully skip if missing
  try {
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.png');
  } catch {
    // icon not critical
  }

  participant.followupProvider = {
    provideFollowups(
      _result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken
    ) {
      return [
        { prompt: '', label: '📋 List all commands', command: 'help' },
        { prompt: '', label: '⚕️ Health check',       command: 'health' },
        { prompt: '', label: '🔍 Review this file',   command: 'review' },
        { prompt: '', label: '🤖 List AI models',     command: 'models' },
        { prompt: 'what time is it?', label: '🕐 Ask JARVIS', command: 'jarvis' },
      ];
    },
  };

  context.subscriptions.push(participant);
}

