import { app, BrowserWindow, powerSaveBlocker, screen, webContents, type Rectangle, type WebContents } from 'electron';
import { join } from 'node:path';
import type { DetachedWindow, WindowKind } from '@shared/types';
import type { Database } from '../services/db';
import { APP_ORIGIN, devOrigin } from '../security/hardening';
import { logger } from '../main/log';
import { guestWindowIds } from '../main/events';
import { showHash } from '../services/slideshow';

const log = logger('windows');

/**
 * DesktopWindowManager (§3.6, FR-NAV-05/06/09, FR-SHL-04/05).
 *
 * Every window is created here with the same hardened preferences; content
 * never opens windows itself. Bounds, display and maximized state are
 * remembered per window kind; a window whose display is gone comes back
 * fully visible on the primary display.
 */
// The Live map window can be pinned on top of other apps (MAP-21, "📌 On top").
const ALWAYS_ON_TOP_ALLOWED = new Set<WindowKind>(['chat-mini', 'timer', 'call', 'video-call', 'ring', 'meet', 'live-map', 'phone', 'support-quick', 'support-ring', 'share-bar']);
/** Windows that can shrink to float over other apps while a call or meeting goes on. */
const COMPACTABLE = new Set<WindowKind>(['call', 'video-call', 'meet']);
/** One call at a time: a second "call" window focuses the one already open. */
const CALL_KINDS = new Set<WindowKind>(['call', 'video-call']);

const SIZES: Record<WindowKind, { width: number; height: number; minWidth: number; minHeight: number }> = {
  main: { width: 1440, height: 900, minWidth: 1024, minHeight: 640 },
  'chat-mini': { width: 380, height: 560, minWidth: 320, minHeight: 360 },
  // The Projects mini timer (D02): the time, pause and stop, the task, and the entry's note under the title bar.
  timer: { width: 340, height: 190, minWidth: 300, minHeight: 170 },
  record: { width: 1100, height: 800, minWidth: 720, minHeight: 520 },
  call: { width: 340, height: 600, minWidth: 320, minHeight: 520 },
  'video-call': { width: 1180, height: 760, minWidth: 720, minHeight: 480 },
  ring: { width: 360, height: 292, minWidth: 360, minHeight: 292 },
  meet: { width: 1280, height: 800, minWidth: 960, minHeight: 600 },
  // The compact phone (WS-VOIP-SRS-001 D01): the design's 360 × 640, always on top unless unpinned.
  phone: { width: 360, height: 640, minWidth: 320, minHeight: 480 },
  'rc-consent': { width: 460, height: 560, minWidth: 460, minHeight: 560 },
  'rc-indicator': { width: 560, height: 52, minWidth: 560, minHeight: 52 },
  'rc-pointer': { width: 220, height: 30, minWidth: 220, minHeight: 30 },
  // The sharing bar (WS-MEET-ENH-01 D03): a strip at the top of the screen you
  // are sharing, over whatever you are showing.
  'share-bar': { width: 620, height: 56, minWidth: 620, minHeight: 56 },
  'webchat-ring': { width: 420, height: 250, minWidth: 420, minHeight: 72 },
  'ring-tray': { width: 340, height: 360, minWidth: 340, minHeight: 120 },
  'quick-ask': { width: 600, height: 480, minWidth: 600, minHeight: 480 },
  // The Live map window (L-04, MAP-UI-04): the design's 500 wide, tall enough for the map and two Needs you rows.
  'live-map': { width: 500, height: 680, minWidth: 380, minHeight: 440 },
  // Wall mode on a display (MAP-24): the whole screen it is on; this is only its size before it goes full screen.
  wall: { width: 1280, height: 720, minWidth: 640, minHeight: 360 },
  // The Wall mode sheet (L-06, MAP-UI-06): the design's 430 wide, its display cards and four choices.
  'wall-sheet': { width: 430, height: 384, minWidth: 430, minHeight: 384 },
  // A support ticket's quick-reply window (WS-SUPPORT-SRS-001 D-04): the design's ~520 × 560, floating.
  'support-quick': { width: 520, height: 560, minWidth: 420, minHeight: 420 },
  // An urgent ticket ringing (D-07): a centred card, answered or dismissed, not managed.
  'support-ring': { width: 460, height: 440, minWidth: 460, minHeight: 360 },
  // The support wallboard (D-12): the whole screen it is on; this is only its size before it goes full screen.
  'support-wall': { width: 1280, height: 720, minWidth: 640, minHeight: 360 },
  // A presentation's slideshow and its presenter view (#321): the whole screen each is on; sizes before full screen.
  slideshow: { width: 1280, height: 720, minWidth: 640, minHeight: 360 },
  presenter: { width: 1280, height: 800, minWidth: 900, minHeight: 560 },
};
/** Cards that ring: no window controls, no place remembered, on top of everything. */
const RINGS = new Set<WindowKind>(['ring', 'support-ring']);
/**
 * Kinds of which one window is open at a time, a newer one replacing the older: a ring, and a quick reply (D-04) —
 * whose draft is kept per ticket, so nothing typed in the older one is lost.
 */
const ONE_AT_A_TIME = new Set<WindowKind>(['ring', 'support-quick', 'support-ring']);
/** Remote control's own windows: placed by remote control, never remembered. */
const REMOTE = new Set<WindowKind>(['rc-consent', 'rc-indicator', 'rc-pointer', 'webchat-ring', 'ring-tray', 'quick-ask', 'wall', 'wall-sheet', 'support-wall', 'slideshow', 'presenter']);

/**
 * The tray's ringing menu's place (R-06, RING-UI-07): under the menu-bar icon on macOS (or a tray at the top), over it
 * where the taskbar is at the bottom — beside the icon, inside the screen. Where the system does not say where its
 * icon is (most Linux desktops), the corner its tray is usually in: top right, or bottom right on Windows. `width`: the
 * Live mini-dashboard's 380 (L-05, MAP-UI-05) where the ringing menu has 340.
 */
export function ringTrayBounds(workArea: Rectangle, anchor: Rectangle | null, height: number, platform: NodeJS.Platform = process.platform, width: number = SIZES['ring-tray'].width): Rectangle {
  const h = Math.max(SIZES['ring-tray'].minHeight, Math.min(height, workArea.height - 16));
  const known = !!anchor && anchor.width > 0 && anchor.height > 0;
  const centre = known ? anchor!.x + anchor!.width / 2 - width / 2 : workArea.x + workArea.width - width - 8;
  const x = Math.round(Math.max(workArea.x + 8, Math.min(centre, workArea.x + workArea.width - width - 8)));
  const top = known ? anchor!.y + anchor!.height / 2 < workArea.y + workArea.height / 2 : platform !== 'win32';
  const y = top ? workArea.y + 4 : workArea.y + workArea.height - h - 4;
  return { x, y, width, height: h };
}

/** What the Live map window and the wall window show, as a route: the Live dashboard, which is Chat's. */
export const LIVE_ROUTE = '/chat?view=website&section=dashboard';

/** The tray's Live mini-dashboard is the design's 380 wide (L-05, MAP-UI-05). */
export const LIVE_TRAY_WIDTH = 380;

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
 * Where a window may sit on macOS (worksuite-desktop#221): never under the menu bar or the Dock. A window taller or
 * wider than its display's usable area, or above its top — what a zoom before the window was shown, a "Fill", or a
 * Dock that moved or grew leaves behind — is fitted to that area: the traffic lights come out from under the menu
 * bar and the status bar out from behind the Dock. A window the person dragged partly off the bottom or a side is
 * theirs to place and is left alone. Null when it already fits.
 */
export function keepInWorkArea(b: Rectangle, area: Rectangle): Rectangle | null {
  if (b.height <= area.height && b.width <= area.width && b.y >= area.y) return null;
  const width = Math.min(b.width, area.width);
  const height = Math.min(b.height, area.height);
  const x = Math.min(Math.max(b.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(b.y, area.y), area.y + area.height - height);
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
  /** Windows being closed for the person (sign-out, access gone): nothing in them may hold the close. */
  private readonly forced = new Set<number>();
  /** The torn-off windows changed (opened, moved, navigated, closed): remember them for the next start. */
  onRecordsChanged: (windows: DetachedWindow[]) => void = () => undefined;
  minimizeToTray: () => boolean = () => true;
  onMainShown: () => void = () => undefined;

  constructor(
    private readonly db: Database,
    private readonly preload: string,
  ) {}

  /**
   * The colour profile's window colours (worksuite-desktop#234): what a window is filled with before its page paints
   * (the profile's background, so nothing flashes on the way to it) and its title bar's, where the system draws the
   * window controls over ours (Windows, Linux). The defaults are Dark Blue's, as before profiles.
   */
  private look = { ground: '#0F1B3D', surface: '#FFFFFF', chrome: '#0F1B3D' };
  /** Windows whose title bar the system draws the controls over. */
  private overlays = new Set<number>();

  private backgroundFor(kind: WindowKind): string {
    if (kind === 'main' || kind === 'record' || kind === 'live-map' || kind === 'wall-sheet') return this.look.ground;
    if (kind === 'ring-tray' || kind === 'quick-ask' || kind === 'rc-consent') return this.look.surface;
    return this.look.chrome;
  }

  /** A new profile, or the computer's appearance changed under System: every open window takes its colours. */
  setLook(look: { ground: string; surface: string; chrome: string }): void {
    this.look = { ...look };
    for (const [id, kind] of this.kinds) {
      const win = BrowserWindow.fromId(id);
      if (!win || win.isDestroyed() || kind === 'rc-pointer' || kind === 'wall') continue;
      try {
        win.setBackgroundColor(this.backgroundFor(kind));
        if (this.overlays.has(id)) win.setTitleBarOverlay({ color: look.chrome, symbolColor: '#FFFFFF' });
      } catch {
        // A window on its way out, or a system without overlays: its colours are a nicety.
      }
    }
  }

  /** Whether web contents show the app's own pages: windows, and views laid into them. */
  isAppContents(wc: WebContents): boolean {
    if (wc.isDestroyed() || guestWindowIds.has(wc.id)) return false;
    const url = wc.getURL();
    const dev = devOrigin();
    return url.startsWith(`${APP_ORIGIN}/`) || (!!dev && url.startsWith(dev));
  }

  /**
   * The colour profile to every page of the app at once (#234) — every window, and every view laid into one — not
   * only the windows `broadcast` reaches; each applies it as it arrives.
   */
  broadcastAppearance(payload: unknown): void {
    for (const wc of webContents.getAllWebContents()) {
      if (!this.isAppContents(wc) || wc.isCrashed()) continue;
      try {
        wc.send('appearance:changed', payload);
      } catch {
        // Gone between the list and the send.
      }
    }
  }

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
      if (kind && !RINGS.has(kind) && !REMOTE.has(kind)) {
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
  /**
   * A small window that belongs to a share or a control session rather than to
   * the app: the consent request, the "being controlled" indicator, the
   * controller's name tag, and the sharing bar (D03).
   *
   * All of them are frameless, above everything including full-screen apps,
   * and **content-protected**, which is the point: a bar or an outline that
   * appeared inside the capture would be drawn over what the person is
   * actually trying to show.
   */
  openRemote(kind: 'rc-consent' | 'rc-indicator' | 'rc-pointer' | 'share-bar', hash: string, bounds: Rectangle): BrowserWindow {
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
      ...(tag ? { transparent: true, focusable: false, hasShadow: false, backgroundColor: '#00000000' } : { backgroundColor: consent ? this.look.surface : this.look.chrome }),
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
      backgroundColor: this.look.chrome,
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

  private ringTray: BrowserWindow | null = null;
  private ringTrayAnchor: Rectangle | null = null;
  private ringTrayWidth: number = SIZES['ring-tray'].width;

  /**
   * The tray's ringing menu (R-06, RING-UI-07; UX-ALR-02): a menu with a reply box, so a window drawn as one — by the
   * tray icon, over other apps, taking the keyboard (it is opened to be typed in) and gone when it loses the focus,
   * as a menu goes. One window; its height follows what it lists. It is put away, not closed, when it loses the focus,
   * so the Live mini-dashboard (L-05) opens again at once with what it last showed; locked or signed out, it closes.
   * `live`: the mini-dashboard's width (MAP-UI-05).
   */
  showRingTray(anchor: Rectangle | null, height: number, live = false): BrowserWindow {
    this.ringTrayAnchor = anchor;
    this.ringTrayWidth = live ? LIVE_TRAY_WIDTH : SIZES['ring-tray'].width;
    const display = anchor && anchor.width > 0 ? screen.getDisplayMatching(anchor) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = ringTrayBounds(display.workArea, anchor, height, process.platform, this.ringTrayWidth);
    const existing = this.ringTray && !this.ringTray.isDestroyed() ? this.ringTray : null;
    if (existing) {
      existing.setBounds(bounds);
      existing.show();
      existing.focus();
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
      title: 'Website chats ringing',
      backgroundColor: this.look.surface,
      webPreferences: this.webPreferences(),
    });
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.kinds.set(win.id, 'ring-tray');
    const wid = win.id;
    this.ringTray = win;
    win.on('blur', () => !win.isDestroyed() && win.hide());
    win.on('closed', () => {
      this.kinds.delete(wid);
      if (this.ringTray === win) this.ringTray = null;
    });
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    win.webContents.on('render-process-gone', () => !win.isDestroyed() && win.close());
    void win.loadURL(this.url('/window/ring-tray'));
    return win;
  }

  /** The ringing menu measured itself: it takes that height, where it is. */
  fitRingTray(height: number): void {
    const win = this.ringTray && !this.ringTray.isDestroyed() ? this.ringTray : null;
    if (!win) return;
    const b = win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const next = ringTrayBounds(area, this.ringTrayAnchor, height, process.platform, this.ringTrayWidth);
    if (next.height !== b.height || next.y !== b.y || next.width !== b.width) win.setBounds(next);
  }

  /** Put away, as a menu goes once used: kept, so it opens again at once. */
  hideRingTray(): void {
    if (this.ringTray && !this.ringTray.isDestroyed() && this.ringTray.isVisible()) this.ringTray.hide();
  }

  /** Gone with what it showed: locked, or signed out. */
  closeRingTray(): void {
    if (this.ringTray && !this.ringTray.isDestroyed()) this.ringTray.close();
    this.ringTray = null;
  }

  /**
   * The Live map window (L-04, MAP-21; MAP-UI-04): a native window of its own — the figures, the map and who needs us
   * — that can be pinned on top of other apps or dragged to another display, and opens again where it was left, as big
   * as it was (its region preset and its pin are the page's own). One window; `focus` brings it to a waiting visitor's
   * place ("Show on map", MAP-23).
   */
  showLiveMap(focus?: number | null): BrowserWindow {
    const existing = this.liveMap();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      if (focus) existing.webContents.send('live:focus', { conversationId: focus });
      return existing;
    }
    return this.create('live-map', { hash: `/window/live-map${focus ? `?focus=${focus}` : ''}`, title: 'Live map' });
  }

  /**
   * ⌘⇧M (MAP-21): the Live map window shows, or goes when it is already in sight — in front, or pinned on top of other
   * apps. Behind other windows, it comes forward. Whether it is open after.
   */
  toggleLiveMap(): boolean {
    const win = this.liveMap();
    if (win && win.isVisible() && !win.isMinimized() && (win.isFocused() || win.isAlwaysOnTop())) {
      win.close();
      return false;
    }
    this.showLiveMap();
    return true;
  }

  private liveMap(): BrowserWindow | null {
    return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && this.kinds.get(w.id) === 'live-map') ?? null;
  }

  private wall: BrowserWindow | null = null;
  /** The screen the wall is on, and the keep-awake it holds there (MAP-24). */
  private wallDisplay: number | null = null;
  private wallAwake: number | null = null;
  /** The wall's display was unplugged and its window closed (MAP-24): the tray says so. */
  onWallGone: () => void = () => undefined;

  /**
   * Wall mode on a display (L-06; MAP-24, MAP-UI-06): the whole of that screen, kept awake while it is up when the sheet
   * says so, names hidden as the wall always hides them. Opened again on another screen, it moves there. Unplugging
   * its display closes it.
   */
  showWall(displayId: number | null, opts: { keepAwake?: boolean } = {}): BrowserWindow {
    const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
    this.wallDisplay = display.id;
    this.keepWallAwake(opts.keepAwake !== false);
    const existing = this.wall && !this.wall.isDestroyed() ? this.wall : null;
    if (existing) {
      if (existing.isFullScreen()) existing.setFullScreen(false);
      existing.setBounds(display.bounds);
      existing.setFullScreen(true);
      existing.show();
      // What the sheet chose (cycle, keep awake) is read again.
      existing.webContents.send('live:wallChanged');
      return existing;
    }
    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      fullscreen: true,
      title: 'Website chats — live',
      backgroundColor: '#0B1430',
      webPreferences: this.webPreferences(),
    });
    this.kinds.set(win.id, 'wall');
    const wid = win.id;
    this.wall = win;
    const unplugged = (_e: unknown, d: { id: number }) => {
      if (d.id !== this.wallDisplay || win.isDestroyed()) return;
      win.close();
      this.onWallGone();
    };
    screen.on('display-removed', unplugged);
    win.on('closed', () => {
      this.kinds.delete(wid);
      if (this.wall === win) {
        this.wall = null;
        this.wallDisplay = null;
        this.keepWallAwake(false);
      }
      screen.removeListener('display-removed', unplugged);
    });
    win.once('ready-to-show', () => win.show());
    win.webContents.on('render-process-gone', () => !win.isDestroyed() && win.close());
    void win.loadURL(this.url('/window/wall'));
    return win;
  }

  /** The tray's item, or Esc, takes the wall down (MAP-24): whether one was up. */
  closeWall(): boolean {
    const win = this.wall && !this.wall.isDestroyed() ? this.wall : null;
    if (!win) return false;
    win.close();
    return true;
  }

  /** Whether wall mode is up on a screen now. */
  wallOpen(): boolean {
    return !!this.wall && !this.wall.isDestroyed();
  }

  private keepWallAwake(on: boolean): void {
    if (on && this.wallAwake !== null && powerSaveBlocker.isStarted(this.wallAwake)) return;
    if (!on) {
      if (this.wallAwake !== null && powerSaveBlocker.isStarted(this.wallAwake)) powerSaveBlocker.stop(this.wallAwake);
      this.wallAwake = null;
      return;
    }
    this.wallAwake = powerSaveBlocker.start('prevent-display-sleep');
  }

  /**
   * The Wall mode sheet (L-06, MAP-UI-06): a small window of its own titled "Wall mode" — over whatever is in front, as
   * it is opened from the tray with the main window closed as often as from the dashboard — that picks the screen and
   * how, then opens the wall. One at a time.
   */
  showWallSheet(): BrowserWindow {
    const existing = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && this.kinds.get(w.id) === 'wall-sheet');
    if (existing) {
      existing.webContents.send('live:wallChanged');
      existing.show();
      existing.focus();
      return existing;
    }
    const win = this.create('wall-sheet', { hash: '/window/wall-sheet', title: 'Wall mode' });
    win.setResizable(false);
    win.setMinimizable(false);
    win.setMaximizable(false);
    win.setFullScreenable(false);
    return win;
  }

  /** The sheet goes once the wall opens, or on Cancel. */
  closeWallSheet(): void {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && this.kinds.get(w.id) === 'wall-sheet') w.close();
  }

  private supportWall: BrowserWindow | null = null;

  /**
   * The support wallboard on a display (WS-SUPPORT-SRS-001 D-12): the whole of that screen, menu-less, kept awake while
   * it is up. Opened again on another screen, it moves there; unplugging its display closes it. Esc on it, or Close the
   * wallboard in the inbox, takes it down.
   */
  showSupportWall(displayId: number | null): BrowserWindow {
    const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
    const existing = this.supportWall && !this.supportWall.isDestroyed() ? this.supportWall : null;
    if (existing) {
      if (existing.isFullScreen()) existing.setFullScreen(false);
      existing.setBounds(display.bounds);
      existing.setFullScreen(true);
      existing.show();
      return existing;
    }
    const win = new BrowserWindow({ ...display.bounds, show: false, frame: false, fullscreen: true, title: 'Support wallboard', backgroundColor: '#070B16', webPreferences: this.webPreferences() });
    this.kinds.set(win.id, 'support-wall');
    const wid = win.id;
    this.supportWall = win;
    const shown = display.id;
    const awake = powerSaveBlocker.start('prevent-display-sleep');
    const unplugged = (_e: unknown, d: { id: number }) => {
      if (d.id === shown && !win.isDestroyed()) win.close();
    };
    screen.on('display-removed', unplugged);
    win.on('closed', () => {
      this.kinds.delete(wid);
      if (this.supportWall === win) this.supportWall = null;
      if (powerSaveBlocker.isStarted(awake)) powerSaveBlocker.stop(awake);
      screen.removeListener('display-removed', unplugged);
    });
    win.once('ready-to-show', () => win.show());
    win.webContents.on('render-process-gone', () => !win.isDestroyed() && win.close());
    void win.loadURL(this.url('/window/support-wall'));
    return win;
  }

  /** Takes the support wallboard down: whether one was up. */
  closeSupportWall(): boolean {
    const win = this.supportWall && !this.supportWall.isDestroyed() ? this.supportWall : null;
    if (!win) return false;
    win.close();
    return true;
  }

  supportWallOpen(): boolean {
    return !!this.supportWall && !this.supportWall.isDestroyed();
  }

  private show: { id: string; windows: BrowserWindow[]; awake: number } | null = null;

  /**
   * A presentation's slideshow (#321): the slides full screen, black round them and no app chrome, on the screen
   * `plan` chose; with a second screen the presenter view full screen on the other. Starting another show ends the one
   * that is up. Closing either window, or its screen being unplugged, ends the show — both windows go.
   */
  showSlideshow(id: string, plan: { slides: number; presenter: number | null }): void {
    this.closeSlideshow();
    const displays = screen.getAllDisplays();
    const at = (displayId: number) => displays.find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
    const open = (kind: 'slideshow' | 'presenter', displayId: number) => {
      const display = at(displayId);
      const win = new BrowserWindow({
        ...display.bounds,
        show: false,
        frame: false,
        fullscreen: true,
        autoHideMenuBar: true,
        title: kind === 'slideshow' ? 'Slideshow' : 'Presenter view',
        backgroundColor: kind === 'slideshow' ? '#000000' : '#111214',
        webPreferences: this.webPreferences(),
      });
      this.kinds.set(win.id, kind);
      const wid = win.id;
      win.on('closed', () => {
        this.kinds.delete(wid);
        // One window gone ends the show: the other goes with it.
        if (this.show?.windows.includes(win)) this.closeSlideshow();
      });
      win.once('ready-to-show', () => {
        if (win.isDestroyed()) return;
        win.show();
        if (kind === 'slideshow') win.focus();
      });
      win.webContents.on('render-process-gone', () => !win.isDestroyed() && win.close());
      void win.loadURL(this.url(showHash(kind, id)));
      return win;
    };
    const windows = [open('slideshow', plan.slides)];
    if (plan.presenter !== null && plan.presenter !== plan.slides) windows.push(open('presenter', plan.presenter));
    const shown = new Set([plan.slides, plan.presenter]);
    const unplugged = (_e: unknown, d: { id: number }) => {
      if (shown.has(d.id)) this.closeSlideshow();
    };
    screen.on('display-removed', unplugged);
    windows[0]!.once('closed', () => screen.removeListener('display-removed', unplugged));
    this.show = { id, windows, awake: powerSaveBlocker.start('prevent-display-sleep') };
  }

  /** Ends the show that is up: whether one was. */
  closeSlideshow(): boolean {
    const show = this.show;
    if (!show) return false;
    this.show = null;
    if (powerSaveBlocker.isStarted(show.awake)) powerSaveBlocker.stop(show.awake);
    for (const w of show.windows) if (!w.isDestroyed()) w.close();
    return true;
  }

  slideshowOpen(): string | null {
    return this.show?.id ?? null;
  }

  /** The screen WorkSuite's main window is on ("this window" in the sheet), or null while it is closed. */
  mainDisplayId(): number | null {
    const main = this.getMain();
    if (!main || main.isDestroyed() || !main.isVisible()) return null;
    return screen.getDisplayMatching(main.getBounds()).id;
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
      backgroundColor: this.look.surface,
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
    // An urgent support ticket rings as a card in the middle of the screen the pointer is on (D-07), and takes the focus.
    const ring = RINGS.has(kind);
    const corner = kind === 'ring';
    const saved = ring ? null : this.loadLayout(kind);
    const primary = ring ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : screen.getPrimaryDisplay();
    const initial: Rectangle = opts.bounds ?? saved?.bounds ?? {
      x: corner ? primary.workArea.x + primary.workArea.width - size.width - 20 : primary.workArea.x + Math.round((primary.workArea.width - size.width) / 2),
      y: corner ? primary.workArea.y + 16 : primary.workArea.y + Math.round((primary.workArea.height - size.height) / 2),
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
      backgroundColor: this.backgroundFor(kind),
      // FR-SHL-05: native traffic lights on macOS; our own title bar elsewhere,
      // with the OS window controls drawn over it (snap layouts keep working).
      titleBarStyle: 'hidden',
      // A ring has no window controls at all: it is answered or declined.
      ...(mac ? { trafficLightPosition: { x: 18, y: 18 } } : { titleBarOverlay: ring ? false : { color: this.look.chrome, symbolColor: '#FFFFFF', height: kind === 'main' ? 52 : 40 } }),
      alwaysOnTop: !!opts.alwaysOnTop && ALWAYS_ON_TOP_ALLOWED.has(kind),
      ...(ring ? { resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true } : {}),
      icon: mac ? undefined : join(app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources'), 'icons', '256x256.png'),
      webPreferences: this.webPreferences(),
    });
    if (ring && mac) win.setWindowButtonVisibility(false);
    this.kinds.set(win.id, kind);
    const id = win.id;
    if (!mac && !ring) this.overlays.add(id);
    // A chat window holds its close while a draft is saved or a picture finishes
    // going up (#103); quitting, signing out and losing access close it anyway.
    win.webContents.on('will-prevent-unload', (e) => {
      if (this.quitting || this.forced.has(id)) e.preventDefault();
    });
    win.on('closed', () => {
      this.kinds.delete(id);
      this.overlays.delete(id);
      this.forced.delete(id);
      this.compactFrom.delete(id);
      const t = this.saveTimers.get(id);
      if (t) clearTimeout(t);
      this.saveTimers.delete(id);
    });
    if (!ring) {
      win.on('resize', () => this.scheduleSave(win, kind));
      win.on('move', () => this.scheduleSave(win, kind));
    }
    // Zoomed last time: zoomed again. On macOS only once the window is on screen, where the system zooms it into
    // the area above the Dock and below the menu bar; zoomed while hidden it could take the whole display (#221).
    if (saved?.maximized && kind === 'main') {
      if (mac) win.once('show', () => !win.isDestroyed() && win.maximize());
      else win.maximize();
    }
    if (mac && !ring) this.guardWorkArea(win);
    win.once('ready-to-show', () => {
      if (opts.show === false) return;
      // A call's ring must not take the keyboard from whatever the person is typing in; an urgent ticket's card does
      // (D-07: "focus-stealing"), so Enter takes it and Esc dismisses it.
      if (corner) {
        win.setAlwaysOnTop(true, 'pop-up-menu');
        win.showInactive();
      } else if (ring) {
        win.setAlwaysOnTop(true, 'pop-up-menu');
        win.show();
        win.focus();
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
    // What the window's page reports as an error — a screen that failed to draw among them (app/Boundaries.tsx) —
    // goes to the log, so a crash can be read afterwards. Capped: a failing loop must not fill the disk.
    let logged = 0;
    win.webContents.on('console-message', (e) => {
      if (e.level !== 'error' || logged >= 200) return;
      logged++;
      log.error('renderer error', { kind, message: e.message.slice(0, 4000), source: e.sourceId.slice(0, 300), line: e.lineNumber });
    });
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
      // FR-TRAY-02: closing minimizes to the tray unless the user chose Exit. On macOS the app stays in the Dock, as
      // a Mac app does, and clicking its icon brings the window back (#221).
      if (!this.quitting && this.minimizeToTray()) {
        e.preventDefault();
        win.hide();
      }
    });
    // Full screen hides the traffic lights with the menu bar: the title bar gives their room back (#221).
    win.on('enter-full-screen', () => !win.isDestroyed() && win.webContents.send('window:fullscreen', true));
    win.on('leave-full-screen', () => !win.isDestroyed() && win.webContents.send('window:fullscreen', false));
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

  /** Closes every window of a kind (an urgent ticket's card, once somebody has taken the ticket). */
  closeKind(kind: WindowKind): void {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && this.kinds.get(w.id) === kind) w.close();
  }

  open(kind: Exclude<WindowKind, 'main'>, route: string, title?: string, alwaysOnTop?: boolean, place?: { at?: { x: number; y: number }; bounds?: Rectangle }): BrowserWindow {
    const hash = `/window/${kind}?route=${encodeURIComponent(route)}`;
    for (const w of BrowserWindow.getAllWindows()) {
      const k = this.kinds.get(w.id);
      // One mini chat per conversation, one Meet per meeting, one call at a
      // time: focus the one already open.
      if ((k === kind && w.webContents.getURL().endsWith(hash)) || (k && CALL_KINDS.has(k) && CALL_KINDS.has(kind))) {
        // Minimised, it comes back as it was (#103).
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
        return w;
      }
      // A newer ring replaces an older one; so does a quick reply.
      if (k === kind && ONE_AT_A_TIME.has(kind)) w.close();
    }
    if (kind !== 'record') return this.create(kind, { hash, title, alwaysOnTop: alwaysOnTop ?? kind !== 'meet', bounds: this.cascade(kind) });
    const win = this.create(kind, { hash, title, alwaysOnTop: false, bounds: this.recordPlace(place) });
    this.trackRecord(win, route, title ?? '');
    return win;
  }

  /**
   * Several chat windows open at once (#103): each new one opens where the last
   * one was left, stepped down and right past the ones already there, so none
   * hides another — and still on a screen that is connected.
   */
  private cascade(kind: WindowKind): Rectangle | null {
    if (kind !== 'chat-mini') return null;
    const open = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && this.kinds.get(w.id) === kind).map((w) => w.getBounds());
    if (!open.length) return null;
    const primary = screen.getPrimaryDisplay();
    const size = SIZES[kind];
    const base = this.loadLayout(kind)?.bounds ?? {
      x: primary.workArea.x + Math.round((primary.workArea.width - size.width) / 2),
      y: primary.workArea.y + Math.round((primary.workArea.height - size.height) / 2),
      width: size.width,
      height: size.height,
    };
    let at = { ...base };
    for (let i = 1; i <= open.length + 1 && open.some((b) => Math.abs(b.x - at.x) < 8 && Math.abs(b.y - at.y) < 8); i++) {
      at = { ...base, x: base.x + 28 * i, y: base.y + 28 * i };
    }
    return fitToDisplays(at, screen.getAllDisplays(), primary);
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
      if (w && !w.isDestroyed()) {
        this.forced.add(id);
        w.close();
      }
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
        this.forced.add(w.id);
        w.close();
        n++;
      }
    }
    return n;
  }

  /**
   * Displays changed (a monitor unplugged, the Dock moved, grew or started hiding): pull every window back into view.
   * On macOS a zoomed window keeps the frame it was zoomed to, so one the Dock now covers is fitted to the usable area
   * too (#221); elsewhere the system keeps a maximised window in its work area itself.
   */
  refit(): void {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const mac = process.platform === 'darwin';
    for (const w of this.all()) {
      if (w.isFullScreen() || (w.isMaximized() && !mac)) continue;
      const b = w.getBounds();
      const fitted = (mac ? keepInWorkArea(b, screen.getDisplayMatching(b).workArea) : null) ?? (w.isMaximized() ? b : fitToDisplays(b, displays, primary));
      if (fitted.x !== b.x || fitted.y !== b.y || fitted.width !== b.width || fitted.height !== b.height) w.setBounds(fitted);
    }
  }

  /**
   * macOS (#221): after the window is shown, zoomed, moved or resized, one that has spread under the menu bar or the
   * Dock comes back into its display's usable area. Never in full screen, where the system owns the frame (the Dock
   * and menu bar hide there), nor while full screen is ending, nor for a call shrunk to float.
   */
  private guardWorkArea(win: BrowserWindow): void {
    let timer: NodeJS.Timeout | null = null;
    let settlingUntil = 0;
    const check = () => {
      timer = null;
      if (win.isDestroyed() || Date.now() < settlingUntil || win.isFullScreen() || win.isSimpleFullScreen() || this.compactFrom.has(win.id)) return;
      const b = win.getBounds();
      const fixed = keepInWorkArea(b, screen.getDisplayMatching(b).workArea);
      if (fixed) win.setBounds(fixed);
    };
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 250);
    };
    for (const e of ['show', 'resize', 'move', 'maximize'] as const) win.on(e as 'show', later);
    // Leaving full screen animates the frame back: let it land first.
    win.on('leave-full-screen', () => {
      settlingUntil = Date.now() + 1000;
      setTimeout(later, 1000);
    });
    win.on('closed', () => timer && clearTimeout(timer));
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
  // The Live map window and wall mode are the Live dashboard's (L-04, MAP-24): they close with Chat, and at sign-out.
  if (/^\/window\/(live-map|wall|wall-sheet)(\?|$)/.test(hash)) return LIVE_ROUTE;
  // The support wallboard (D-12) is the desk's: it closes with Support, and at sign-out.
  if (/^\/window\/support-wall(\?|$)/.test(hash)) return '/support';
  return new URLSearchParams(hash.split('?')[1] ?? '').get('route');
}
