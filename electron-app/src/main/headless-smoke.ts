export const HEADLESS_SMOKE_ENV = 'GHOSTFORGE_ELECTRON_HEADLESS_SMOKE';
export const HEADLESS_SMOKE_ARG = '--ghostforge-headless-smoke';
export const HEADLESS_STARTUP_LOG = '[ghostforge:smoke] startup-ready';
export const HEADLESS_WINDOW_LOG = '[ghostforge:smoke] browser-window-ready';
export const HEADLESS_BRIDGE_LOG = '[ghostforge:smoke] bridge-reachable';
export const HEADLESS_CLEAN_LOG = '[ghostforge:smoke] shutdown-clean';
export const HEADLESS_CLEANUP_FAILED_LOG = '[ghostforge:smoke] shutdown-failed';

export interface CleanupTask {
  name: string;
  run: () => void | Promise<void>;
}

export function shouldMinimizeWindowToTray(isQuitting: boolean, minimizeToTray: boolean): boolean {
  return !isQuitting && minimizeToTray;
}

export async function runBoundedCleanup(tasks: readonly CleanupTask[], timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid cleanup timeout: ${timeoutMs}`);
  }

  const completed = new Set<string>();
  const cleanup = Promise.all(tasks.map(async ({ name, run }) => {
    try {
      await run();
      completed.add(name);
      return null;
    } catch (error) {
      completed.add(name);
      return `${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }));

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const pending = tasks.map(({ name }) => name).filter((name) => !completed.has(name));
      reject(new Error(`Cleanup timed out after ${timeoutMs}ms${pending.length ? `; pending: ${pending.join(', ')}` : ''}`));
    }, timeoutMs);
  });

  try {
    const failures = await Promise.race([cleanup, timeout]);
    const errors = failures.filter((failure): failure is string => failure !== null);
    if (errors.length > 0) {
      throw new Error(`Cleanup failed: ${errors.join('; ')}`);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isHeadlessSmokeMode(
  args: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[HEADLESS_SMOKE_ENV] === '1' || env[HEADLESS_SMOKE_ENV] === 'true' || args.includes(HEADLESS_SMOKE_ARG);
}

export function getHeadlessSwitches(): string[] {
  return [
    'headless',
    'disable-gpu',
    'disable-software-rasterizer',
    'no-sandbox',
    'disable-dev-shm-usage',
    'disable-renderer-backgrounding',
  ];
}

export function logHeadlessSmoke(message: string): void {
  console.log(message);
}
