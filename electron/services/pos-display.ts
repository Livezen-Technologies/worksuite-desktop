import { BrowserWindow, screen, type Display, type Rectangle } from 'electron';
import { windowRoute, type WindowManager } from '../windows/manager';

/**
 * POS's customer display: a second window of the app, on the till's second monitor, showing the cart as the cashier
 * rings it up, the total, what was paid and the change (`/pos/display`, src/modules/pos/CustomerDisplay.tsx).
 *
 * It is an ordinary window of the shell (the window manager's, sandboxed, with the same preload and no more): the
 * register tells it what to show over a same-origin BroadcastChannel. Its one channel (#294) is `pos:displayMedia` —
 * the promotions and the logo this till keeps, and whether its screen takes touch — answered to this window alone. Placed full screen on a display other than the primary one; with one monitor it opens as a window
 * the cashier can move.
 */
export const DISPLAY_ROUTE = '/pos/display';

/** The monitor the customer faces: any display but the primary one, the largest first. */
export function pickDisplay<D extends { id: number; bounds: Rectangle }>(displays: D[], primaryId: number): D | null {
  return [...displays].filter((d) => d.id !== primaryId).sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)[0] ?? null;
}

/**
 * Whether the customer takes the display by touch (worksuite-desktop#294): the till's setting, else what the system says
 * of the monitor (`touchSupport`). The system often cannot tell (`unknown`, most of macOS and Linux): that is no touch,
 * and the till's setting says "yes" where the screen does take it. Without touch the display offers no phone entry.
 */
export function touchOf(setting: 'auto' | 'yes' | 'no' | undefined, support: Display['touchSupport'] | undefined): boolean {
  if (setting === 'yes') return true;
  if (setting === 'no') return false;
  return support === 'available';
}

/** The customer display's window, when it is open: what the IPC door checks a caller against. */
export function isDisplayWindow(sender: { getURL(): string }): boolean {
  try {
    return windowRoute(sender.getURL()) === DISPLAY_ROUTE;
  } catch {
    return false;
  }
}

/** Whether the monitor the customer display is on takes touch, as the system tells it. */
export function displayTouchSupport(): Display['touchSupport'] | undefined {
  const w = current();
  if (!w) return pickDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay().id)?.touchSupport;
  return screen.getDisplayMatching(w.getBounds()).touchSupport;
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
