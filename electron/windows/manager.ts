import { app, BrowserWindow, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import type { WindowKind } from '@shared/types';
import type { Database } from '../services/db';
import { APP_ORIGIN, devOrigin } from '../security/hardening';
import { logger } from '../main/log';

const log = logger('windows');

/**
 * DesktopWindowManager (§3.6, FR-NAV-05/06/09, FR-SHL-04/05).
 *
 * Every window is created here with the same hardened preferences; content
 * never opens windows itself. Bounds, display and maximized state are
 * remembered per window kind; a window whose display is gone comes back
 * fully visible on the primary display.
 */
const ALWAYS_ON_TOP_ALLOWED = new Set<WindowKind>(['chat-mini', 'timer', 'call', 'video-call', 'ring']);
/** One call at a time: a second "call" window focuses the one already open. */
const CALL_KINDS = new Set<WindowKind>(['call', 'video-call']);

const SIZES: Record<WindowKind, { width: number; height: number; minWidth: number; minHeight: number }> = {
  main: { width: 1440, height: 900, minWidth: 1024, minHeight: 640 },
  'chat-mini': { width: 380, height: 560, minWidth: 320, minHeight: 360 },
  timer: { width: 340, height: 150, minWidth: 300, minHeight: 130 },
  record: { width: 1100, height: 800, minWidth: 720, minHeight: 520 },
  call: { width: 340, height: 600, minWidth: 320, minHeight: 520 },
  'video-call': { width: 1180, height: 760, minWidth: 720, minHeight: 480 },
  ring: { width: 360, height: 268, minWidth: 360, minHeight: 268 },
  meet: { width: 1280, height: 800, minWidth: 960, minHeight: 600 },
};

interface SavedLayout {
  displayId: string | null;
  bounds: Rectangle;
  maximized: boolean;
}

/** Keeps a rectangle fully visible on some display; falls back to the primary one. */
export function fitToDisplays(bounds: Rectangle, displays: Array<{ id: number; workArea: Rectangle }>, primary: { workArea: Rectangle }): Rectangle {
  const intersects = (a: Rectangle, b: Rectangle) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const host = displays.find((d) => intersects(bounds, d.workArea));
  const area = (host ?? primary).workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  let x = host ? bounds.x : area.x + Math.round((area.width - width) / 2);
  let y = host ? bounds.y : area.y + Math.round((area.height - height) / 2);
  x = Math.min(Math.max(x, area.x), area.x + area.width - width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

export class WindowManager {
  private main: BrowserWindow | null = null;
  private kinds = new Map<number, WindowKind>();
  private saveTimers = new Map<number, NodeJS.Timeout>();
  private stopped = false;
  quitting = false;
  minimizeToTray: () => boolean = () => true;
  onMainShown: () => void = () => undefined;

  constructor(
    private readonly db: Database,
    private readonly preload: string,
  ) {}

  isOurs(id: number): boolean {
    return this.kinds.has(id);
  }

  kindOf(id: number): WindowKind | null {
    return this.kinds.get(id) ?? null;
  }

  getMain(): BrowserWindow | null {
    return this.main && !this.main.isDestroyed() ? this.main : null;
  }

  private loadLayout(kind: WindowKind): SavedLayout | null {
    const row = this.db.get<{ display_id: string | null; bounds: string; maximized: number }>('SELECT display_id, bounds, maximized FROM window_layouts WHERE kind = ?', kind);
    if (!row) return null;
    try {
      return { displayId: row.display_id, bounds: JSON.parse(row.bounds) as Rectangle, maximized: row.maximized === 1 };
    } catch {
      return null;
    }
  }

  /**
   * On the way out: every open window's place is saved now, while the local
   * database is still open, and nothing is saved after (a window closing
   * during quit would otherwise write to a closed database).
   */
  saveAllAndStop(): void {
    for (const t of this.saveTimers.values()) clearTimeout(t);
    this.saveTimers.clear();
    for (const win of BrowserWindow.getAllWindows()) {
      const kind = this.kinds.get(win.id);
      if (kind && kind !== 'ring') {
        try {
          this.saveLayout(win, kind);
        } catch {
          /* a window's place is a convenience */
        }
      }
    }
    this.stopped = true;
  }

  private saveLayout(win: BrowserWindow, kind: WindowKind): void {
    if (this.stopped || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    this.db.run(
      'INSERT INTO window_layouts (kind, display_id, bounds, maximized, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind) DO UPDATE SET display_id = excluded.display_id, bounds = excluded.bounds, maximized = excluded.maximized, updated_at = excluded.updated_at',
      kind,
      String(display.id),
      JSON.stringify(bounds),
      win.isMaximized() ? 1 : 0,
      new Date().toISOString(),
    );
  }

  private scheduleSave(win: BrowserWindow, kind: WindowKind): void {
    if (this.stopped) return;
    const prev = this.saveTimers.get(win.id);
    if (prev) clearTimeout(prev);
    this.saveTimers.set(
      win.id,
      setTimeout(() => this.saveLayout(win, kind), 600),
    );
  }

  private url(hash: string): string {
    const dev = devOrigin();
    const base = dev ? `${process.env.ELECTRON_RENDERER_URL}` : `${APP_ORIGIN}/index.html`;
    return hash ? `${base}#${hash}` : base;
  }

  private create(kind: WindowKind, opts: { hash: string; title?: string; alwaysOnTop?: boolean; show?: boolean }): BrowserWindow {
    const size = SIZES[kind];
    // An incoming call always appears in the same place: top right of the
    // screen the pointer is on, clear of the menu bar.
    const ring = kind === 'ring';
    const saved = ring ? null : this.loadLayout(kind);
    const primary = ring ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : screen.getPrimaryDisplay();
    const initial: Rectangle = saved?.bounds ?? {
      x: ring ? primary.workArea.x + primary.workArea.width - size.width - 20 : primary.workArea.x + Math.round((primary.workArea.width - size.width) / 2),
      y: ring ? primary.workArea.y + 16 : primary.workArea.y + Math.round((primary.workArea.height - size.height) / 2),
      width: size.width,
      height: size.height,
    };
    const bounds = fitToDisplays(initial, screen.getAllDisplays(), primary);
    const mac = process.platform === 'darwin';
    const win = new BrowserWindow({
      ...bounds,
      minWidth: size.minWidth,
      minHeight: size.minHeight,
      show: false,
      title: opts.title ?? 'WorkSuite',
      backgroundColor: '#0F1B3D',
      // FR-SHL-05: native traffic lights on macOS; our own title bar elsewhere,
      // with the OS window controls drawn over it (snap layouts keep working).
      titleBarStyle: 'hidden',
      // A ring has no window controls at all: it is answered or declined.
      ...(mac ? { trafficLightPosition: { x: 18, y: 18 } } : { titleBarOverlay: ring ? false : { color: '#0F1B3D', symbolColor: '#FFFFFF', height: kind === 'main' ? 52 : 40 } }),
      alwaysOnTop: !!opts.alwaysOnTop && ALWAYS_ON_TOP_ALLOWED.has(kind),
      ...(ring ? { resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true } : {}),
      icon: mac ? undefined : join(app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources'), 'icons', '256x256.png'),
      webPreferences: {
        preload: this.preload,
        nodeIntegration: false, // FR-SHL-04: never true
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
        webviewTag: false,
        navigateOnDragDrop: false,
        devTools: !app.isPackaged || process.argv.includes('--diagnostics-devtools'),
      },
    });
    if (ring && mac) win.setWindowButtonVisibility(false);
    this.kinds.set(win.id, kind);
    const id = win.id;
    win.on('closed', () => {
      this.kinds.delete(id);
      const t = this.saveTimers.get(id);
      if (t) clearTimeout(t);
      this.saveTimers.delete(id);
    });
    if (!ring) {
      win.on('resize', () => this.scheduleSave(win, kind));
      win.on('move', () => this.scheduleSave(win, kind));
    }
    if (saved?.maximized && kind === 'main') win.maximize();
    win.once('ready-to-show', () => {
      if (opts.show === false) return;
      // A ring must not take the keyboard from whatever the person is typing in.
      if (ring) {
        win.setAlwaysOnTop(true, 'pop-up-menu');
        win.showInactive();
      } else win.show();
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      log.error('renderer gone', { kind, reason: details.reason, exitCode: details.exitCode });
      if (details.reason !== 'clean-exit' && !win.isDestroyed()) {
        // The shell stays up: reload the window rather than losing the app.
        setTimeout(() => !win.isDestroyed() && win.reload(), 1000);
      }
    });
    win.webContents.on('unresponsive', () => log.warn('window unresponsive', { kind }));
    void win.loadURL(this.url(opts.hash));
    return win;
  }

  createMain(show: boolean): BrowserWindow {
    const existing = this.getMain();
    if (existing) return existing;
    const win = this.create('main', { hash: '', show });
    this.main = win;
    win.on('close', (e) => {
      this.saveLayout(win, 'main');
      // FR-TRAY-02: closing minimizes to the tray unless the user chose Exit.
      if (!this.quitting && this.minimizeToTray()) {
        e.preventDefault();
        win.hide();
        if (process.platform === 'darwin') app.dock?.hide();
      }
    });
    win.on('closed', () => {
      if (this.main === win) this.main = null;
    });
    win.on('show', () => this.onMainShown());
    return win;
  }

  showMain(): BrowserWindow {
    const win = this.getMain() ?? this.createMain(true);
    if (process.platform === 'darwin') void app.dock?.show();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }

  open(kind: Exclude<WindowKind, 'main'>, route: string, title?: string, alwaysOnTop?: boolean): BrowserWindow {
    const hash = `/window/${kind}?route=${encodeURIComponent(route)}`;
    for (const w of BrowserWindow.getAllWindows()) {
      const k = this.kinds.get(w.id);
      // One mini chat per conversation, one Meet per meeting, one call at a
      // time: focus the one already open.
      if ((k === kind && w.webContents.getURL().endsWith(hash)) || (k && CALL_KINDS.has(k) && CALL_KINDS.has(kind))) {
        w.show();
        w.focus();
        return w;
      }
      // A newer ring replaces an older one.
      if (k === 'ring' && kind === 'ring') w.close();
    }
    return this.create(kind, { hash, title, alwaysOnTop: alwaysOnTop ?? (kind !== 'record' && kind !== 'meet') });
  }

  setAlwaysOnTop(win: BrowserWindow, value: boolean): boolean {
    const kind = this.kinds.get(win.id);
    if (!kind || !ALWAYS_ON_TOP_ALLOWED.has(kind)) return false;
    win.setAlwaysOnTop(value, 'floating');
    return value;
  }

  all(): BrowserWindow[] {
    return BrowserWindow.getAllWindows().filter((w) => this.kinds.has(w.id) && !w.isDestroyed());
  }

  /** Displays changed (monitor unplugged): pull every window back into view. */
  refit(): void {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    for (const w of this.all()) {
      if (w.isMaximized() || w.isFullScreen()) continue;
      const b = w.getBounds();
      const fitted = fitToDisplays(b, displays, primary);
      if (fitted.x !== b.x || fitted.y !== b.y || fitted.width !== b.width || fitted.height !== b.height) w.setBounds(fitted);
    }
  }

  /**
   * Reload every app window. The page's security policy is fixed when it
   * loads, so a newly chosen server's media links (images, voice notes) are
   * only allowed after a reload.
   */
  reloadAll(): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (this.kinds.has(w.id) && !w.isDestroyed()) w.webContents.reload();
    }
  }
}
