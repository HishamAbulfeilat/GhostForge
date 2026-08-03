import { exec } from 'child_process';
import type { Browser, Page } from 'playwright';

/**
 * Browser automation module for GhostForge JARVIS.
 * Uses Playwright when available, falls back to shell commands.
 */

export interface BrowserScreenshot {
  path: string;
  width: number;
  height: number;
}

let playwrightBrowser: Browser | null = null;
let playwrightPage: Page | null = null;

/** Lazy-load Playwright — returns null if not installed. */
async function getPlaywright(): Promise<typeof import('playwright') | null> {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

/** Get or launch a Playwright browser instance. */
async function getBrowserPage(): Promise<Page | null> {
  const pw = await getPlaywright();
  if (!pw) return null;

  try {
    if (playwrightBrowser && playwrightPage) {
      return playwrightPage;
    }
    const browser = await pw.chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    playwrightBrowser = browser;
    playwrightPage = page;
    return page;
  } catch {
    return null;
  }
}

function runShell(cmd: string, timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

/** Validate that a URL uses an http(s) scheme before navigation. */
function assertHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL with non-http(s) scheme: ${parsed.protocol}`);
  }
  return url;
}

function platformOpen(url: string): Promise<string> {
  assertHttpUrl(url);
  const platform = process.platform;
  if (platform === 'darwin') return runShell(`open "${url}"`);
  if (platform === 'win32') return runShell(`start "" "${url}"`);
  return runShell(`xdg-open "${url}"`);
}

/** Open a URL in the default browser or Playwright. */
export async function openUrl(url: string): Promise<string> {
  assertHttpUrl(url);
  const page = await getBrowserPage();
  if (page) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return `Opened ${url} in Playwright`;
  }
  await platformOpen(url);
  return `Opened ${url} in default browser`;
}

/** Search the web using Google or DuckDuckGo. */
export async function searchWeb(query: string, engine: 'google' | 'duckduckgo' = 'google'): Promise<string> {
  const encoded = encodeURIComponent(query);
  const url = engine === 'google'
    ? `https://www.google.com/search?q=${encoded}`
    : `https://duckduckgo.com/?q=${encoded}`;
  return openUrl(url);
}

/** Navigate the current tab to a new URL. */
export async function navigateTab(url: string): Promise<string> {
  assertHttpUrl(url);
  const page = await getBrowserPage();
  if (page) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return `Navigated to ${url}`;
  }
  return openUrl(url);
}

/** Type text into the currently focused element. */
export async function typeText(text: string): Promise<string> {
  const page = await getBrowserPage();
  if (page) {
    await page.keyboard.type(text, { delay: 30 });
    return `Typed: "${text.slice(0, 60)}"`;
  }
  // Fallback: use xdotool on Linux, osascript keystroke on macOS
  const escaped = text.replace(/"/g, '\\"');
  if (process.platform === 'darwin') {
    await runShell(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`);
  } else {
    await runShell(`xdotool type --delay 30 "${escaped}"`);
  }
  return `Typed: "${text.slice(0, 60)}"`;
}

/** Click an element by CSS selector. */
export async function clickElement(selector: string): Promise<string> {
  const page = await getBrowserPage();
  if (page) {
    await page.click(selector, { timeout: 5000 });
    return `Clicked element: ${selector}`;
  }
  throw new Error('Playwright not available — cannot click by selector');
}

/** Navigate back in the browser history. */
export async function goBack(): Promise<string> {
  const page = await getBrowserPage();
  if (page) {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
    return 'Navigated back';
  }
  if (process.platform === 'darwin') {
    await runShell('osascript -e \'tell application "System Events" to keystroke "[" using command down\'');
    return 'Navigated back (shell fallback)';
  }
  throw new Error('Playwright not available — install with: npm i playwright');
}

/** Navigate forward in the browser history. */
export async function goForward(): Promise<string> {
  const page = await getBrowserPage();
  if (page) {
    await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 });
    return 'Navigated forward';
  }
  if (process.platform === 'darwin') {
    await runShell('osascript -e \'tell application "System Events" to keystroke "]" using command down\'');
    return 'Navigated forward (shell fallback)';
  }
  throw new Error('Playwright not available — install with: npm i playwright');
}

/** Scroll the page up or down. */
export async function scrollPage(direction: 'up' | 'down' | 'left' | 'right', amount = 500): Promise<string> {
  const page = await getBrowserPage();
  if (page) {
    const scrollMap: Record<string, { x: number; y: number }> = {
      up: { x: 0, y: -amount },
      down: { x: 0, y: amount },
      left: { x: -amount, y: 0 },
      right: { x: amount, y: 0 },
    };
    const delta = scrollMap[direction] || scrollMap.down;
    await page.mouse.wheel(delta.x, delta.y);
    return `Scrolled ${direction} ${amount}px`;
  }
  if (process.platform === 'darwin') {
    const dir = (direction === 'up' || direction === 'left') ? 'up' : 'down';
    const script = `tell application "System Events" to scroll ${dir} 5`;
    await runShell(`osascript -e '${script}'`);
    return `Scrolled ${direction} (shell fallback)`;
  }
  throw new Error('Playwright not available');
}

/** Take a screenshot of the current page. */
export async function takeScreenshot(filePath?: string): Promise<BrowserScreenshot> {
  const page = await getBrowserPage();
  const outPath = filePath || `/tmp/browser-screenshot-${Date.now()}.png`;

  if (page) {
    const buf = await page.screenshot({ path: outPath, fullPage: false });
    const size = page.viewportSize() || { width: 1280, height: 720 };
    return { path: outPath, width: size.width, height: size.height };
  }

  // Fallback: OS-level screenshot
  if (process.platform === 'darwin') {
    await runShell(`screencapture -x "${outPath}"`);
  } else {
    await runShell(`gnome-screenshot -f "${outPath}"`);
  }
  return { path: outPath, width: 0, height: 0 };
}

/** Extract the text content of the current page. */
export async function getPageText(): Promise<string> {
  const page = await getBrowserPage();
  if (page) {
    const text = await page.evaluate(() => (globalThis as any).document?.body?.innerText || '');
    return text.slice(0, 10000);
  }
  throw new Error('Playwright not available — cannot extract page text');
}

/** Clean up Playwright resources. */
export async function closeBrowser(): Promise<void> {
  if (playwrightBrowser) {
    await playwrightBrowser.close().catch(() => {});
    playwrightBrowser = null;
    playwrightPage = null;
  }
}
