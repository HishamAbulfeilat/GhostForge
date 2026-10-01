import { clipboard, BrowserWindow } from 'electron';
import { EventEmitter } from 'events';

/** Actions that can be applied to clipboard content */
export type ClipboardAction = 'translate' | 'summarize' | 'explain' | 'fix' | 'improve';

/** A single clipboard history entry */
export interface ClipboardEntry {
  text: string;
  timestamp: number;
  /** The action applied, if any */
  action?: ClipboardAction;
  /** Result after applying an action */
  result?: string;
}

/** Result from an LLM analysis */
export interface ClipboardAnalysis {
  original: string;
  action: ClipboardAction;
  result: string;
  model: string;
  timestamp: number;
}

const MAX_HISTORY = 50;
const DEFAULT_POLL_MS = 1000;

// ── State ───────────────────────────────────────────────────────────────────

let watcherInterval: ReturnType<typeof setInterval> | null = null;
let lastClipboardText = '';
const history: ClipboardEntry[] = [];
const emitter = new EventEmitter();

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start polling the system clipboard for changes.
 * Emits `'clipboard-change'` with the new text whenever the content changes.
 */
export function startClipboardWatcher(intervalMs: number = DEFAULT_POLL_MS): void {
  if (watcherInterval) return;

  void (async () => {
    // Seed with current clipboard content so we don't fire on startup
    lastClipboardText = (await clipboard.readText()) || '';
  })();

  watcherInterval = setInterval(() => {
    void (async () => {
      const current = (await clipboard.readText()) || '';
      if (current && current !== lastClipboardText) {
        lastClipboardText = current;
        addEntry(current);
        emitter.emit('clipboard-change', current);

        // Notify renderer
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('clipboard:change', current);
        });
      }
    })();
  }, intervalMs);
}

/**
 * Stop watching the clipboard.
 */
export function stopClipboardWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
}

/**
 * Send text to the LLM for analysis and return the result.
 */
export async function analyzeClipboard(
  text: string,
  action: ClipboardAction = 'explain',
): Promise<ClipboardAnalysis> {
  const prompt = buildPrompt(text, action);

  // Try Ollama first (standard JARVIS backend)
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:3b',
        prompt,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      const data: any = await response.json();
      const result = data.response || '';

      updateHistoryEntry(text, action, result);

      return {
        original: text,
        action,
        result,
        model: 'llama3.2:3b',
        timestamp: Date.now(),
      };
    }
  } catch {}

  // Fallback: simple heuristic response
  const fallback = generateFallback(text, action);

  updateHistoryEntry(text, action, fallback);

  return {
    original: text,
    action,
    result: fallback,
    model: 'fallback',
    timestamp: Date.now(),
  };
}

/**
 * Retrieve the full clipboard history (most recent first).
 */
export function getClipboardHistory(): ClipboardEntry[] {
  return [...history].reverse();
}

/**
 * Read the current clipboard, apply the requested action, and return the result.
 */
export async function smartPaste(action: ClipboardAction): Promise<ClipboardAnalysis> {
  const text = (await clipboard.readText()) || '';
  if (!text.trim()) {
    return {
      original: '',
      action,
      result: 'Clipboard is empty.',
      model: 'none',
      timestamp: Date.now(),
    };
  }

  return analyzeClipboard(text, action);
}

/**
 * Subscribe to clipboard change events.
 */
export function onClipboardChange(callback: (text: string) => void): () => void {
  emitter.on('clipboard-change', callback);
  return () => emitter.off('clipboard-change', callback);
}

// ── Internal ────────────────────────────────────────────────────────────────

function addEntry(text: string): void {
  history.push({
    text,
    timestamp: Date.now(),
  });

  // Ring buffer — evict oldest
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

function updateHistoryEntry(text: string, action: ClipboardAction, result: string): void {
  // Find the most recent entry matching this text and augment it
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].text === text) {
      history[i].action = action;
      history[i].result = result;
      return;
    }
  }
}

function buildPrompt(text: string, action: ClipboardAction): string {
  const truncated = text.length > 2000 ? text.slice(0, 2000) + '…' : text;

  switch (action) {
    case 'translate':
      return `Translate the following text to English (if it is in another language, translate it; otherwise return it as-is). Be concise:\n\n${truncated}`;
    case 'summarize':
      return `Summarize the following text in 2-3 sentences:\n\n${truncated}`;
    case 'explain':
      return `Explain the following text in plain English. Be clear and concise:\n\n${truncated}`;
    case 'fix':
      return `Fix any errors in the following code or text. Return only the corrected version, no explanation:\n\n${truncated}`;
    case 'improve':
      return `Improve the writing of the following text for clarity and conciseness. Return only the improved text:\n\n${truncated}`;
    default:
      return truncated;
  }
}

function generateFallback(text: string, action: ClipboardAction): string {
  switch (action) {
    case 'translate':
      return `[Translate] LLM unavailable — original text preserved (${text.length} chars)`;
    case 'summarize':
      return `[Summary] LLM unavailable — text is ${text.length} characters long.`;
    case 'explain':
      return `[Explain] LLM unavailable — text is ${text.length} characters long.`;
    case 'fix':
      return text;
    case 'improve':
      return text;
    default:
      return text;
  }
}
