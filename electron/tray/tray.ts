import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { join } from 'node:path';
import { trayState, trayTooltip, type TrayState } from '@shared/network';
import { logger } from '../main/log';

const log = logger('tray');

/**
 * Tray / menu bar (FR-TRAY-01/05/06/07, §4.7, §4.20).
 *
 * The icon shows one state by priority — Error > Offline > Monitoring >
 * Syncing > Unread > Normal — and the tooltip lists every active one. The
 * taskbar or dock badge carries the unread count.
 */
export interface TrayModel {
  signedIn: boolean;
  userName: string | null;
  organization: string | null;
  offline: boolean;
  pending: number;
  error: string | null;
  unreadChat: number;
  unreadMail: number;
  unreadOther: number;
  notificationsPausedUntil: string | null;
  attendance: { linked: boolean; clockedIn: boolean; since: string | null } | null;
  updateReady: boolean;
}

export interface TrayActions {
  open: () => void;
  openRoute: (route: string) => void;
  clockIn: () => void;
  clockOut: () => void;
  pauseNotifications: (minutes: number | null) => void;
  openSettings: () => void;
  checkUpdates: () => void;
  quit: () => void;
  lock: () => void;
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources');
}

function icon(state: TrayState): NativeImage {
  const dir = join(resourcesDir(), 'tray');
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(join(dir, `${state}Template.png`));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(join(dir, `${state}.png`));
}

function untilTomorrowMinutes(): number {
  const now = new Date();
  const t = new Date(now);
  t.setDate(now.getDate() + 1);
  t.setHours(8, 0, 0, 0);
  return Math.max(1, Math.round((t.getTime() - now.getTime()) / 60_000));
}

export class TrayService {
  private tray: Tray | null = null;
  private model: TrayModel = {
    signedIn: false,
    userName: null,
    organization: null,
    offline: false,
    pending: 0,
    error: null,
    unreadChat: 0,
    unreadMail: 0,
    unreadOther: 0,
    notificationsPausedUntil: null,
    attendance: null,
    updateReady: false,
  };
  private lastState: TrayState | null = null;

  constructor(private readonly actions: TrayActions) {}

  start(): void {
    try {
      this.tray = new Tray(icon('normal'));
    } catch (e) {
      // Some Linux desktops have no tray; the app must work without it (§2.5).
      log.warn('no system tray available', { error: String(e) });
      return;
    }
    this.tray.setToolTip('WorkSuite');
    if (process.platform !== 'darwin') this.tray.on('click', () => this.actions.open());
    this.render();
  }

  update(patch: Partial<TrayModel>): void {
    this.model = { ...this.model, ...patch };
    this.render();
  }

  private render(): void {
    const m = this.model;
    const unread = m.unreadChat + m.unreadMail + m.unreadOther;
    const state = trayState({ error: !!m.error, offline: m.offline && m.signedIn, monitoring: false, syncing: false, unread });
    // Badge: unread chat + mail + important notifications (FR-TRAY-07). On macOS the
    // renderer paints it onto the Dock icon (core/dock-badge): an unsigned build is
    // never registered for notifications, and macOS will not draw its badge.
    try {
      app.setBadgeCount(m.signedIn && process.platform !== 'darwin' ? unread : 0);
    } catch {
      /* not supported on this desktop */
    }
    if (!this.tray) return;
    if (state !== this.lastState) {
      this.tray.setImage(icon(state));
      this.lastState = state;
    }
    this.tray.setToolTip(
      trayTooltip({
        error: m.error,
        offline: m.offline && m.signedIn,
        pending: m.pending,
        monitoring: null,
        syncing: 0,
        unreadChat: m.unreadChat,
        unreadMail: m.unreadMail,
        unreadOther: m.unreadOther,
      }),
    );
    this.tray.setContextMenu(Menu.buildFromTemplate(this.template()));
  }

  private template(): MenuItemConstructorOptions[] {
    const m = this.model;
    const a = this.actions;
    const items: MenuItemConstructorOptions[] = [];
    if (m.signedIn) {
      items.push({ label: [m.userName, m.organization].filter(Boolean).join(' · ') || 'WorkSuite', enabled: false });
      items.push({ type: 'separator' });
    }
    items.push({ label: 'Open WorkSuite', click: a.open });
    if (m.signedIn) {
      items.push({ label: `Unread Chat ${m.unreadChat} · Unread Mail ${m.unreadMail}`, click: () => a.openRoute(m.unreadChat >= m.unreadMail ? '/chat' : '/mail') });
      items.push({ type: 'separator' });
      if (m.attendance?.linked) {
        items.push(
          m.attendance.clockedIn
            ? { label: `Clock Out${m.attendance.since ? ` (in since ${m.attendance.since})` : ''}`, click: a.clockOut }
            : { label: 'Start Work / Clock In', click: a.clockIn },
        );
      }
      items.push({
        label: 'Quick Actions',
        submenu: [
          { label: 'New Task', click: () => a.openRoute('/tasks?new=1') },
          { label: 'New Email', click: () => a.openRoute('/mail?compose=1') },
          { label: 'Open Chat', click: () => a.openRoute('/chat') },
          { label: 'Upload File', click: () => a.openRoute('/files?upload=1') },
          { label: 'New Lead', click: () => a.openRoute('/crm?new=1') },
        ],
      });
      const paused = m.notificationsPausedUntil && new Date(m.notificationsPausedUntil).getTime() > Date.now();
      items.push({
        label: paused ? `Notifications paused until ${new Date(m.notificationsPausedUntil!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Pause Notifications',
        submenu: [
          { label: 'For 30 minutes', click: () => a.pauseNotifications(30) },
          { label: 'For 1 hour', click: () => a.pauseNotifications(60) },
          { label: 'Until tomorrow', click: () => a.pauseNotifications(untilTomorrowMinutes()) },
          ...(paused ? [{ type: 'separator' as const }, { label: 'Resume notifications', click: () => a.pauseNotifications(null) }] : []),
        ],
      });
      items.push({
        label: m.offline ? (m.pending > 0 ? `Offline — ${m.pending} change${m.pending === 1 ? '' : 's'} waiting` : 'Offline') : 'Connected',
        enabled: false,
      });
      items.push({ type: 'separator' });
      items.push({ label: 'Lock WorkSuite', click: a.lock });
    }
    items.push({ label: 'Settings', click: a.openSettings });
    items.push({ label: m.updateReady ? 'Restart to Update' : 'Check for Updates', click: a.checkUpdates });
    items.push({ type: 'separator' });
    items.push({ label: 'Quit WorkSuite', click: a.quit });
    return items;
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
