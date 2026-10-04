import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { join } from 'node:path';
import { attentionCount, trayState, trayTooltip, type TrayState } from '@shared/network';
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
  /** Off: no count on the app's icon (Settings › Notifications). */
  badge: boolean;
  notificationsPausedUntil: string | null;
  attendance: { linked: boolean; clockedIn: boolean; since: string | null } | null;
  updateReady: boolean;
  /** A newer version: on offer, ready, or required by a deadline (the first lines of the menu). Optional for older callers. */
  update?: TrayUpdate | null;
  /** Someone controls this computer (RC04): who, and whether it is paused. First in the menu while it lasts. */
  remoteControl: { controller: string; paused: boolean } | null;
  /** Website chats ringing for me (RING-43): listed first, with Join; the icon shows it. */
  webchatRinging: Array<{ id: number; label: string }>;
  /** Visitors' voice calls ringing for me (VOICE-10): first of all, with Answer. Optional for older callers. */
  webchatCalls?: Array<{ id: number; label: string }>;
  /** The website call this computer is on (VOICE-UI-03), with a way back to it. */
  webchatOnCall?: { conversationId: number; label: string; held: boolean } | null;
  /** Quick Ask's shortcut while it is registered, or null (AI Assistant). */
  quickAsk: string | null;
  /** Changes the assistant proposed that wait for a decision (DSK-5): opened in the main window, never confirmed here. */
  aiChanges: number;
  /** The catalogue ids of the apps the person may open (shared/access.ts): the menu offers nothing else. */
  apps: string[];
}

export interface TrayUpdate {
  kind: 'available' | 'ready' | 'required';
  version: string | null;
  /** A required update's install-by time (ISO). */
  deadline: string | null;
}

/** "Install by 18:00 · 02:14:37". */
function installBy(deadline: string, now: Date): string {
  const at = new Date(deadline);
  const left = Math.max(0, at.getTime() - now.getTime());
  const s = Math.floor(left / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sameDay = at.toDateString() === now.toDateString();
  const when = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `Install by ${sameDay ? when : `${at.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${when}`} · ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** The update lines at the top of the tray menu: "Update available: 2.7.0 · Update Now", or the required update's deadline. */
export function trayUpdateItems(u: TrayUpdate | null | undefined, a: Pick<TrayActions, 'updateNow'>, now = new Date()): MenuItemConstructorOptions[] {
  if (!u || !a.updateNow) return [];
  if (u.kind === 'required') {
    return [
      { label: '⚠ Update Required', enabled: false },
      ...(u.deadline ? [{ label: installBy(u.deadline, now), enabled: false }] : []),
      { label: 'Update & Restart', click: a.updateNow },
      { type: 'separator' },
    ];
  }
  if (!u.version) return [];
  return [{ label: u.kind === 'ready' ? `Update ready: ${u.version}` : `Update available: ${u.version}`, enabled: false }, { label: u.kind === 'ready' ? 'Restart to Update' : 'Update Now', click: a.updateNow }, { type: 'separator' }];
}

/** Quick Actions, each of its app: offered only to whoever may open that app. */
export const QUICK_ACTIONS: ReadonlyArray<{ app: string; label: string; route: string }> = [
  { app: 'tasks', label: 'New Task', route: '/tasks?new=1' },
  { app: 'mail', label: 'New Email', route: '/mail?compose=1' },
  { app: 'chat', label: 'Open Chat', route: '/chat' },
  { app: 'files', label: 'Upload File', route: '/files?upload=1' },
  { app: 'crm', label: 'New Lead', route: '/crm?new=1' },
];

export interface TrayActions {
  open: () => void;
  openRoute: (route: string) => void;
  clockIn: () => void;
  clockOut: () => void;
  pauseNotifications: (minutes: number | null) => void;
  openSettings: () => void;
  checkUpdates: () => void;
  /** The update lines' action: download, or restart to install. Optional for older callers. */
  updateNow?: () => void;
  quit: () => void;
  lock: () => void;
  pauseRemoteControl: () => void;
  stopRemoteControl: () => void;
  joinWebchat: (conversationId: number) => void;
  /** Answer a visitor's voice call (ENH-WCHAT-05). Optional for older callers. */
  answerWebchatCall?: (callId: number) => void;
  quickAsk: () => void;
  aiChanges: () => void;
  ringingSettings: () => void;
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
    badge: true,
    notificationsPausedUntil: null,
    attendance: null,
    updateReady: false,
    remoteControl: null,
    webchatRinging: [],
    webchatCalls: [],
    webchatOnCall: null,
    quickAsk: null,
    aiChanges: 0,
    apps: [],
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
    // Badge: what needs you — unread chat and unread notifications, the two counts
    // on the title bar (FR-TRAY-07). Not mail: its count is every unread message in
    // every inbox you can open, shared mailboxes included, which the sidebar shows
    // as information (indigo) and which put "99+" on the icon for anyone with a
    // busy shared inbox. The tray menu still says how much mail is unread.
    // On macOS the renderer paints it onto the Dock icon (core/dock-badge): an
    // unsigned build is never registered for notifications, and macOS will not
    // draw its badge.
    const hasChat = m.apps.includes('chat');
    const unread = attentionCount(hasChat ? m.unreadChat : 0, m.unreadOther);
    // A website chat ringing shows as something waiting for you, whatever else is going on (RING-43) — Chat's, so only with Chat.
    const ringing = m.signedIn && hasChat ? m.webchatRinging.length + (m.webchatCalls?.length ?? 0) : 0;
    const state = ringing ? 'unread' : trayState({ error: !!m.error, offline: m.offline && m.signedIn, monitoring: false, syncing: false, unread });
    try {
      app.setBadgeCount(m.signedIn && m.badge && process.platform !== 'darwin' ? unread : 0);
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
        unreadChat: hasChat ? m.unreadChat : 0,
        unreadMail: m.apps.includes('mail') ? m.unreadMail : 0,
        unreadOther: m.unreadOther,
      }),
    );
    if (process.platform === 'darwin') this.tray.setTitle(ringing ? ` ${ringing} ringing` : '');
    if (ringing) this.tray.setToolTip(m.webchatCalls?.length ? 'WorkSuite — a website visitor is calling' : `WorkSuite — ${ringing === 1 ? 'a website chat is' : `${ringing} website chats are`} ringing`);
    else if (m.signedIn && hasChat && m.webchatOnCall) this.tray.setToolTip(`WorkSuite — on a call with ${m.webchatOnCall.label}${m.webchatOnCall.held ? ' (on hold)' : ''}`);
    this.tray.setContextMenu(Menu.buildFromTemplate(trayMenu(m, this.actions)));
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

/**
 * The tray menu. Built from the apps the person may open, and again whenever
 * those change (a new bootstrap updates `apps`): no unread line for an app
 * they do not have, no quick action into one.
 */
export function trayMenu(m: TrayModel, a: TrayActions): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const has = (id: string) => m.apps.includes(id);
  if (m.remoteControl) {
    items.push({ label: `${m.remoteControl.controller} ${m.remoteControl.paused ? 'had control — paused' : 'is controlling this computer'}`, enabled: false });
    if (!m.remoteControl.paused) items.push({ label: 'Pause remote control', click: a.pauseRemoteControl });
    items.push({ label: 'Stop remote control', click: a.stopRemoteControl });
    items.push({ type: 'separator' });
  }
  // A visitor calling, and the call I am on (ENH-WCHAT-05): first of all.
  if (m.signedIn && has('chat') && m.webchatCalls?.length) {
    items.push({ label: m.webchatCalls.length === 1 ? 'Voice call ringing' : `${m.webchatCalls.length} voice calls ringing`, enabled: false });
    for (const c of m.webchatCalls.slice(0, 3)) items.push({ label: `Answer — ${c.label}`, click: () => a.answerWebchatCall?.(c.id) });
    items.push({ type: 'separator' });
  }
  if (m.signedIn && has('chat') && m.webchatOnCall) {
    const call = m.webchatOnCall;
    items.push({ label: `On a call with ${call.label}${call.held ? ' · on hold' : ''}`, enabled: false });
    items.push({ label: 'Return to the call', click: () => a.openRoute(`/chat?view=website&website=${call.conversationId}`) });
    items.push({ type: 'separator' });
  }
  // Website chats are Chat's: rung, listed and joined only for somebody who has it.
  if (m.signedIn && has('chat') && m.webchatRinging.length) {
    items.push({ label: m.webchatRinging.length === 1 ? 'Website chat ringing' : `${m.webchatRinging.length} website chats ringing`, enabled: false });
    for (const c of m.webchatRinging.slice(0, 5)) items.push({ label: `Join — ${c.label}`, click: () => a.joinWebchat(c.id) });
    items.push({ label: 'Open Website Chats', click: () => a.openRoute('/chat?view=website') });
    items.push({ label: 'Ringing settings…', click: a.ringingSettings });
    items.push({ type: 'separator' });
  }
  if (m.signedIn) {
    items.push({ label: [m.userName, m.organization].filter(Boolean).join(' · ') || 'WorkSuite', enabled: false });
    items.push({ type: 'separator' });
  }
  items.push(...trayUpdateItems(m.update, a));
  items.push({ label: 'Open WorkSuite', click: a.open });
  if (m.signedIn && m.quickAsk && has('ai')) items.push({ label: 'Quick Ask', accelerator: m.quickAsk, registerAccelerator: false, click: a.quickAsk });
  if (m.signedIn && m.aiChanges > 0 && has('ai')) items.push({ label: m.aiChanges === 1 ? 'A change from the assistant is waiting' : `${m.aiChanges} changes from the assistant are waiting`, click: a.aiChanges });
  if (m.signedIn) {
    const unread = [
      has('chat') ? { label: `Unread Chat ${m.unreadChat}`, n: m.unreadChat, route: '/chat' } : null,
      has('mail') ? { label: `Unread Mail ${m.unreadMail}`, n: m.unreadMail, route: '/mail' } : null,
    ].filter((x) => x !== null);
    if (unread.length) {
      const most = unread.reduce((x, y) => (y.n > x.n ? y : x));
      items.push({ label: unread.map((u) => u.label).join(' · '), click: () => a.openRoute(most.route) });
    }
    items.push({ type: 'separator' });
    if (m.attendance?.linked) {
      items.push(
        m.attendance.clockedIn
          ? { label: `Clock Out${m.attendance.since ? ` (in since ${m.attendance.since})` : ''}`, click: a.clockOut }
          : { label: 'Start Work / Clock In', click: a.clockIn },
      );
    }
    const quick = QUICK_ACTIONS.filter((q) => has(q.app));
    if (quick.length) items.push({ label: 'Quick Actions', submenu: quick.map((q) => ({ label: q.label, click: () => a.openRoute(q.route) })) });
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
