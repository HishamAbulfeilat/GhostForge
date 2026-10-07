export const APP_NAME = 'GhostForge JARVIS';
export const APP_VERSION = '5.3.2';

export const DEFAULT_CONFIG = {
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b',
  visionModel: 'moondream',
  voiceEngine: 'browser' as const,
  wakeWord: 'hey jarvis',
  language: 'en-US',
  autoStart: false,
  minimizeToTray: true,
};

export const GEMINI_LIVE_MODEL = 'gemini-2.0-flash-live-001';

export const SCREEN_CAPTURE = {
  defaultFormat: 'jpeg' as const,
  defaultQuality: 70,
  maxQuality: 100,
  captureDir: 'ghostforge-screenshots',
};

export const CURSOR_OVERLAY = {
  size: 16,
  dotSize: 8,
  ringScale: 1.5,
  pulseScale: 2.5,
  animationDuration: 400,
  defaultDismissMs: 5000,
  color: '#3b82f6',
  colorRgba: 'rgba(59,130,246,',
};

export const VOICE = {
  pushToTalkModifiers: ['Control', 'Alt'], // Ctrl+Option on macOS
  pushToTalkKey: 'KeyV',
  maxRecordingMs: 30000,
  silenceDetectionMs: 2000,
};

export const MEMORY = {
  maxEntries: 1000,
  sessionSummaryThreshold: 10, // messages before summarizing
  defaultTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export const N8N = {
  defaultUrl: 'http://localhost:5678',
  webhookBase: '/webhook/ghostforge',
};

export const PLATFORM_COMMANDS: Record<string, {
  screenshot: string;
  openApp: string;
  lockScreen: string;
  volumeUp: string;
  volumeDown: string;
  mute: string;
}> = {
  darwin: {
    screenshot: 'screencapture -x -t jpeg',
    openApp: 'open -a',
    lockScreen: 'pmset displaysleepnow',
    volumeUp: 'osascript -e "set volume output volume (output volume of (get volume settings) + 10)"',
    volumeDown: 'osascript -e "set volume output volume (output volume of (get volume settings) - 10)"',
    mute: 'osascript -e "set volume output muted not (output muted of (get volume settings))"',
  },
  win32: {
    screenshot: 'nircmd.exe savescreenshot',
    openApp: 'start',
    lockScreen: 'rundll32.exe user32.dll,LockWorkStation',
    volumeUp: 'nircmd.exe mutesysvolume 0 && nircmd.exe setsysvolume 65535',
    volumeDown: 'nircmd.exe setsysvolume 32768',
    mute: 'nircmd.exe mutesysvolume 2',
  },
  linux: {
    screenshot: 'gnome-screenshot -f',
    openApp: 'xdg-open',
    lockScreen: 'gnome-screensaver-command -l',
    volumeUp: 'amixer set Master 10%+',
    volumeDown: 'amixer set Master 10%-',
    mute: 'amixer set Master toggle',
  },
};
