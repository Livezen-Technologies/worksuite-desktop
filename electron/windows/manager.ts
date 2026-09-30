import { app, BrowserWindow, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import type { DetachedWindow, WindowKind } from '@shared/types';
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
const ALWAYS_ON_TOP_ALLOWED = new Set<WindowKind>(['chat-mini', 'timer', 'call', 'video-call', 'ring', 'meet']);
/** Windows that can shrink to float over other apps while a call or meeting goes on. */
const COMPACTABLE = new Set<WindowKind>(['call', 'video-call', 'meet']);
/** One call at a time: a second "call" window focuses the one already open. */
const CALL_KINDS = new Set<WindowKind>(['call', 'video-call']);

const SIZES: Record<WindowKind, { width: number; height: number; minWidth: number; minHeight: number }> = {
  main: { width: 1440, height: 900, minWidth: 1024, minHeight: 640 },
  'chat-mini': { width: 380, height: 560, minWidth: 320, minHeight: 360 },
  timer: { width: 340, height: 150, minWidth: 300, minHeight: 130 },
  record: { width: 1100, height: 800, minWidth: 720, minHeight: 520 },
  call: { width: 340, height: 600, minWidth: 320, minHeight: 520 },
  'video-call': { width: 1180, height: 760, minWidth: 720, minHeight: 480 },
  ring: { width: 360, height: 292, minWidth: 360, minHeight: 292 },
  meet: { width: 1280, height: 800, minWidth: 960, minHeight: 600 },
  'rc-consent': { width: 460, height: 560, minWidth: 460, minHeight: 560 },
  'rc-indicator': { width: 560, height: 52, minWidth: 560, minHeight: 52 },
  'rc-pointer': { width: 220, height: 30, minWidth: 220, minHeight: 30 },
  'webchat-ring': { width: 380, height: 250, minWidth: 380, minHeight: 120 },
  'quick-ask': { width: 600, height: 480, minWidth: 600, minHeight: 480 },
  // WorkSuite Office: one window per document.
  office: { width: 1320, height: 880, minWidth: 900, minHeight: 600 },
};
/** Remote control's own windows: placed by remote control, never remembered. */
const REMOTE = new Set<WindowKind>(['rc-consent', 'rc-indicator', 'rc-pointer', 'webchat-ring', 'quick-ask']);

/** The website-chat call window's place: bottom right of the primary display, clear of the taskbar (RING-40). */
export function ringerBounds(workArea: Rectangle, height: number): Rectangle {
  const width = SIZES['webchat-ring'].width;
  const h = Math.max(SIZES['webchat-ring'].minHeight, Math.min(height, workArea.height - 32));
  return { x: workArea.x + workArea.width - width - 16, y: workArea.y + workArea.height - h - 16, width, height: h };
}

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

/**
 * Where a torn-off tab's window goes (FR-NAV-05/07): under the pointer that
 * let go of the tab, its title bar where the tab was held; without a
 * pointer, a step down and right of the last one, so none hides another.
 * Null leaves the window's own remembered place.
 */
export function detachedBounds(
  at: { x: number; y: number } | null,
  size: { width: number; height: number },
  others: Rectangle[],
  displays: Array<{ id: number; workArea: Rectangle }>,
  primary: { workArea: Rectangle },
): Rectangle | null {
  const last = others[others.length - 1];
  let r: Rectangle;
  if (at) r = { x: at.x - 120, y: at.y - 18, width: size.width, height: size.height };
  else if (last) r = { x: last.x + 28, y: last.y + 28, width: last.width, height: last.height };
  else return null;
  return fitToDisplays(r, displays, primary);
}

export class WindowManager {
  private main: BrowserWindow | null = null;
  private kinds = new Map<number, WindowKind>();
  private saveTimers = new Map<number, NodeJS.Timeout>();
  private stopped = false;
  private compactFrom = new Map<number, { bounds: Rectangle; maximized: boolean; onTop: boolean }>();
  /** Record windows — tabs torn off the main window — and what each shows now. */
  private records = new Map<number, { route: string; title: string }>();
  private recordsTimer: NodeJS.Timeout | null = null;
  quitting = false;
  /** The torn-off windows changed (opened, moved, navigated, closed): remember them for the next start. */
  onRecordsChanged: (windows: DetachedWindow[]) => void = () => undefined;
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
    if (this.recordsTimer) clearTimeout(this.recordsTimer);
    this.recordsTimer = null;
    try {
      this.onRecordsChanged(this.detached());
    } catch {
      /* where torn-off windows were is a convenience too */
    }
    for (const win of BrowserWindow.getAllWindows()) {
      const kind = this.kinds.get(win.id);
      if (kind && kind !== 'ring' && !REMOTE.has(kind)) {
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
    if (this.stopped || win.isDestroyed() || win.isMinimized() || win.isFullScreen() || this.compactFrom.has(win.id)) return;
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

  private webPreferences(): Electron.WebPreferences {
    return {
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
      // Unpackaged test runs only: lets test-only surfaces (the call layout preview) show.
      additionalArguments: !app.isPackaged && process.env.WS_E2E_FAKE_MEDIA ? ['--ws-e2e'] : [],
    };
  }

  /**
   * Remote control's consent prompt (RC03), control bar (RC04) and the
   * controller's name beside the pointer (RC-INP-04): above everything,
   * including full-screen apps, and left out of screen capture so a
   * controller watching the shared screen can neither read nor aim at them.
   * The prompt takes focus; the bar never does; the name tag is not even
   * there for the mouse — clicks go through it to what is below.
   */
  openRemote(kind: 'rc-consent' | 'rc-indicator' | 'rc-pointer', hash: string, bounds: Rectangle): BrowserWindow {
    const consent = kind === 'rc-consent';
    const tag = kind === 'rc-pointer';
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      movable: consent,
      skipTaskbar: !consent,
      alwaysOnTop: true,
      title: consent ? 'Remote control request' : 'Remote control',
      ...(tag ? { transparent: true, focusable: false, hasShadow: false, backgroundColor: '#00000000' } : { backgroundColor: consent ? '#FFFFFF' : '#0F1B3D' }),
      webPreferences: this.webPreferences(),
    });
    // On X11 this does not survive the window being shown or moved (tried under Xvfb), so remote control
    // also hides the tag before every press and scroll it passes on: it is never under a controller's click.
    if (tag) win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setContentProtection(true);
    this.kinds.set(win.id, kind);
    const id = win.id;
    win.on('closed', () => this.kinds.delete(id));
    win.once('ready-to-show', () => {
      if (consent) {
        win.show();
        win.focus();
      } else win.showInactive();
    });
    win.webContents.on('render-process-gone', () => !win.isDestroyed() && win.close());
    void win.loadURL(this.url(hash));
    return win;
  }

  private ringer: BrowserWindow | null = null;

  /**
   * The website-chat call window (RING-40): frameless, above other apps and
   * full-screen ones where the system allows, shown without taking the
   * keyboard from whatever the person is typing in, bottom right, and there
   * with the main window minimised or closed to the tray. One window; its
   * height follows how many chats are ringing.
   */
  showRinger(height: number): BrowserWindow {
    const bounds = ringerBounds(screen.getPrimaryDisplay().workArea, height);
    const existing = this.ringer && !this.ringer.isDestroyed() ? this.ringer : null;
    if (existing) {
      const b = existing.getBounds();
      if (b.height !== bounds.height || b.x !== bounds.x || b.y !== bounds.y) existing.setBounds(bounds);
      if (!existing.isVisible()) existing.showInactive();
      return existing;
    }
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Website chat ringing',
      backgroundColor: '#0F1B3D',
      webPreferences: this.webPreferences(),
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.kinds.set(win.id, 'webchat-ring');
    const wid = win.id;
    this.ringer = win;
    win.on('closed', () => {
      this.kinds.delete(wid);
      if (this.ringer === win) this.ringer = null;
    });
    win.once('ready-to-show', () => win.showInactive());
    win.webContents.on('render-process-gone', () => !win.isDestroyed() && win.close());
    void win.loadURL(this.url('/window/webchat-ring'));
    return win;
  }

  private quickAsk: BrowserWindow | null = null;

  /**
   * Quick Ask (AI Assistant): over whatever app is in front, on the screen the
   * pointer is on, taking the keyboard — it is opened to be typed in. It goes
   * when it loses the focus, like a launcher.
   */
  showQuickAsk(): BrowserWindow {
    const existing = this.quickAsk && !this.quickAsk.isDestroyed() ? this.quickAsk : null;
    if (existing) {
      // The same window, told to read the new selection.
      existing.webContents.send('quickask:changed');
      existing.show();
      existing.focus();
      return existing;
    }
    const size = SIZES['quick-ask'];
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const win = new BrowserWindow({
      x: area.x + Math.round((area.width - size.width) / 2),
      y: area.y + Math.round(area.height * 0.18),
      width: size.width,
      height: size.height,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Quick Ask',
      backgroundColor: '#FFFFFF',
      webPreferences: this.webPreferences(),
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.kinds.set(win.id, 'quick-ask');
    const wid = win.id;
    this.quickAsk = win;
    win.on('blur', () => !win.isDestroyed() && win.close());
    win.on('closed', () => {
      this.kinds.delete(wid);
      if (this.quickAsk === win) this.quickAsk = null;
    });
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    win.webContents.on('render-process-gone', () => !win.isDestroyed() && win.close());
    void win.loadURL(this.url('/window/quick-ask'));
    return win;
  }

  hideQuickAsk(): void {
    if (this.quickAsk && !this.quickAsk.isDestroyed()) this.quickAsk.close();
    this.quickAsk = null;
  }

  hideRinger(): void {
    if (this.ringer && !this.ringer.isDestroyed()) this.ringer.close();
    this.ringer = null;
  }

  private create(kind: WindowKind, opts: { hash: string; title?: string; alwaysOnTop?: boolean; show?: boolean; bounds?: Rectangle | null }): BrowserWindow {
    const size = SIZES[kind];
    // An incoming call always appears in the same place: top right of the
    // screen the pointer is on, clear of the menu bar.
    const ring = kind === 'ring';
    const saved = ring ? null : this.loadLayout(kind);
    const primary = ring ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : screen.getPrimaryDisplay();
    const initial: Rectangle = opts.bounds ?? saved?.bounds ?? {
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
      webPreferences: this.webPreferences(),
    });
    if (ring && mac) win.setWindowButtonVisibility(false);
    this.kinds.set(win.id, kind);
    const id = win.id;
    win.on('closed', () => {
      this.kinds.delete(id);
      this.compactFrom.delete(id);
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

  open(kind: Exclude<WindowKind, 'main'>, route: string, title?: string, alwaysOnTop?: boolean, place?: { at?: { x: number; y: number }; bounds?: Rectangle }): BrowserWindow {
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
    if (kind !== 'record') return this.create(kind, { hash, title, alwaysOnTop: alwaysOnTop ?? kind !== 'meet' });
    const win = this.create(kind, { hash, title, alwaysOnTop: false, bounds: this.recordPlace(place) });
    this.trackRecord(win, route, title ?? '');
    return win;
  }

  // ── multi-window docking (FR-NAV-05/07) ─────────────────────────────────

  private recordPlace(place?: { at?: { x: number; y: number }; bounds?: Rectangle }): Rectangle | null {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    if (place?.bounds) return fitToDisplays(place.bounds, displays, primary);
    const size = this.loadLayout('record')?.bounds ?? SIZES.record;
    const others = [...this.records.keys()].map((id) => BrowserWindow.fromId(id)).filter((w): w is BrowserWindow => !!w && !w.isDestroyed()).map((w) => w.getBounds());
    return detachedBounds(place?.at ?? null, { width: size.width, height: size.height }, others, displays, primary);
  }

  private trackRecord(win: BrowserWindow, route: string, title: string): void {
    const id = win.id;
    this.records.set(id, { route, title });
    win.on('move', () => this.recordsChanged());
    win.on('resize', () => this.recordsChanged());
    // A window closed on purpose (docked back, or closed by the person) is forgotten; one closed for
    // sign-out is taken out of the map first, so it is still there at the next sign-in.
    win.on('closed', () => {
      if (this.records.delete(id)) this.recordsChanged();
    });
    this.recordsChanged();
  }

  private recordsChanged(): void {
    if (this.stopped) return;
    if (this.recordsTimer) clearTimeout(this.recordsTimer);
    this.recordsTimer = setTimeout(() => {
      this.recordsTimer = null;
      if (!this.stopped) this.onRecordsChanged(this.detached());
    }, 600);
  }

  /** The torn-off windows open now, in the order they were opened. */
  detached(): DetachedWindow[] {
    const out: DetachedWindow[] = [];
    for (const [id, r] of this.records) {
      const w = BrowserWindow.fromId(id);
      if (!w || w.isDestroyed()) continue;
      const b = w.isMaximized() || w.isMinimized() ? w.getNormalBounds() : w.getBounds();
      out.push({ route: r.route, title: r.title, bounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
    }
    return out;
  }

  /** What a torn-off window shows, or null for any other window. */
  recordOf(id: number): { route: string; title: string } | null {
    return this.records.get(id) ?? null;
  }

  /** A torn-off window moved within its module, or named itself. */
  describe(win: BrowserWindow, route: string, title: string): void {
    const r = this.records.get(win.id);
    if (!r || (r.route === route && r.title === title)) return;
    this.records.set(win.id, { route, title });
    this.recordsChanged();
  }

  /**
   * Signing out closes every torn-off window — they show the person's data —
   * without forgetting them: the same person gets them back at sign-in.
   */
  closeRecords(): void {
    if (this.recordsTimer) clearTimeout(this.recordsTimer);
    this.recordsTimer = null;
    for (const id of [...this.records.keys()]) {
      this.records.delete(id);
      const w = BrowserWindow.fromId(id);
      if (w && !w.isDestroyed()) w.close();
    }
  }

  /**
   * A voice call shrunk to a bar that floats over other apps (CallVoice,
   * "Minimised"), and back. Its place while shrunk is never saved as the call
   * window's place.
   */
  /**
   * Shrink a call or meeting window so it floats over other apps, or bring
   * it back. A voice call shrinks to a bar; a video call or a meeting to a
   * card that keeps the picture (a shared screen, or whoever is speaking).
   * Leaving full screen or maximised first, so the card is a card.
   */
  setCompact(win: BrowserWindow, value: boolean, shape: 'bar' | 'card' = 'bar'): boolean {
    const kind = this.kinds.get(win.id);
    if (!kind || !COMPACTABLE.has(kind)) return false;
    const mac = process.platform === 'darwin';
    if (value) {
      if (this.compactFrom.has(win.id)) return true;
      if (win.isFullScreen()) win.setFullScreen(false);
      const maximized = win.isMaximized();
      if (maximized) win.unmaximize();
      const b = win.getBounds();
      this.compactFrom.set(win.id, { bounds: b, maximized, onTop: win.isAlwaysOnTop() });
      const card = shape === 'card';
      // Elsewhere the window controls sit over the right of the bar.
      const width = card ? 380 : mac ? 330 : 470;
      const height = card ? 250 : 60;
      win.setMinimumSize(card ? 300 : 300, card ? 200 : 58);
      if (mac) win.setWindowButtonVisibility(false);
      win.setBounds(fitToDisplays({ x: b.x + b.width - width, y: b.y, width, height }, screen.getAllDisplays(), screen.getPrimaryDisplay()));
      win.setAlwaysOnTop(true, 'floating');
      return true;
    }
    const prev = this.compactFrom.get(win.id);
    this.compactFrom.delete(win.id);
    const size = SIZES[kind];
    win.setMinimumSize(size.minWidth, size.minHeight);
    if (mac) win.setWindowButtonVisibility(true);
    if (prev) {
      win.setBounds(fitToDisplays(prev.bounds, screen.getAllDisplays(), screen.getPrimaryDisplay()));
      if (prev.maximized) win.maximize();
      if (!prev.onTop && kind === 'meet') win.setAlwaysOnTop(false);
    }
    return false;
  }

  /**
   * A voice call's window is a narrow column. When a camera or a shared
   * screen appears it becomes the call surface, and grows to a video call's
   * size around where it was — unless it is already big enough, maximised,
   * full screen or floating.
   */
  fitVideo(win: BrowserWindow): boolean {
    if (this.kinds.get(win.id) !== 'call' || this.compactFrom.has(win.id) || win.isMaximized() || win.isFullScreen()) return false;
    const b = win.getBounds();
    const want = SIZES['video-call'];
    if (b.width >= 900) return false;
    win.setMinimumSize(want.minWidth, want.minHeight);
    const x = Math.round(b.x + b.width / 2 - want.width / 2);
    const y = Math.round(b.y + b.height / 2 - want.height / 2);
    win.setBounds(fitToDisplays({ x, y, width: want.width, height: want.height }, screen.getAllDisplays(), screen.getPrimaryDisplay()));
    return true;
  }

  isCompact(win: BrowserWindow): boolean {
    return this.compactFrom.has(win.id);
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

  /**
   * Closes the secondary windows whose route fails the test — those of an app
   * the person was just refused (a mini chat, a record, a call): nothing of it
   * stays on screen. Returns how many closed.
   */
  closeWhere(refuse: (route: string) => boolean): number {
    let n = 0;
    for (const w of this.all()) {
      if (this.kinds.get(w.id) === 'main') continue;
      const route = windowRoute(w.webContents.getURL());
      if (route !== null && refuse(route)) {
        w.close();
        n++;
      }
    }
    return n;
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

/** The route a secondary window was opened on (`…#/window/record?route=%2Fcrm%2Fleads%2F4` → `/crm/leads/4`); null for none. */
export function windowRoute(url: string): string | null {
  const hash = url.split('#')[1] ?? '';
  if (!hash.startsWith('/window/')) return null;
  return new URLSearchParams(hash.split('?')[1] ?? '').get('route');
}
