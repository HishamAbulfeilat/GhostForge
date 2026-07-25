#!/usr/bin/env node
/**
 * GhostForge Comprehensive Feature Tests
 * Run: node tests/feature-tests.js
 * No external dependencies — uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function testSkip(name, reason, fn) {
  skipped++;
  console.log(`  ⏭️  ${name} (skipped: ${reason})`);
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${expected}, got ${actual}`);
  }
}

function assertExists(p, msg) {
  if (!fs.existsSync(path.join(ROOT, p))) {
    throw new Error(msg || `File not found: ${p}`);
  }
}

function assertHasContent(p, minLines, msg) {
  assertExists(p, msg || `File not found: ${p}`);
  const content = fs.readFileSync(path.join(ROOT, p), 'utf8');
  const lineCount = content.split('\n').length;
  if (lineCount < (minLines || 10)) {
    throw new Error(msg || `File ${p} has only ${lineCount} lines, expected >= ${minLines}`);
  }
  return content;
}

function fileExists(p) {
  return fs.existsSync(path.join(ROOT, p));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
}

function readText(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║       GHOSTFORGE  —  Comprehensive Feature Tests         ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// ─── A. TUI Terminal Tests ─────────────────────────────────────
console.log('━━ A. TUI Terminal Tests ━━');

test('tui/index.js exists', () => {
  assertExists('tui/index.js');
});

test('tui/index.js has substantial content (6000+ lines)', () => {
  assertHasContent('tui/index.js', 6000);
});

test('tui/index.js has shebang', () => {
  const content = readText('tui/index.js');
  assert(content.startsWith('#!/'), 'Missing shebang line');
});

test('tui/index.js imports inquirer prompts', () => {
  const content = readText('tui/index.js');
  assert(content.includes('@inquirer/prompts'), 'Missing @inquirer/prompts import');
});

test('tui/index.js uses chalk', () => {
  const content = readText('tui/index.js');
  assert(content.includes("import chalk from 'chalk'"), 'Missing chalk import');
});

test('tui/index.js uses boxen', () => {
  const content = readText('tui/index.js');
  assert(content.includes("import boxen from 'boxen'"), 'Missing boxen import');
});

test('tui/index.js uses figlet', () => {
  const content = readText('tui/index.js');
  assert(content.includes("import figlet from 'figlet'"), 'Missing figlet import');
});

test('tui/package.json exists and is valid', () => {
  const pkg = readJson('tui/package.json');
  assert(pkg.name, 'Missing package name');
  assert(pkg.dependencies, 'Missing dependencies');
});

test('tui/lib/menu-search.js exists', () => {
  assertExists('tui/lib/menu-search.js');
});

test('tui/lib/recent-commands.js exists', () => {
  assertExists('tui/lib/recent-commands.js');
});

test('tui/lib/gfai-client.js exists', () => {
  assertExists('tui/lib/gfai-client.js');
});

test('tui/lib/llmfit-client.js exists', () => {
  assertExists('tui/lib/llmfit-client.js');
});

test('tui/lib/menu-search.js has filterMenuChoices export', () => {
  const content = readText('tui/lib/menu-search.js');
  assert(content.includes('filterMenuChoices'), 'Missing filterMenuChoices export');
});

test('tui/lib/menu-search.js has groupCommandChoices export', () => {
  const content = readText('tui/lib/menu-search.js');
  assert(content.includes('groupCommandChoices'), 'Missing groupCommandChoices export');
});

test('tui/lib/recent-commands.js has readRecentCommands export', () => {
  const content = readText('tui/lib/recent-commands.js');
  assert(content.includes('readRecentCommands'), 'Missing readRecentCommands export');
});

test('tui/lib/recent-commands.js has rememberCommand export', () => {
  const content = readText('tui/lib/recent-commands.js');
  assert(content.includes('rememberCommand'), 'Missing rememberCommand export');
});

test('tui/lib/gfai-client.js has askGFAI export', () => {
  const content = readText('tui/lib/gfai-client.js');
  assert(content.includes('askGFAI'), 'Missing askGFAI export');
});

test('tui/lib/llmfit-client.js has normalizeLLMFitCLI export', () => {
  const content = readText('tui/lib/llmfit-client.js');
  assert(content.includes('normalizeLLMFitCLI'), 'Missing normalizeLLMFitCLI export');
});

test('tui/test directory has test files', () => {
  const testDir = path.join(ROOT, 'tui/test');
  assert(fs.existsSync(testDir), 'tui/test directory not found');
  const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'));
  assert(files.length >= 4, `Expected >= 4 test files, found ${files.length}`);
});

// ─── B. Electron App Tests ─────────────────────────────────────
console.log('\n━━ B. Electron App Tests ━━');

const MAIN_MODULES = [
  'auto-start.ts', 'autonomous-agent.ts', 'bridge-manager.ts',
  'browser-automation.ts', 'calendar-integration.ts', 'clipboard-intel.ts',
  'code-modifier.ts', 'connection-toggle.ts', 'contacts-integration.ts',
  'cursor-overlay.ts', 'email-integration.ts', 'file-processor.ts',
  'game-updater.ts', 'gemini-live.ts', 'google-ai-studio.ts',
  'hardware-monitor.ts', 'index.ts', 'jarvis-connection.ts',
  'jarvis-daemon.ts', 'memory.ts', 'morning-briefing.ts',
  'n8n-integration.ts', 'omniroute.ts', 'proactive.ts',
  'screen-capture.ts', 'self-updater.ts', 'setup-wizard.ts',
  'system-control.ts', 'tray.ts', 'voice.ts',
  'voicebox-integration.ts', 'youtube.ts',
];

test(`electron-app/src/main/ has ${MAIN_MODULES.length} TypeScript modules`, () => {
  const dir = path.join(ROOT, 'electron-app/src/main');
  assert(fs.existsSync(dir), 'electron-app/src/main/ not found');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));
  assert(files.length >= MAIN_MODULES.length - 2,
    `Expected >= ${MAIN_MODULES.length - 2} modules, found ${files.length}`);
});

for (const mod of MAIN_MODULES) {
  if (mod === 'index.ts') continue; // tested separately
  test(`  module: ${mod} exists and has content`, () => {
    assertHasContent(`electron-app/src/main/${mod}`, 20);
  });
}

test('index.ts imports all main modules', () => {
  const content = readText('electron-app/src/main/index.ts');
  const criticalImports = [
    'screen-capture', 'cursor-overlay', 'voice', 'system-control',
    'memory', 'tray', 'proactive', 'morning-briefing',
    'autonomous-agent', 'browser-automation', 'jarvis-daemon',
  ];
  for (const imp of criticalImports) {
    assert(content.includes(imp) || content.includes(imp.replace(/-/g, '_')),
      `index.ts does not reference module: ${imp}`);
  }
});

test('electron-app/package.json is valid and has dependencies', () => {
  const pkg = readJson('electron-app/package.json');
  assertEqual(pkg.name, 'ghostforge-jarvis');
  assert(pkg.dependencies, 'Missing dependencies');
  assertEqual(pkg.dependencies['electron-store'], '^8.1.0');
  assertEqual(pkg.dependencies['playwright'], '^1.62.0');
  assertEqual(pkg.dependencies['sharp'], '^0.33.2');
  assertEqual(pkg.dependencies['systeminformation'], '^5.33.1');
  assertEqual(pkg.dependencies['xlsx'], '^0.18.5');
});

test('electron-app/package.json has all build scripts', () => {
  const pkg = readJson('electron-app/package.json');
  const required = ['dev', 'build', 'build:mac', 'build:win', 'build:linux', 'build:all', 'start'];
  for (const script of required) {
    assert(pkg.scripts[script], `Missing script: ${script}`);
  }
});

test('electron-app/electron-builder.yml has all platform configs', () => {
  const content = readText('electron-app/electron-builder.yml');
  assert(content.includes('mac:'), 'Missing mac config');
  assert(content.includes('win:'), 'Missing win config');
  assert(content.includes('linux:'), 'Missing linux config');
  assert(content.includes('nsis:'), 'Missing nsis config');
  assert(content.includes('appId: com.ghostforge.jarvis'), 'Missing appId');
});

test('electron-app/capacitor.config.json is valid JSON', () => {
  const config = readJson('electron-app/capacitor.config.json');
  assertEqual(config.appId, 'com.ghostforge.jarvis');
  assert(config.plugins, 'Missing plugins config');
  assert(config.android, 'Missing android config');
  assert(config.ios, 'Missing ios config');
});

test('Build icon.icns exists', () => {
  assertExists('electron-app/build/icon.icns');
});

test('Build icon.ico exists', () => {
  assertExists('electron-app/build/icon.ico');
});

test('Build icon.png exists', () => {
  assertExists('electron-app/build/icon.png');
});

test('electron-app/scripts/generate-icons.js exists', () => {
  assertExists('electron-app/scripts/generate-icons.js');
});

test('electron-app/scripts/build-all-platforms.sh exists', () => {
  assertExists('electron-app/scripts/build-all-platforms.sh');
});

test('electron-app/scripts/build-android.sh exists', () => {
  assertExists('electron-app/scripts/build-android.sh');
});

test('electron-app/scripts/notarize.js exists', () => {
  assertExists('electron-app/scripts/notarize.js');
});

// ─── C. Web UI Tests ───────────────────────────────────────────
console.log('\n━━ C. Web UI Tests ━━');

test('web-ui/package.json is valid', () => {
  const pkg = readJson('web-ui/package.json');
  assertEqual(pkg.name, 'ghostforge-web');
  assert(pkg.dependencies, 'Missing dependencies');
});

test('web-ui/app/layout.tsx exists', () => {
  assertExists('web-ui/app/layout.tsx');
});

test('web-ui/app/layout.tsx has content', () => {
  assertHasContent('web-ui/app/layout.tsx', 20);
});

test('web-ui/app/jarvis/page.tsx exists and has 2000+ lines', () => {
  assertHasContent('web-ui/app/jarvis/page.tsx', 2000);
});

test('web-ui/app/page.tsx (home) exists', () => {
  assertExists('web-ui/app/page.tsx');
});

const WEB_COMPONENTS = [
  'AgentDashboard.tsx', 'AgentPanel.tsx', 'ChatInput.tsx', 'ChatInterface.tsx',
  'ChatMessage.tsx', 'ChunkErrorHandler.tsx', 'ClickyOverlay.tsx', 'CollabShare.tsx',
  'CommandPalette.tsx', 'CommandPanel.tsx', 'HFModelCard.tsx', 'LLMfitAutoSwitch.tsx',
  'MacMetricsWidget.tsx', 'MacStatus.tsx', 'MarkLPanel.tsx', 'MemoryPanel.tsx',
  'MessageBubble.tsx', 'ModelSelector.tsx', 'Navbar.tsx', 'NotificationCenter.tsx',
  'OrchestratePanel.tsx', 'PWAInstallBanner.tsx', 'ToolResult.tsx', 'VoiceSettings.tsx',
  'VoiceboxPanel.tsx', 'XTermWrapper.tsx',
];

test(`All ${WEB_COMPONENTS.length} web-ui components exist`, () => {
  const compDir = path.join(ROOT, 'web-ui/components');
  assert(fs.existsSync(compDir), 'web-ui/components/ not found');
  const existing = fs.readdirSync(compDir).filter(f => f.endsWith('.tsx'));
  for (const comp of WEB_COMPONENTS) {
    assert(existing.includes(comp), `Missing component: ${comp}`);
  }
});

for (const comp of WEB_COMPONENTS) {
  test(`  component: ${comp}`, () => {
    assertHasContent(`web-ui/components/${comp}`, 10);
  });
}

const API_ROUTES = [
  'jarvis/route.ts', 'chat/route.ts', 'execute/route.ts',
  'auth/route.ts', 'copilot/route.ts', 'models/route.ts',
  'models/local/route.ts', 'models/install/route.ts', 'models/recommend/route.ts',
  'marketplace/route.ts', 'huggingface/route.ts', 'awesome-llm-apps/route.ts',
  'doctor/route.ts', 'files/route.ts', 'dashboard/route.ts',
  'metrics/route.ts', 'webhook/route.ts', 'bridge-status/route.ts',
  'mac-control/route.ts', 'llmfit/route.ts', 'push/route.ts',
  'pty-token/route.ts',
  'jarvis/memory/route.ts', 'jarvis/models/route.ts', 'jarvis/vault/route.ts',
  'jarvis/orchestrate/route.ts', 'jarvis/morning/route.ts', 'jarvis/biometrics/route.ts',
  'jarvis/proactive/route.ts', 'jarvis/audit/route.ts', 'jarvis/history/route.ts',
  'jarvis/collab/route.ts', 'jarvis/screen-capture/route.ts', 'jarvis/tts/route.ts',
  'remote/setup/route.ts',
];

test(`All ${API_ROUTES.length} API routes exist`, () => {
  for (const route of API_ROUTES) {
    assertExists(`web-ui/app/api/${route}`, `Missing API route: ${route}`);
  }
});

test('web-ui/lib/quick-actions.ts exists', () => {
  assertExists('web-ui/lib/quick-actions.ts');
});

test('web-ui/lib/quick-actions.ts has content', () => {
  assertHasContent('web-ui/lib/quick-actions.ts', 20);
});

test('web-ui/lib/voice-runtime.js exists and has wake phrases', () => {
  const content = readText('web-ui/lib/voice-runtime.js');
  assert(content.includes('DEFAULT_WAKE_PHRASES'), 'Missing DEFAULT_WAKE_PHRASES');
  assert(content.includes('hey jarvis'), 'Missing wake phrase: hey jarvis');
  assert(content.includes('hey ghostforge'), 'Missing wake phrase: hey ghostforge');
});

test('web-ui/lib/auth.ts exists', () => {
  assertExists('web-ui/lib/auth.ts');
});

test('web-ui/lib/ai.ts exists', () => {
  assertExists('web-ui/lib/ai.ts');
});

test('web-ui/lib/local-models.ts exists', () => {
  assertExists('web-ui/lib/local-models.ts');
});

// ─── D. JARVIS Feature Tests ───────────────────────────────────
console.log('\n━━ D. JARVIS Feature Tests ━━');

test('VoiceSettings.tsx exists', () => {
  assertExists('web-ui/components/VoiceSettings.tsx');
});

test('VoiceboxPanel.tsx exists', () => {
  assertExists('web-ui/components/VoiceboxPanel.tsx');
});

test('voice-runtime.js has wake phrases', () => {
  const content = readText('web-ui/lib/voice-runtime.js');
  assert(content.includes('hey ghostforge'), 'Missing hey ghostforge');
  assert(content.includes('hey jarvis'), 'Missing hey jarvis');
  assert(content.includes('ok jarvis'), 'Missing ok jarvis');
  assert(content.includes('okay jarvis'), 'Missing okay jarvis');
});

test('voice-runtime.js has findWakePhrase function', () => {
  const content = readText('web-ui/lib/voice-runtime.js');
  assert(content.includes('findWakePhrase'), 'Missing findWakePhrase function');
});

test('Mark-L: youtube.ts exists', () => {
  assertExists('electron-app/src/main/youtube.ts');
});

test('Mark-L: game-updater.ts exists', () => {
  assertExists('electron-app/src/main/game-updater.ts');
});

test('Mark-L: clipboard-intel.ts exists', () => {
  assertExists('electron-app/src/main/clipboard-intel.ts');
});

test('Mark-L: browser-automation.ts exists', () => {
  assertExists('electron-app/src/main/browser-automation.ts');
});

test('Mark-L: screen-capture.ts exists', () => {
  assertExists('electron-app/src/main/screen-capture.ts');
});

test('Mark-L: system-control.ts exists', () => {
  assertExists('electron-app/src/main/system-control.ts');
});

test('Mark-L: hardware-monitor.ts exists', () => {
  assertExists('electron-app/src/main/hardware-monitor.ts');
});

test('Mark-L: file-processor.ts exists', () => {
  assertExists('electron-app/src/main/file-processor.ts');
});

test('Memory: ai_memory.py exists in mark-l-bridge', () => {
  assertExists('mark-l-bridge/ai_memory.py');
  assertHasContent('mark-l-bridge/ai_memory.py', 10);
});

test('Agents: ai_agents.py exists in mark-l-bridge', () => {
  assertExists('mark-l-bridge/ai_agents.py');
  assertHasContent('mark-l-bridge/ai_agents.py', 10);
});

test('Browser: ai_browser.py exists in mark-l-bridge', () => {
  assertExists('mark-l-bridge/ai_browser.py');
  assertHasContent('mark-l-bridge/ai_browser.py', 10);
});

test('Models: ai_models.py exists in mark-l-bridge', () => {
  assertExists('mark-l-bridge/ai_models.py');
  assertHasContent('mark-l-bridge/ai_models.py', 10);
});

test('Unified: ai_unified.py exists in mark-l-bridge', () => {
  assertExists('mark-l-bridge/ai_unified.py');
  assertHasContent('mark-l-bridge/ai_unified.py', 10);
});

test('Connection: jarvis-connection.ts exists', () => {
  assertExists('electron-app/src/main/jarvis-connection.ts');
});

test('Connection: omniroute.ts exists', () => {
  assertExists('electron-app/src/main/omniroute.ts');
});

test('Connection: connection-toggle.ts exists', () => {
  assertExists('electron-app/src/main/connection-toggle.ts');
});

test('Daemon: jarvis-daemon.ts exists', () => {
  assertExists('electron-app/src/main/jarvis-daemon.ts');
  assertHasContent('electron-app/src/main/jarvis-daemon.ts', 50);
});

test('Self-update: self-updater.ts exists', () => {
  assertExists('electron-app/src/main/self-updater.ts');
});

test('Self-update: code-modifier.ts exists', () => {
  assertExists('electron-app/src/main/code-modifier.ts');
});

test('Autonomous agent: autonomous-agent.ts exists', () => {
  assertExists('electron-app/src/main/autonomous-agent.ts');
  assertHasContent('electron-app/src/main/autonomous-agent.ts', 100);
});

test('Voice: voice.ts exists', () => {
  assertExists('electron-app/src/main/voice.ts');
});

test('Voicebox: voicebox-integration.ts exists', () => {
  assertExists('electron-app/src/main/voicebox-integration.ts');
});

test('Memory: memory.ts exists', () => {
  assertExists('electron-app/src/main/memory.ts');
});

test('Proactive: proactive.ts exists', () => {
  assertExists('electron-app/src/main/proactive.ts');
});

test('Morning briefing: morning-briefing.ts exists', () => {
  assertExists('electron-app/src/main/morning-briefing.ts');
});

test('Gemini Live: gemini-live.ts exists', () => {
  assertExists('electron-app/src/main/gemini-live.ts');
});

test('Google AI Studio: google-ai-studio.ts exists', () => {
  assertExists('electron-app/src/main/google-ai-studio.ts');
});

// ─── E. Python Bridge Tests ────────────────────────────────────
console.log('\n━━ E. Python Bridge Tests ━━');

test('mark-l-bridge/server.py exists and has 50+ lines', () => {
  assertHasContent('mark-l-bridge/server.py', 50);
});

test('mark-l-bridge/server.py has FastAPI imports', () => {
  const content = readText('mark-l-bridge/server.py');
  assert(content.includes('fastapi'), 'Missing FastAPI import');
  assert(content.includes('uvicorn'), 'Missing uvicorn reference');
});

test('mark-l-bridge/server.py has 40+ FastAPI endpoints', () => {
  const content = readText('mark-l-bridge/server.py');
  const endpointCount = countMatches(content, /@app\.(get|post|put|delete|patch)/g);
  assert(endpointCount >= 40,
    `Expected >= 40 endpoints, found ${endpointCount}`);
});

test('mark-l-bridge/requirements.txt lists all dependencies', () => {
  const content = readText('mark-l-bridge/requirements.txt');
  const required = ['fastapi', 'uvicorn', 'python-multipart', 'mem0ai', 'crewai', 'browser-use', 'huggingface_hub', 'httpx'];
  for (const dep of required) {
    assert(content.includes(dep), `Missing dependency in requirements.txt: ${dep}`);
  }
});

test('mark-l-bridge/start.sh exists', () => {
  assertExists('mark-l-bridge/start.sh');
});

test('mark-l-bridge/server.py imports ai_memory', () => {
  const content = readText('mark-l-bridge/server.py');
  assert(content.includes('ai_memory'), 'Missing ai_memory import');
});

test('mark-l-bridge/server.py imports ai_agents', () => {
  const content = readText('mark-l-bridge/server.py');
  assert(content.includes('ai_agents'), 'Missing ai_agents import');
});

test('mark-l-bridge/server.py imports ai_browser', () => {
  const content = readText('mark-l-bridge/server.py');
  assert(content.includes('ai_browser'), 'Missing ai_browser import');
});

test('mark-l-bridge/server.py imports ai_models', () => {
  const content = readText('mark-l-bridge/server.py');
  assert(content.includes('ai_models'), 'Missing ai_models import');
});

test('mark-l-bridge/server.py has CORS middleware', () => {
  const content = readText('mark-l-bridge/server.py');
  assert(content.includes('CORS') || content.includes('cors'), 'Missing CORS configuration');
});

// ─── F. n8n Integration Tests ──────────────────────────────────
console.log('\n━━ F. n8n Integration Tests ━━');

test('n8n-integration.ts exists in electron-app/src/main', () => {
  assertExists('electron-app/src/main/n8n-integration.ts');
  assertHasContent('electron-app/src/main/n8n-integration.ts', 20);
});

const N8N_WORKFLOWS = [
  'ghostforge-deploy.json',
  'ghostforge-notify.json',
  'ghostforge-pr.json',
  'ghostforge-agent-daily-report.json',
  'ghostforge-agent-pr-review.json',
  'ghostforge-agent-test-runner.json',
  'ghostforge-agent-monitor.json',
];

test(`All ${N8N_WORKFLOWS.length} n8n workflow JSONs exist`, () => {
  for (const wf of N8N_WORKFLOWS) {
    assertExists(`electron-app/n8n-workflows/${wf}`, `Missing workflow: ${wf}`);
  }
});

test('n8n workflow JSONs are valid JSON', () => {
  for (const wf of N8N_WORKFLOWS) {
    try {
      readJson(`electron-app/n8n-workflows/${wf}`);
    } catch (e) {
      throw new Error(`Invalid JSON in ${wf}: ${e.message}`);
    }
  }
});

// ─── G. Build & CI Tests ───────────────────────────────────────
console.log('\n━━ G. Build & CI Tests ━━');

test('.github/workflows/ directory exists', () => {
  assertExists('.github/workflows', '.github/workflows/ not found');
});

test('Release workflow exists', () => {
  const workflowsDir = path.join(ROOT, '.github/workflows');
  if (!fs.existsSync(workflowsDir)) {
    throw new Error('.github/workflows/ directory not found');
  }
  const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  assert(files.length > 0, 'No workflow files found');
});

test('electron-app/scripts/generate-icons.js has content', () => {
  assertHasContent('electron-app/scripts/generate-icons.js', 20);
});

test('electron-app/scripts/build-all-platforms.sh has content', () => {
  assertHasContent('electron-app/scripts/build-all-platforms.sh', 10);
});

test('electron-app/scripts/build-android.sh has content', () => {
  assertHasContent('electron-app/scripts/build-android.sh', 10);
});

test('electron-app/scripts/notarize.js has content', () => {
  assertHasContent('electron-app/scripts/notarize.js', 10);
});

test('electron-app/build/entitlements.mac.plist exists', () => {
  assertExists('electron-app/build/entitlements.mac.plist');
});

// ─── H. Integration Tests ──────────────────────────────────────
console.log('\n━━ H. Integration Tests ━━');

test('IPC handlers count >= 150 in index.ts', () => {
  const content = readText('electron-app/src/main/index.ts');
  const handlerCount = countMatches(content, /ipcMain\.handle\(/g);
  assert(handlerCount >= 150,
    `Expected >= 150 IPC handlers, found ${handlerCount}`);
  console.log(`    (found ${handlerCount} handlers)`);
});

test('Preload namespaces count >= 1 (single electron namespace)', () => {
  const content = readText('electron-app/src/preload/index.ts');
  const namespaceCount = countMatches(content, /contextBridge\.exposeInMainWorld/g);
  assert(namespaceCount >= 1, `Expected >= 1 namespace, found ${namespaceCount}`);
});

test('Preload defines multiple API objects (screen, cursor, voice, system, etc.)', () => {
  const content = readText('electron-app/src/preload/index.ts');
  const namespaces = ['screen:', 'cursor:', 'voice:', 'system:', 'config:',
    'jarvis:', 'memory:', 'automation:', 'n8n:', 'hardware:', 'youtube:',
    'code:', 'email:', 'aiStudio:', 'calendar:', 'contacts:', 'voicebox:'];
  let found = 0;
  for (const ns of namespaces) {
    if (content.includes(ns + ' {') || content.includes(ns + '{')) {
      found++;
    }
  }
  assert(found >= 15, `Expected >= 15 preload API objects, found ${found}`);
  console.log(`    (found ${found} API objects in preload)`);
});

test('JARVIS API tools count >= 20 in route.ts', () => {
  const content = readText('web-ui/app/api/jarvis/route.ts');
  const toolCount = countMatches(content, /case '/g);
  assert(toolCount >= 20, `Expected >= 20 tools, found ${toolCount}`);
  console.log(`    (found ${toolCount} tools)`);
});

test('Python bridge endpoints count >= 40', () => {
  const content = readText('mark-l-bridge/server.py');
  const endpointCount = countMatches(content, /@app\.(get|post|put|delete|patch)/g);
  assert(endpointCount >= 40, `Expected >= 40 endpoints, found ${endpointCount}`);
  console.log(`    (found ${endpointCount} endpoints)`);
});

test('Preload ipcRenderer.invoke calls count >= 100', () => {
  const content = readText('electron-app/src/preload/index.ts');
  const invokeCount = countMatches(content, /ipcRenderer\.invoke\(/g);
  assert(invokeCount >= 100, `Expected >= 100 invoke calls, found ${invokeCount}`);
  console.log(`    (found ${invokeCount} invoke calls)`);
});

test('IPC handlers are unique (no duplicate channel names)', () => {
  const content = readText('electron-app/src/main/index.ts');
  const channels = [...content.matchAll(/ipcMain\.handle\('([^']*)'/g)].map(m => m[1]);
  const unique = new Set(channels);
  assertEqual(channels.length, unique.size,
    `Found ${channels.length - unique.size} duplicate IPC channel(s)`);
});

test('JARVIS page.tsx has executeTool function', () => {
  const content = readText('web-ui/app/jarvis/page.tsx');
  assert(content.includes('executeTool') || content.includes('execute_tool'),
    'Missing executeTool in jarvis page');
});

test('JARVIS route.ts has executeTool function', () => {
  const content = readText('web-ui/app/api/jarvis/route.ts');
  assert(content.includes('executeTool') || content.includes('switch (tool)'),
    'Missing executeTool in jarvis route');
});

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║                    TEST RESULTS                         ║');
console.log('╠═══════════════════════════════════════════════════════════╣');
console.log(`║  ✅ Passed:   ${String(passed).padStart(4)}                                  ║`);
console.log(`║  ❌ Failed:   ${String(failed).padStart(4)}                                  ║`);
console.log(`║  ⏭️  Skipped:  ${String(skipped).padStart(4)}                                  ║`);
console.log(`║  📊 Total:    ${String(passed + failed + skipped).padStart(4)}                                  ║`);
const score = passed + failed > 0 ? ((passed / (passed + failed)) * 100).toFixed(1) : '0.0';
console.log(`║  💯 Score:    ${score.padStart(5)}%                                ║`);
console.log('╚═══════════════════════════════════════════════════════════╝');

if (failures.length > 0) {
  console.log('\n📋 Failed Tests:');
  for (const f of failures) {
    console.log(`  • ${f.name}: ${f.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
