export const HEADLESS_SMOKE_ENV = 'GHOSTFORGE_ELECTRON_HEADLESS_SMOKE';
export const HEADLESS_SMOKE_ARG = '--ghostforge-headless-smoke';
export const HEADLESS_STARTUP_LOG = '[ghostforge:smoke] startup-ready';
export const HEADLESS_WINDOW_LOG = '[ghostforge:smoke] browser-window-ready';
export const HEADLESS_BRIDGE_LOG = '[ghostforge:smoke] bridge-reachable';

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
