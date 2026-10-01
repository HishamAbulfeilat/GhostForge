export interface CleanupTask {
  name: string;
  run: () => void | Promise<void>;
}

export interface CleanupResult {
  completed: string[];
  failed: Array<{ name: string; error: unknown }>;
  timedOut: boolean;
}

export function createQuitController() {
  let explicitQuitRequested = false;
  let cleanupState: 'idle' | 'running' | 'complete' = 'idle';

  return {
    requestExplicitQuit(): boolean {
      if (explicitQuitRequested) return false;
      explicitQuitRequested = true;
      return true;
    },
    beginCleanup(): boolean {
      if (cleanupState !== 'idle') return false;
      cleanupState = 'running';
      return true;
    },
    finishCleanup(): void {
      cleanupState = 'complete';
    },
    isShutdownStarted(): boolean {
      return cleanupState !== 'idle';
    },
    isCleanupComplete(): boolean {
      return cleanupState === 'complete';
    },
    isExplicitQuitRequested(): boolean {
      return explicitQuitRequested;
    },
    shouldMinimizeOnWindowClose(minimizeToTray: boolean): boolean {
      return Boolean(minimizeToTray) && cleanupState === 'idle' && !explicitQuitRequested;
    },
  };
}

export async function runCleanupTasks(
  tasks: CleanupTask[],
  timeoutMs: number,
): Promise<CleanupResult> {
  const result: CleanupResult = { completed: [], failed: [], timedOut: false };
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const cleanup = (async () => {
    for (const task of tasks) {
      try {
        await task.run();
        result.completed.push(task.name);
      } catch (error) {
        result.failed.push({ name: task.name, error });
      }
    }
  })();

  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(() => {
      result.timedOut = true;
      resolve();
    }, timeoutMs);
  });

  await Promise.race([cleanup, deadline]);
  if (timeout) clearTimeout(timeout);
  return result;
}

export const quitController = createQuitController();

export function requestExplicitAppQuit(): boolean {
  return quitController.requestExplicitQuit();
}
