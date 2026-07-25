import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface OmniRouteResponse {
  text: string;
  source: 'omniroute' | 'ollama' | 'python-bridge' | 'local-command';
  model?: string;
  confidence: number;
  timestamp: number;
}

export interface CommandResult {
  handled: boolean;
  response?: string;
  action?: string;
  model?: string;
}

const LOCAL_COMMANDS: Array<{
  patterns: RegExp[];
  handler: (match: RegExpMatchArray) => Promise<string>;
}> = [
  {
    patterns: [/^(what time|time is it|current time)/i],
    handler: async () => {
      const now = new Date();
      return `The current time is ${now.toLocaleTimeString()} on ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
    },
  },
  {
    patterns: [/^(what date|today's date|date today)/i],
    handler: async () => {
      const now = new Date();
      return `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
    },
  },
  {
    patterns: [/^(open|launch|start)\s+(.+)/i],
    handler: async (match) => {
      const app = match[2].trim();
      try {
        const platform = process.platform;
        if (platform === 'darwin') {
          await execAsync(`open -a "${app}"`);
        } else if (platform === 'win32') {
          await execAsync(`start "" "${app}"`);
        } else {
          await execAsync(`xdg-open "${app}"`);
        }
        return `Opening ${app}.`;
      } catch {
        return `I couldn't find an application called "${app}". Please check the name and try again.`;
      }
    },
  },
  {
    patterns: [/^(lock screen|lock my computer|lock pc)/i],
    handler: async () => {
      try {
        const platform = process.platform;
        if (platform === 'darwin') {
          await execAsync(
            '/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend'
          );
        } else if (platform === 'win32') {
          await execAsync('rundll32.exe user32.dll,LockWorkStation');
        } else {
          await execAsync('gnome-screensaver-command -l');
        }
        return 'Screen locked.';
      } catch {
        return 'Unable to lock the screen.';
      }
    },
  },
  {
    patterns: [/^(volume up|louder|increase volume)/i],
    handler: async () => {
      try {
        if (process.platform === 'darwin') {
          await execAsync(
            'osascript -e "set volume output volume (output volume of (get volume settings) + 10)"'
          );
        }
        return 'Volume increased.';
      } catch {
        return 'Could not adjust volume.';
      }
    },
  },
  {
    patterns: [/^(volume down|quieter|decrease volume)/i],
    handler: async () => {
      try {
        if (process.platform === 'darwin') {
          await execAsync(
            'osascript -e "set volume output volume (output volume of (get volume settings) - 10)"'
          );
        }
        return 'Volume decreased.';
      } catch {
        return 'Could not adjust volume.';
      }
    },
  },
  {
    patterns: [/^(mute|unmute|toggle mute)/i],
    handler: async () => {
      try {
        if (process.platform === 'darwin') {
          await execAsync(
            'osascript -e "set volume output muted not (output muted of (get volume settings))"'
          );
        }
        return 'Audio toggled.';
      } catch {
        return 'Could not toggle audio.';
      }
    },
  },
  {
    patterns: [/^(sleep|suspend)/i],
    handler: async () => {
      try {
        if (process.platform === 'darwin') {
          await execAsync('pmset sleepnow');
        } else if (process.platform === 'win32') {
          await execAsync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
        } else {
          await execAsync('systemctl suspend');
        }
        return 'Computer going to sleep.';
      } catch {
        return 'Could not put computer to sleep.';
      }
    },
  },
  {
    patterns: [/^(restart|reboot)/i],
    handler: async () => {
      try {
        if (process.platform === 'darwin') {
          await execAsync('osascript -e "tell application \\"System Events\\" to restart"');
        } else if (process.platform === 'win32') {
          await execAsync('shutdown /r /t 0');
        } else {
          await execAsync('systemctl reboot');
        }
        return 'Restarting computer.';
      } catch {
        return 'Could not restart computer.';
      }
    },
  },
  {
    patterns: [/^(shutdown|shut down|power off)/i],
    handler: async () => {
      try {
        if (process.platform === 'darwin') {
          await execAsync('osascript -e "tell application \\"System Events\\" to shut down"');
        } else if (process.platform === 'win32') {
          await execAsync('shutdown /s /t 0');
        } else {
          await execAsync('systemctl poweroff');
        }
        return 'Shutting down computer.';
      } catch {
        return 'Could not shut down computer.';
      }
    },
  },
  {
    patterns: [/^(screenshot|take screenshot|capture screen)/i],
    handler: async () => {
      try {
        const ts = Date.now();
        const outPath = `/tmp/ghostforge-screenshot-${ts}.png`;
        if (process.platform === 'darwin') {
          await execAsync(`screencapture -x "${outPath}"`);
        }
        return `Screenshot saved to ${outPath}`;
      } catch {
        return 'Could not take screenshot.';
      }
    },
  },
  {
    patterns: [/^(help|what can you do|capabilities|commands)/i],
    handler: async () => {
      return [
        'Here are some things I can do:',
        '',
        '🗣 Voice & Input',
        '  - "Hey JARVIS" wake word activation',
        '  - Voice commands and text input',
        '',
        '💻 System Control',
        '  - Open/launch any application',
        '  - Volume control (up, down, mute)',
        '  - Lock screen, sleep, restart, shutdown',
        '  - Take screenshots',
        '',
        '⏰ Utilities',
        '  - Current time and date',
        '  - Set reminders and alarms',
        '',
        '🌐 Connected Features',
        '  - Screen capture and analysis',
        '  - Web search and browsing',
        '  - YouTube playback and search',
        '  - File processing and summarization',
        '  - Hardware monitoring',
        '  - Game library management',
        '  - Clipboard intelligence',
        '',
        'Say "help" anytime to see this message again.',
      ].join('\n');
    },
  },
];

async function tryLocalCommand(text: string): Promise<CommandResult> {
  for (const cmd of LOCAL_COMMANDS) {
    for (const pattern of cmd.patterns) {
      const match = text.match(pattern);
      if (match) {
        const response = await cmd.handler(match);
        return { handled: true, response, action: 'local-command' };
      }
    }
  }
  return { handled: false };
}

async function tryOllama(
  text: string,
  ollamaUrl: string,
  model: string
): Promise<CommandResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: text,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: 1024,
        },
      }),
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json() as { response: string; model: string };
      return {
        handled: true,
        response: data.response,
        action: 'ollama',
        model: data.model,
      };
    }
  } catch { /* Ollama not available */ }
  return { handled: false };
}

async function tryPythonBridge(text: string): Promise<CommandResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch('http://localhost:8765/api/chat', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, mode: 'omniroute' }),
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json() as { response: string };
      return { handled: true, response: data.response, action: 'python-bridge' };
    }
  } catch { /* Python bridge not available */ }
  return { handled: false };
}

export async function processCommand(
  text: string,
  config?: { ollamaUrl?: string; ollamaModel?: string }
): Promise<OmniRouteResponse> {
  const ollamaUrl = config?.ollamaUrl || 'http://localhost:11434';
  const model = config?.ollamaModel || 'llama3.2:3b';

  const localResult = await tryLocalCommand(text);
  if (localResult.handled) {
    return {
      text: localResult.response || '',
      source: 'local-command',
      confidence: 1.0,
      timestamp: Date.now(),
    };
  }

  const bridgeResult = await tryPythonBridge(text);
  if (bridgeResult.handled) {
    return {
      text: bridgeResult.response || '',
      source: 'python-bridge',
      confidence: 0.8,
      timestamp: Date.now(),
    };
  }

  const ollamaResult = await tryOllama(text, ollamaUrl, model);
  if (ollamaResult.handled) {
    return {
      text: ollamaResult.response || '',
      source: 'ollama',
      model: ollamaResult.model,
      confidence: 0.7,
      timestamp: Date.now(),
    };
  }

  return {
    text: 'I\'m currently operating in offline mode with limited capabilities. For the full JARVIS experience, please connect to your GhostForge server or ensure Ollama is running locally.',
    source: 'omniroute',
    confidence: 0.3,
    timestamp: Date.now(),
  };
}

export async function checkOllamaStatus(
  ollamaUrl: string = 'http://localhost:11434'
): Promise<{ available: boolean; models: string[] }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json() as { models?: Array<{ name: string }> };
      return {
        available: true,
        models: data.models?.map((m) => m.name) || [],
      };
    }
  } catch { /* not available */ }
  return { available: false, models: [] };
}

export async function checkPythonBridgeStatus(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch('http://localhost:8765/health', { signal: controller.signal });
    clearTimeout(timeout);
    return resp.ok;
  } catch {
    return false;
  }
}
