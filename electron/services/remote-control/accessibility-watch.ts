/**
 * When Accessibility is asked again without the person pressing Check again
 * (worksuite-desktop#147): WorkSuite becoming the active app — typically on the
 * way back from System Settings — or one of its windows taking focus. Each
 * time is a fresh check of the app and its helper, and every window is told
 * the outcome, so an open Settings screen updates by itself.
 */

/** Passed to the new process by Restart WorkSuite, so a check after it knows a restart has already been tried. */
export const AX_RESTARTED_ARG = '--ax-restarted';

export interface WatchedApp {
  on(event: 'did-become-active' | 'browser-window-focus', listener: () => void): unknown;
}

export interface WatchDeps {
  app: WatchedApp;
  platform: string;
  recheck: () => Promise<unknown>;
  changed: () => void;
}

export function watchAccessibility(deps: WatchDeps): () => Promise<void> {
  let running: Promise<void> | null = null;
  // Activation and window focus arrive together: one check answers both.
  const check = (): Promise<void> => {
    if (running) return running;
    running = deps.recheck().then(() => deps.changed(), () => deps.changed()).finally(() => { running = null; });
    return running;
  };
  if (deps.platform === 'darwin') {
    deps.app.on('did-become-active', () => void check());
    deps.app.on('browser-window-focus', () => void check());
  }
  return check;
}

export interface RestartDeps {
  /** Ends control and sharing, which ends the input helper. */
  stopControl: () => Promise<void>;
  /** Ends helper processes started only to answer a check. */
  stopProbes: () => void;
  relaunch: (safeMode: boolean, extraArgs: string[]) => void;
}

/** Restart WorkSuite: the helper goes with the app, and both start again as new processes macOS checks afresh. */
export async function restartForAccessibility(deps: RestartDeps): Promise<void> {
  try {
    await deps.stopControl();
  } catch {
    /* Quitting ends the helper's pipe anyway. */
  }
  deps.stopProbes();
  deps.relaunch(false, [AX_RESTARTED_ARG]);
}
