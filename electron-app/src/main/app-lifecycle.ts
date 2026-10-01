export function createQuitController() {
  let explicitQuitRequested = false;
  let shutdownStarted = false;

  return {
    requestExplicitQuit(): boolean {
      if (shutdownStarted) return false;
      explicitQuitRequested = true;
      shutdownStarted = true;
      return true;
    },
    markShutdownStarted(): void {
      shutdownStarted = true;
    },
    isShutdownStarted(): boolean {
      return shutdownStarted;
    },
    isExplicitQuitRequested(): boolean {
      return explicitQuitRequested;
    },
    shouldMinimizeOnWindowClose(minimizeToTray: boolean): boolean {
      return Boolean(minimizeToTray) && !shutdownStarted && !explicitQuitRequested;
    },
  };
}

export const quitController = createQuitController();

export function requestExplicitAppQuit(): boolean {
  return quitController.requestExplicitQuit();
}
