import { BrowserWindow, screen, type Display, type Rectangle } from 'electron';
import { windowRoute, type WindowManager } from '../windows/manager';

/**
 * POS's customer display: a second window of the app, on the till's second monitor, showing the cart as the cashier
 * rings it up, the total, what was paid and the change (`/pos/display`, src/modules/pos/CustomerDisplay.tsx).
 *
 * It is an ordinary window of the shell (the window manager's, sandboxed, with the same preload and no more), so it
 * needs no channel of its own: the register tells it what to show over a same-origin BroadcastChannel, and it reads
 * nothing else. Placed full screen on a display other than the primary one; with one monitor it opens as a window
 * the cashier can move.
 */
export const DISPLAY_ROUTE = '/pos/display';

/** The monitor the customer faces: any display but the primary one, the largest first. */
export function pickDisplay<D extends { id: number; bounds: Rectangle }>(displays: D[], primaryId: number): D | null {
  return [...displays].filter((d) => d.id !== primaryId).sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)[0] ?? null;
}

function current(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && windowRoute(w.webContents.getURL()) === DISPLAY_ROUTE) ?? null;
}

export function openDisplay(windows: Pick<WindowManager, 'open'>): { opened: boolean; secondary: boolean } {
  const primary = screen.getPrimaryDisplay();
  const target: Display | null = pickDisplay(screen.getAllDisplays(), primary.id);
  const have = current();
  if (have) {
    have.show();
    return { opened: true, secondary: !!target };
  }
  const win = windows.open('record', DISPLAY_ROUTE, 'Customer display', false, target ? { bounds: target.workArea } : undefined);
  if (target) {
    win.setBounds(target.workArea);
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.setFullScreen(true);
    });
  }
  return { opened: true, secondary: !!target };
}

export function closeDisplay(): boolean {
  const w = current();
  if (!w) return false;
  w.close();
  return true;
}
