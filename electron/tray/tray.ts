import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage, type Rectangle } from 'electron';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { attentionCount, trayState, trayTooltip, type TrayState } from '@shared/network';
import { logger } from '../main/log';
import { liveTitle } from '../services/live-desk';
import type { SupportPulseFigures } from '../services/support-desk';
import type { TrayMarketing } from '../services/marketing-pulse';
import type { TrayAssets } from '@shared/assets';
import type { TrayMeet } from '../services/meet-next';
import type { TrayMeetings } from '../services/meetings-desk';
import { NEXT_CONTACT_LABEL } from '../services/marketing-shortcut';
import { clockOf, hhmm as hm, stampMs, targetLabel, type ProjectTimerState, type TimerTarget } from '@shared/projects';
import { inboxRoute, mailTooltip, type PauseMode, type TrayMailAccount } from '@shared/mail-alerts';

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
  /** Support tickets needing me (the desk's count), and the unread notifications about them it stands for (FR-DSK-04). */
  unreadSupport?: number;
  unreadSupportNotices?: number;
  /** Off: no count on the app's icon (Settings › Notifications). */
  badge: boolean;
  notificationsPausedUntil: string | null;
  attendance: { linked: boolean; clockedIn: boolean; since: string | null } | null;
  updateReady: boolean;
  /** A newer version: on offer, ready, or required by a deadline (the first lines of the menu). Optional for older callers. */
  update?: TrayUpdate | null;
  /** Someone controls this computer (RC04): who, and whether it is paused. First in the menu while it lasts. */
  remoteControl: { controller: string; paused: boolean } | null;
  /** Website chats ringing for me (RING-43): listed first, with Join; the icon shows it. Silenced ones are not on the badge. */
  webchatRinging: Array<{ id: number; label: string; silenced?: boolean }>;
  /** Visitors' voice calls ringing for me (VOICE-10): first of all, with Answer. Optional for older callers. */
  webchatCalls?: Array<{ id: number; label: string }>;
  /** The website call this computer is on (VOICE-UI-03), with a way back to it. */
  webchatOnCall?: { conversationId: number; label: string; held: boolean } | null;
  /** Quick Ask's shortcut while it is registered, or null (AI Assistant). */
  quickAsk: string | null;
  /**
   * Sinhala Tools' "Convert clipboard to Unicode" (blueprint WF-SI-04), with its key while it is held; null (or absent)
   * while the organisation does not have the tools. Optional for older callers.
   */
  sinhala?: { shortcut: string | null } | null;
  /** Changes the assistant proposed that wait for a decision (DSK-5): opened in the main window, never confirmed here. */
  aiChanges: number;
  /** The catalogue ids of the apps the person may open (shared/access.ts): the menu offers nothing else. */
  apps: string[];
  /**
   * The Live dashboard's figures for website staff (L-04, L-05; MAP-22): on the sites now, and whether somebody is at
   * risk. The menu bar then reads "18 · 2 waiting" — waiting on me, as the badge counts it (MAP-25) — red while one is
   * at risk, and a click opens the mini-dashboard. Null for anybody else, or before the first answer.
   */
  live?: { online: number; atRisk: boolean } | null;
  /**
   * The support desk's mini dashboard (WS-SUPPORT-SRS-001 D-05): my numbers, the next SLAs due and my availability,
   * for whoever has Support (support-desk.ts). A breached SLA among mine puts the red dot on the icon. Null before
   * the first answer, or for anybody else.
   */
  support?: SupportPulseFigures | null;
  /** The quick-reply shortcut while it is registered (⌃⌥R), or null. */
  supportShortcut?: string | null;
  /**
   * Marketing's counts (WS-MKT-SRS-001 MKT-DSK-01, the D01 tray): my call queue, today's callbacks, the campaigns
   * sending now. Null for anybody with nothing to show, or before the server answers. Optional for older callers.
   */
  marketing?: TrayMarketing | null;
  /** Assets (D03): what waits for me — handovers to confirm, loans overdue, approvals. Null: no Assets lines. */
  assets?: TrayAssets | null;
  /** Meet's lines (WS-MEET-ENH-01 D04): the next meeting to join, and whether this computer is in one. Null: no Meet lines. */
  meet?: TrayMeet | null;
  /** Meetings' lines (Meetings D07): today's meetings and the invitations waiting. Null: no Meetings lines. */
  meetings?: TrayMeetings | null;
  /** Each shortcut's key as a menu shows it, by command id: shown beside a line, never registered here. */
  shortcutLabels?: Record<string, string>;
  /**
   * The Projects timer (PRJ-DSK-02, D02): what runs, Switch to, today's and this week's totals. Null or unavailable
   * for anybody without Projects. Optional for older callers.
   */
  projectTimer?: ProjectTimerState | null;
  /**
   * Mail's lines (ENH-MAIL-05 D28): unread per included account (a sign-in problem said instead of a count), New
   * email, and Pause mail alerts with its choices. Null or absent: the plain "Unread Mail" count only.
   */
  mail?: TrayMail | null;
  /** The included inboxes' unread, on the badge with the rest (MNA-TRY-03), and the bell's mail entries it stands for. */
  mailBadge?: number;
  mailNotices?: number;
  /**
   * Orders waiting on an approval decision I may make (WS-OMS-SRS-001 FR-DSK-05, the server's shared queue), and the
   * unread bell entries about them it stands for: on the badge once, and a line in the menu that opens the queue.
   */
  salesApprovals?: number;
  salesNotices?: number;
  /** Purchase documents waiting on my decision (SRS-PUR-001 G-21), and their unread bell entries (counted once). */
  purchaseApprovals?: number;
  purchaseNotices?: number;
  /** The status chosen (Chat's presence: available, away, busy, dnd, offline), for the status line. Optional. */
  presence?: string | null;
}

export interface TrayMail {
  accounts: TrayMailAccount[];
  unread: number;
  /** Pop-ups and sounds held now, and how it reads ("Paused until 11:42"). */
  paused: boolean;
  pauseLabel: string | null;
  /** A pause is set, even when it is not holding anything now (outside working hours, during them). */
  pauseSet: boolean;
  choices: Array<{ mode: PauseMode; label: string; detail: string }>;
  /** Why Outside working hours is missing. */
  hoursNote: string | null;
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

/** A title that fits a menu line. */
const short = (s: string): string => (s.length > 46 ? `${s.slice(0, 45)}…` : s);

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
  /** Sinhala Tools: the clipboard converted to Unicode. Optional for older callers. */
  sinhalaClipboard?: () => void;
  /** Meet's tray lines (WS-MEET-ENH-01 D04). Optional for older callers. */
  meetJoinNext?: () => void;
  meetStart?: () => void;
  meetShare?: () => void;
  /** Mute or unmute, and the camera — the same actions the global keys press. */
  meetMute?: () => void;
  meetCamera?: () => void;
  /** One of today's meetings (Meetings D07): joined when it can be, else its details. Optional for older callers. */
  meetingOpen?: (id: number) => void;
  ringingSettings: () => void;
  /**
   * The ringing menu with its reply box (R-06, UX-ALR-02), by the tray icon (`anchor`, or null where it is not known):
   * whether it opened. Optional for older callers, which keep the plain menu.
   */
  showRingMenu?: (anchor: Rectangle | null) => boolean;
  /** Open Live dashboard (⌘⇧D) and Show Live map window (⌘⇧M), for website staff (L-05, MAP-21/22). */
  liveDashboard?: () => void;
  liveMap?: () => void;
  /** Support (D-05): a ticket's quick-reply window, the latest ticket's, and Online / Away. Optional for older callers. */
  supportQuickReply?: (ticketId: number) => void;
  supportQuickLatest?: () => void;
  supportPresence?: (status: 'available' | 'away') => void;
  /** The status line's choices (worksuite-desktop#346): Chat's presence, sent to the server at once. Optional for older callers. */
  setPresence?: (status: 'available' | 'away' | 'busy' | 'dnd' | 'offline') => void;
  /** Marketing's Next contact (⌘⇧N / Ctrl+Shift+N from other apps): My call queue's workspace, on the next contact. */
  marketingNextContact?: () => void;
  /** The Projects timer's Stop, Switch to (one click: what runs stops, the other starts), Resume and the mini timer. */
  projectTimerStop?: () => void;
  projectTimerSwitch?: (t: TimerTarget) => void;
  projectTimerResume?: () => void;
  projectTimerWindow?: () => void;
  /** Pause mail alerts (a choice), or resume them (null). Optional for older callers. */
  mailPause?: (mode: PauseMode | null) => void;
}

/** The note under the pause choices (D28). */
export const MAIL_PAUSE_NOTE = 'Mail still syncs. Unread counts keep updating; only pop-ups and sounds stop.';

/**
 * Mail's lines (ENH-MAIL-05 D28, MNA-TRY-01/02): the connection and whether mail alerts are on, unread per account —
 * an account whose sign-in failed says "Sign-in needed" instead, with a warning sign, as a menu cannot be red — New
 * email, and Pause mail alerts › For 1 hour, Until tomorrow 08:00, Outside working hours (only with the person's
 * working hours from HR), Until I turn them on. Only for somebody who has Mail.
 */
export function trayMailItems(m: Pick<TrayModel, 'signedIn' | 'apps' | 'mail' | 'offline'>, a: Pick<TrayActions, 'openRoute' | 'mailPause'>): MenuItemConstructorOptions[] {
  const mail = m.mail;
  if (!m.signedIn || !m.apps.includes('mail') || !mail) return [];
  const items: MenuItemConstructorOptions[] = [];
  const alerts = mail.paused || mail.pauseSet ? `mail alerts ${(mail.pauseLabel ?? 'Paused').replace(/^Paused/, 'paused')}` : 'mail alerts on';
  items.push({ label: `${m.offline ? 'Offline' : 'Connected'} · ${alerts}`, enabled: false });
  if (mail.accounts.length) {
    items.push({ label: 'Unread mail', enabled: false });
    for (const acct of mail.accounts.slice(0, 8)) {
      items.push(
        acct.problem
          ? { label: `${short(acct.label)} — ⚠ Sign-in needed`, click: () => a.openRoute('/settings/mail?tab=accounts') }
          : { label: `${short(acct.label)} — ${acct.unread}`, click: () => a.openRoute(inboxRoute(acct.id)) },
      );
    }
  }
  items.push({ label: 'New email', accelerator: 'CmdOrCtrl+N', registerAccelerator: false, click: () => a.openRoute('/mail?compose=1') });
  if (a.mailPause) {
    const pause = a.mailPause;
    const submenu: MenuItemConstructorOptions[] = mail.choices.map((c) => ({ label: c.detail ? `${c.label} (${c.detail})` : c.label, click: () => pause(c.mode) }));
    if (mail.hoursNote) submenu.push({ label: mail.hoursNote, enabled: false });
    submenu.push({ type: 'separator' }, { label: MAIL_PAUSE_NOTE, enabled: false });
    if (mail.pauseSet) submenu.push({ type: 'separator' }, { label: 'Resume mail alerts', click: () => pause(null) });
    items.push({ label: mail.pauseSet ? `Mail alerts: ${mail.pauseLabel ?? 'Paused'}` : 'Pause mail alerts', submenu });
  }
  items.push({ type: 'separator' });
  return items;
}

/** The tooltip's words with Mail's lines (D28): "WorkSuite — 6 unread emails", what else waits, and a pause. */
export function trayMailTooltip(base: string, m: Pick<TrayModel, 'mail' | 'unreadChat' | 'apps'>): string {
  const mail = m.mail;
  if (!mail || !m.apps.includes('mail')) return base;
  const head = mailTooltip(mail.unread);
  const extra = base.replace(/^WorkSuite — /, '').split(' · ').filter((p) => p && !/^\d+ unread \(/.test(p) && p !== 'all up to date');
  const chat = m.apps.includes('chat') && m.unreadChat ? `${m.unreadChat} unread chat${m.unreadChat === 1 ? '' : 's'}` : null;
  const paused = mail.paused ? `mail alerts ${(mail.pauseLabel ?? 'Paused').replace(/^Paused/, 'paused')}` : null;
  return [head, chat, ...extra, paused].filter(Boolean).join(' · ');
}

/**
 * The Projects timer's lines (D02): "● TSK-0412 · Bidder KYC document upload — 1:12", Stop, Show mini timer, Switch to
 * (each a click: the running timer stops and that one starts), "Today 6:40 · This week 31:15" and Open timesheet.
 * With nothing running: Resume (after a pause) and Start timer on… the same recent work. Only for somebody with
 * Projects whose server answered. The menu is rebuilt each minute, so the time here moves a minute at a time; the
 * mini timer and the title bar show the seconds.
 */
export function trayProjectItems(m: Pick<TrayModel, 'signedIn' | 'apps' | 'projectTimer'>, a: Pick<TrayActions, 'openRoute' | 'projectTimerStop' | 'projectTimerSwitch' | 'projectTimerResume' | 'projectTimerWindow'>, now = Date.now()): MenuItemConstructorOptions[] {
  const t = m.projectTimer;
  if (!m.signedIn || !m.apps.includes('projects') || !t?.available || !a.projectTimerSwitch) return [];
  const items: MenuItemConstructorOptions[] = [];
  const r = t.running;
  const ran = (x: { startedAt: string }) => Math.max(0, Math.floor((now - (stampMs(x.startedAt) ?? now)) / 1000));
  if (r) {
    const label = targetLabel(r);
    items.push({ label: `Timer running${r.billable ? ' · billable' : ''}`, enabled: false });
    items.push({ label: `● ${short(label)} — ${clockOf(ran(r)).replace(/:\d\d$/, '')}`, sublabel: r.task && r.project ? [r.projectCode, r.project].filter(Boolean).join(' ') : undefined, click: () => a.projectTimerWindow?.() });
    if (a.projectTimerStop) items.push({ label: 'Stop timer', click: a.projectTimerStop });
    if (a.projectTimerWindow) items.push({ label: 'Show mini timer', click: a.projectTimerWindow });
  } else if (t.paused && a.projectTimerResume) {
    items.push({ label: `Resume — ${short(t.paused.label)}`, click: a.projectTimerResume });
  }
  if (t.recent.length) {
    const sw = a.projectTimerSwitch;
    items.push({
      label: r ? 'Switch to' : 'Start timer on',
      enabled: !t.offline,
      submenu: t.recent.map((x) => ({ label: `${x.number ? `${x.number} ` : ''}${short(x.title)}${x.minutes ? `  ${hm(x.minutes)}` : ''}`, click: () => sw({ taskId: x.taskId, projectId: x.projectId }) })),
    });
  }
  const running = r ? Math.floor(ran(r) / 60) : 0;
  items.push({ label: `Today ${hm(t.todayMinutes + running)} · This week ${hm(t.weekMinutes + running)}`, enabled: false });
  items.push({ label: 'Open timesheet', click: () => a.openRoute('/projects/time') });
  items.push({ type: 'separator' });
  return items;
}

/**
 * Marketing's lines (MKT-DSK-01, the D01 tray): "Call queue waiting 38" and "Callbacks today 9" open My call queue
 * and its callbacks, "Sending now 1 · 62%" says how far the campaigns sending now have got, and "Next contact" takes
 * the next contact — its key shown, not registered here (main holds it while WorkSuite is not in front). The queue's
 * lines only for somebody with a call queue, all of it only for somebody who has Marketing.
 */
/** Assets' tray lines (D03): what waits, the scan station, my equipment and reporting a problem with it. */
export function trayAssetsItems(m: Pick<TrayModel, 'signedIn' | 'apps' | 'assets'>, a: Pick<TrayActions, 'openRoute'>): MenuItemConstructorOptions[] {
  if (!m.signedIn || !m.apps.includes('assets') || !m.assets) return [];
  return [
    ...(m.assets.waiting > 0 ? [{ label: `${m.assets.waiting} waiting for you`, click: () => a.openRoute('/assets?tab=dashboard') }] : []),
    { label: 'Open scan station', click: () => a.openRoute('/assets?tab=scan') },
    { label: 'My equipment', click: () => a.openRoute('/assets?tab=mine') },
    { label: 'Report a problem with my equipment', click: () => a.openRoute('/assets?tab=mine&problem=1') },
  ];
}

export function trayMarketingItems(m: Pick<TrayModel, 'signedIn' | 'apps' | 'marketing'>, a: Pick<TrayActions, 'openRoute' | 'marketingNextContact'>): MenuItemConstructorOptions[] {
  const mk = m.marketing;
  if (!m.signedIn || !m.apps.includes('marketing') || !mk) return [];
  const items: MenuItemConstructorOptions[] = [];
  if (mk.queueWaiting !== null) items.push({ label: `Call queue waiting ${mk.queueWaiting}`, click: () => a.openRoute('/marketing?view=queue') });
  if (mk.callbacksToday !== null) items.push({ label: `Callbacks today ${mk.callbacksToday}`, click: () => a.openRoute('/marketing?view=queue&tab=callbacks') });
  if (mk.sending) items.push({ label: `Sending now ${mk.sending.count} · ${mk.sending.pct}%`, enabled: false });
  if (mk.queueWaiting !== null && a.marketingNextContact) items.push({ label: 'Next contact', accelerator: NEXT_CONTACT_LABEL, registerAccelerator: false, click: a.marketingNextContact });
  if (items.length) items.push({ type: 'separator' });
  return items;
}

/**
 * Meet's lines (WS-MEET-ENH-01 D04, the tray the artboard draws).
 *
 * "Join next: Weekly design review" when there is something to join, Start
 * instant meeting and Share screen always, and mute and the camera only while
 * this computer is in a meeting — a mute line with nothing to mute is worse
 * than no line. Each key is shown but not registered here: the main process
 * holds the global ones and only while they can act (`meet-keys.ts`).
 *
 * The artboard also draws Do not disturb in this section. It is not repeated
 * here: WorkSuite already has one, further down the same menu, and two
 * switches for one setting is how they come to disagree.
 */
export function trayMeetItems(
  m: Pick<TrayModel, 'signedIn' | 'apps' | 'meet'>,
  a: Pick<TrayActions, 'openRoute' | 'meetJoinNext' | 'meetStart' | 'meetShare' | 'meetMute' | 'meetCamera'>,
  keys: Record<string, string> = {},
): MenuItemConstructorOptions[] {
  const meet = m.meet;

  if (!m.signedIn || !m.apps.includes('meet') || !meet) return [];

  const items: MenuItemConstructorOptions[] = [];
  const key = (id: string): Partial<MenuItemConstructorOptions> => (keys[id] ? { accelerator: keys[id], registerAccelerator: false } : {});

  if (meet.next && a.meetJoinNext) items.push({ label: `Join next: ${short(meet.next.title)}`, ...key('meet-join-next'), click: a.meetJoinNext });
  if (a.meetStart) items.push({ label: 'Start instant meeting', ...key('meet-new'), click: a.meetStart });
  if (a.meetShare) items.push({ label: 'Share screen', ...key('meet-share-screen'), click: a.meetShare });

  if (meet.inCall) {
    items.push({ type: 'separator' });
    if (a.meetMute) items.push({ label: 'Mute microphone', ...key('meet-mute'), click: a.meetMute });
    if (a.meetCamera) items.push({ label: 'Turn camera on or off', ...key('meet-camera'), click: a.meetCamera });
  }

  if (items.length) {
    items.push({ label: 'Meet settings…', click: () => a.openRoute('/settings?section=meet') });
    items.push({ type: 'separator' });
  }

  return items;
}

/**
 * Meetings' lines (Meetings D07, the tray the design draws): "Today", then each of today's meetings — "09:30  Daily
 * stand-up — Live", "11:00  Acme Lanka — Q4 review — Join" — each joining when it can be joined and opening its
 * details otherwise; "3 invitations waiting — Answer", and Open Meetings. Only for somebody who has Meetings.
 */
export function trayMeetingsItems(m: Pick<TrayModel, 'signedIn' | 'apps' | 'meetings'>, a: Pick<TrayActions, 'openRoute' | 'meetingOpen'>): MenuItemConstructorOptions[] {
  const mt = m.meetings;
  if (!m.signedIn || !m.apps.includes('meetings') || !mt) return [];
  const items: MenuItemConstructorOptions[] = [{ label: 'Today', enabled: false }];
  for (const x of mt.today.slice(0, 8)) {
    const tail = x.live ? ' — Live' : x.join ? ' — Join' : '';
    items.push({ label: `${x.time}  ${short(x.title)}${tail}`, click: () => (a.meetingOpen ? a.meetingOpen(x.id) : a.openRoute(`/meetings?meeting=${x.id}`)) });
  }
  if (!mt.today.length) items.push({ label: 'No more meetings today', enabled: false });
  if (mt.waiting) items.push({ type: 'separator' }, { label: `${mt.waiting === 1 ? '1 invitation' : `${mt.waiting} invitations`} waiting — Answer`, click: () => a.openRoute('/meetings?tab=invitations') });
  items.push({ type: 'separator' }, { label: 'Open Meetings', click: () => a.openRoute('/meetings') }, { type: 'separator' });
  return items;
}

/** The Meetings section's line: what is live, or what is next today, or the invitations waiting. */
export function meetingsSummary(mt: TrayMeetings): string {
  const live = mt.today.find((x) => x.live);
  if (live) return fit(`Meetings · live: ${live.title}`);
  const next = mt.today[0];
  if (next) return fit(`Meetings · ${next.time} ${next.title}`);
  return mt.waiting ? `Meetings · ${mt.waiting} waiting` : 'Meetings';
}

/**
 * What is ringing for me and not silenced (R-05, R-06; RING-44): it goes on the app's badge beside what is unread,
 * until joined or silenced.
 */
export function ringingCount(m: Pick<TrayModel, 'signedIn' | 'apps' | 'webchatRinging' | 'webchatCalls'>): number {
  if (!m.signedIn || !m.apps.includes('chat')) return 0;
  return m.webchatRinging.filter((c) => !c.silenced).length + (m.webchatCalls?.length ?? 0);
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources');
}

/** `colour`: the menu-bar icon in colour rather than as a template — its red dot showing while one is at risk (MAP-22). */
function icon(state: TrayState, colour = false): NativeImage {
  const dir = join(resourcesDir(), 'tray');
  if (process.platform === 'darwin' && !colour) {
    const img = nativeImage.createFromPath(join(dir, `${state}Template.png`));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(join(dir, `${state}.png`));
}

/**
 * Whether this Linux desktop shows tray icons (worksuite-desktop#346). Electron's tray on Linux is a
 * StatusNotifierItem: on GNOME without the AppIndicator extension nothing hosts it, the icon never appears, and
 * Electron says nothing. Asks the session bus whether a StatusNotifierWatcher is running; null when it cannot ask.
 */
export function indicatorHostRunning(exec: typeof execFile = execFile): Promise<boolean | null> {
  return new Promise((resolve) => {
    exec('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher'], { timeout: 3000 }, (err, out) => {
      if (err) return resolve(null);
      resolve(/true/.test(String(out)));
    });
  });
}

/** What to tell somebody whose desktop shows no tray icon, once. */
export const NO_TRAY_HINT =
  'Your desktop is not showing tray icons, so the WorkSuite icon is hidden. On Ubuntu, install the AppIndicator extension: sudo apt install gnome-shell-extension-appindicator, then sign out and in. Until then, right-click WorkSuite in the dock for Open WorkSuite.';

/** The menu is rebuilt at most this often (worksuite-desktop#346). */
export const MENU_EVERY_MS = 2_000;

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
  private lastState: string | null = null;
  /** The menu, kept to pop up on a right-click while a click opens the ringing menu (macOS, R-06). */
  private menu: Menu | null = null;
  private menuTimer: NodeJS.Timeout | null = null;
  private lastMenuAt = 0;

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
    // While chats ring — or always, for website staff, as the Live mini-dashboard (L-05, MAP-22) — a click opens the
    // menu with its reply box (R-06, UX-ALR-02); otherwise it opens WorkSuite (Windows, Linux) or shows the menu (macOS).
    this.tray.on('click', (_e, bounds) => {
      if (this.ringMenu(bounds)) return;
      if (process.platform !== 'darwin') this.actions.open();
    });
    if (process.platform === 'darwin') this.tray.on('right-click', () => this.menu && this.tray?.popUpContextMenu(this.menu));
    this.render();
  }

  /** Opens the ringing menu by the icon, when something rings and the app has one: whether it did. */
  private ringMenu(bounds: Rectangle | undefined): boolean {
    const m = this.model;
    if (!this.actions.showRingMenu || !m.signedIn || !m.apps.includes('chat') || (!m.webchatRinging.length && !m.live)) return false;
    return this.actions.showRingMenu(bounds && bounds.width > 0 ? bounds : (this.tray?.getBounds() ?? null));
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
    const hasSupport = m.apps.includes('support');
    const hasMail = m.apps.includes('mail');
    const hasSales = m.apps.includes('sales');
    const hasPurchase = m.apps.includes('purchase');
    const unread = attentionCount(hasChat ? m.unreadChat : 0, m.unreadOther, hasSupport ? (m.unreadSupport ?? 0) : 0, hasSupport ? (m.unreadSupportNotices ?? 0) : 0, hasMail ? (m.mailBadge ?? 0) : 0, hasMail ? (m.mailNotices ?? 0) : 0, (hasSales ? (m.salesApprovals ?? 0) : 0) + (hasPurchase ? (m.purchaseApprovals ?? 0) : 0), (hasSales ? (m.salesNotices ?? 0) : 0) + (hasPurchase ? (m.purchaseNotices ?? 0) : 0));
    // A website chat ringing shows as something waiting for you, whatever else is going on (RING-43) — Chat's, so only with Chat.
    const ringing = m.signedIn && hasChat ? m.webchatRinging.length + (m.webchatCalls?.length ?? 0) : 0;
    const state = ringing ? 'unread' : trayState({ error: !!m.error, offline: m.offline && m.signedIn, monitoring: false, syncing: false, unread });
    try {
      // Ringing chats count too, until joined or silenced (R-05/R-06 dock and taskbar badge; RING-44).
      app.setBadgeCount(m.signedIn && m.badge && process.platform !== 'darwin' ? unread + ringingCount(m) : 0);
    } catch {
      /* not supported on this desktop */
    }
    if (!this.tray) return;
    // Red while somebody is at risk (MAP-22): the icon's red dot in colour in the menu bar.
    const live = m.signedIn && hasChat ? (m.live ?? null) : null;
    // Red, too, while one of my support tickets has missed its SLA (D-05's badge rule).
    const red = !!live?.atRisk || (m.signedIn && hasSupport && !!m.support?.breached);
    const look = red ? `${ringing ? 'unread' : state}:red` : state;
    if (look !== this.lastState) {
      this.tray.setImage(icon(red ? 'unread' : state, red));
      this.lastState = look;
    }
    this.tray.setToolTip(
      trayMailTooltip(trayTooltip({
        error: m.error,
        offline: m.offline && m.signedIn,
        pending: m.pending,
        monitoring: null,
        syncing: 0,
        unreadChat: hasChat ? m.unreadChat : 0,
        unreadMail: m.apps.includes('mail') ? m.unreadMail : 0,
        unreadOther: m.unreadOther,
        unreadSupport: hasSupport ? (m.unreadSupport ?? 0) : 0,
      }), m),
    );
    // "18 · 2 waiting" for website staff (MAP-UI-04): on the sites, and waiting on me as the badge counts them (MAP-25).
    // The Projects timer while it runs (D02's menu bar "1:12"), after what rings and the Live figures.
    const timer = m.signedIn && m.apps.includes('projects') && m.projectTimer?.running ? clockOf(Math.max(0, (Date.now() - (stampMs(m.projectTimer.running.startedAt) ?? Date.now())) / 1000)).replace(/:\d\d$/, '') : '';
    if (process.platform === 'darwin') this.tray.setTitle(live ? ` ${liveTitle(live.online, ringingCount(m))}` : ringing ? ` ${ringing} ringing` : timer ? ` ${timer}` : '');
    if (live && !ringing) this.tray.setToolTip(`WorkSuite — ${live.online === 1 ? '1 visitor' : `${live.online} visitors`} on your sites${live.atRisk ? ' · somebody is at risk' : ''}`);
    if (ringing) this.tray.setToolTip(m.webchatCalls?.length ? 'WorkSuite — a website visitor is calling' : `WorkSuite — ${ringing === 1 ? 'a website chat is' : `${ringing} website chats are`} ringing`);
    else if (m.signedIn && hasChat && m.webchatOnCall) this.tray.setToolTip(`WorkSuite — on a call with ${m.webchatOnCall.label}${m.webchatOnCall.held ? ' (on hold)' : ''}`);
    this.scheduleMenu();
  }

  /**
   * The menu is built again and handed over again on every change (worksuite-desktop#346): on Ubuntu the tray is an
   * AppIndicator, which never sees a change made to a menu it already has. At most once every two seconds, so a burst
   * of messages does not make the open menu flicker; the first change after a quiet spell shows at once.
   */
  private scheduleMenu(): void {
    if (this.menuTimer) return;
    const wait = Math.max(0, this.lastMenuAt + MENU_EVERY_MS - Date.now());
    if (wait === 0) return this.buildMenu();
    this.menuTimer = setTimeout(() => {
      this.menuTimer = null;
      this.buildMenu();
    }, wait);
    this.menuTimer.unref?.();
  }

  private buildMenu(): void {
    if (!this.tray) return;
    this.lastMenuAt = Date.now();
    const m = this.model;
    const ringing = m.signedIn && m.apps.includes('chat') ? m.webchatRinging.length + (m.webchatCalls?.length ?? 0) : 0;
    const live = m.signedIn && m.apps.includes('chat') ? (m.live ?? null) : null;
    this.menu = Menu.buildFromTemplate(trayMenu(m, this.actions));
    // On macOS a menu set on the icon opens on every click: while chats ring, the click opens the ringing menu and a
    // right-click this one (R-06).
    const popover = process.platform === 'darwin' && !!this.actions.showRingMenu && ((ringing > 0 && m.webchatRinging.length > 0) || !!live);
    this.tray.setContextMenu(popover ? null : this.menu);
  }

  destroy(): void {
    if (this.menuTimer) clearTimeout(this.menuTimer);
    this.menuTimer = null;
    this.tray?.destroy();
    this.tray = null;
  }
}

/** The statuses the tray offers: Chat's presence, which website chats and Support route by (MyStatus.tsx). */
export const TRAY_STATUSES: ReadonlyArray<{ id: 'available' | 'away' | 'busy' | 'dnd' | 'offline'; label: string }> = [
  { id: 'available', label: 'Online' },
  { id: 'away', label: 'Away' },
  { id: 'busy', label: 'Busy' },
  { id: 'dnd', label: 'Do not disturb' },
  { id: 'offline', label: 'Appear offline' },
];

/** About 40 characters at most: a long name or organisation is cut with an ellipsis rather than widening the menu. */
export function fit(s: string, max = 40): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** "Dimuthu Anuraj · Livezen Technologies", the organisation shortened first. */
export function headerLabel(name: string | null, org: string | null): string {
  if (!name && !org) return 'WorkSuite';
  if (!org) return fit(name!);
  if (!name) return fit(org);
  const room = Math.max(12, 40 - name.length - 3);
  return fit(`${name} · ${fit(org, room)}`, 44);
}

/** The status line: "● Away", or the connection while it is down — "○ Offline · reconnecting". */
export function statusLabel(m: Pick<TrayModel, 'offline' | 'pending' | 'support' | 'presence'>): string {
  if (m.offline) return m.pending > 0 ? `○ Offline · ${m.pending} waiting to send` : '○ Offline · reconnecting';
  const p = m.presence ?? m.support?.presence ?? null;
  const name = TRAY_STATUSES.find((s) => s.id === p)?.label;
  return name ? `● ${name}` : '● Online';
}

/** Support's one summary: the most important non-zero count, a warning only when something is overdue. */
export function supportSummary(f: SupportPulseFigures): string {
  if (f.breached || (f.overdue ?? 0) > 0) return `Support · ${f.overdue ?? f.atRisk} overdue ⚠`;
  if ((f.unassigned ?? 0) > 0) return `Support · ${f.unassigned} unassigned`;
  if (f.atRisk > 0) return `Support · ${f.atRisk} at risk`;
  if (f.open > 0) return `Support · ${f.open} open`;
  return 'Support · all clear';
}

export function callsSummary(mk: TrayMarketing): string {
  if ((mk.queueWaiting ?? 0) > 0) return `Calls · ${mk.queueWaiting} waiting`;
  if ((mk.callbacksToday ?? 0) > 0) return `Calls · ${mk.callbacksToday} callback${mk.callbacksToday === 1 ? '' : 's'} today`;
  if (mk.sending) return `Calls · sending ${mk.sending.pct}%`;
  return 'Calls · nothing waiting';
}

export function mailSummary(m: Pick<TrayModel, 'mail' | 'unreadMail'>): string {
  const mail = m.mail;
  if (mail?.accounts.some((x) => x.problem)) return 'Mail · ⚠ sign-in needed';
  const n = mail ? mail.unread : m.unreadMail;
  const alerts = mail?.paused ? ' · alerts paused' : '';
  return `Mail · ${n > 0 ? `${n} unread` : 'all read'}${alerts}`;
}

/** The lines of a section without its own separators and status lines: they sit in a submenu now. */
function inner(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const out = items.filter((i, n, all) => !(i.type === 'separator' && (n === 0 || n === all.length - 1 || all[n - 1]?.type === 'separator')));
  while (out.length && out[out.length - 1]!.type === 'separator') out.pop();
  return out;
}

/**
 * Keys beside a line are drawn on Windows and macOS only: AppIndicator (Ubuntu's tray) cannot right-align them, so on
 * Linux they would run into the label (worksuite-desktop#346).
 */
export function forPlatform(items: MenuItemConstructorOptions[], platform: NodeJS.Platform = process.platform): MenuItemConstructorOptions[] {
  if (platform !== 'linux') return items;
  return items.map(({ accelerator: _a, registerAccelerator: _r, ...i }) => ({ ...i, ...(Array.isArray(i.submenu) ? { submenu: forPlatform(i.submenu, platform) } : {}) }));
}

/** The longest the menu may grow before its end runs off a 768-pixel screen: detail goes into submenus. */
export const TRAY_TOP_LINES = 22;

/**
 * The tray menu (worksuite-desktop#346): about fifteen top-level lines on every screen, whatever the person has.
 *
 *   Name · Organisation                     (heading)
 *   ● Away ▸                                Online · Away · Busy · Do not disturb · Appear offline (· Clock in/out)
 *   Open WorkSuite · Quick Ask… · New ▸
 *   Chat · 11 unread ▸   Mail · 209 unread ▸   Support · 1 unassigned ▸   Calls · nothing waiting ▸
 *   Meet ▸   Timer ▸   Live ▸                (each only for whoever has it, with something to show)
 *   Pause notifications ▸ · Restart to update to 0.2.232 (only when one is ready)
 *   Settings… · Check for updates · Lock WorkSuite · Quit WorkSuite (always last)
 *
 * Each section is one line saying the most important thing (a warning only when something is overdue), with its
 * detail in a submenu. What rings or is happening now — someone controlling this computer, a visitor calling, a
 * website chat ringing — comes first while it lasts. Built from the apps the person may open: no line for an app they
 * do not have.
 */
export function trayMenu(m: TrayModel, a: TrayActions, now = new Date()): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const has = (id: string) => m.signedIn && m.apps.includes(id);
  const sep = (): void => {
    if (items.length && items[items.length - 1]!.type !== 'separator') items.push({ type: 'separator' });
  };

  // What is happening now, first while it lasts.
  if (m.remoteControl) {
    items.push({ label: fit(`${m.remoteControl.controller} ${m.remoteControl.paused ? 'had control — paused' : 'is controlling this computer'}`, 46), submenu: [...(m.remoteControl.paused ? [] : [{ label: 'Pause remote control', click: a.pauseRemoteControl }]), { label: 'Stop remote control', click: a.stopRemoteControl }] });
  }
  if (has('chat') && m.webchatCalls?.length) {
    for (const c of m.webchatCalls.slice(0, 2)) items.push({ label: fit(`Answer call — ${c.label}`), click: () => a.answerWebchatCall?.(c.id) });
  }
  if (has('chat') && m.webchatOnCall) {
    const call = m.webchatOnCall;
    items.push({ label: fit(`Return to call with ${call.label}${call.held ? ' · on hold' : ''}`), click: () => a.openRoute(`/chat?view=website&website=${call.conversationId}`) });
  }
  if (has('chat') && m.webchatRinging.length) {
    const ring = m.webchatRinging;
    items.push({
      label: ring.length === 1 ? `Website chat ringing — ${fit(ring[0]!.label, 24)}` : `${ring.length} website chats ringing`,
      submenu: [
        ...ring.slice(0, 5).map((c) => ({ label: fit(`Join — ${c.label}`), click: () => a.joinWebchat(c.id) })),
        ...(a.showRingMenu ? [{ label: 'Reply from here…', click: () => void a.showRingMenu?.(null) }] : []),
        { type: 'separator' as const },
        { label: 'Open Website Chats', click: () => a.openRoute('/chat?view=website') },
        { label: 'Ringing settings…', click: a.ringingSettings },
      ],
    });
  }
  sep();

  if (m.signedIn) {
    items.push({ label: headerLabel(m.userName, m.organization), enabled: false });
    const set = a.setPresence ?? (a.supportPresence ? (s: string) => (s === 'available' || s === 'away' ? a.supportPresence!(s) : undefined) : null);
    const current = m.presence ?? m.support?.presence ?? null;
    const statusMenu: MenuItemConstructorOptions[] = set
      ? TRAY_STATUSES.filter((s) => a.setPresence || s.id === 'available' || s.id === 'away').map((s) => ({ label: s.label, type: 'radio' as const, checked: current ? current === s.id : s.id === 'available', click: () => set(s.id) }))
      : [];
    if (m.attendance?.linked) {
      if (statusMenu.length) statusMenu.push({ type: 'separator' });
      statusMenu.push(m.attendance.clockedIn ? { label: `Clock out${m.attendance.since ? ` (in since ${m.attendance.since})` : ''}`, click: a.clockOut } : { label: 'Start work · clock in', click: a.clockIn });
    }
    items.push(statusMenu.length ? { label: statusLabel(m), submenu: statusMenu } : { label: statusLabel(m), enabled: false });
    sep();
  }

  items.push({ label: 'Open WorkSuite', click: a.open });
  if (has('ai') && m.quickAsk) items.push({ label: 'Quick Ask…', accelerator: m.quickAsk, registerAccelerator: false, click: a.quickAsk });
  if (m.signedIn && m.sinhala && a.sinhalaClipboard) {
    items.push({ label: 'Convert clipboard to Unicode', ...(m.sinhala.shortcut ? { accelerator: m.sinhala.shortcut, registerAccelerator: false } : {}), click: a.sinhalaClipboard });
  }
  if (has('ai') && m.aiChanges > 0) items.push({ label: m.aiChanges === 1 ? 'A change from the assistant waits' : `${m.aiChanges} changes from the assistant wait`, click: a.aiChanges });
  if (m.signedIn) {
    const create: MenuItemConstructorOptions[] = [
      ...(has('mail') ? [{ label: 'Email', click: () => a.openRoute('/mail?compose=1') }] : []),
      ...(has('chat') ? [{ label: 'Chat message', click: () => a.openRoute('/chat?new=1') }] : []),
      ...(has('meet') && a.meetStart ? [{ label: 'Meeting', click: a.meetStart }] : []),
      ...(has('tasks') ? [{ label: 'Task', click: () => a.openRoute('/tasks?new=1') }] : []),
      ...(has('notes') ? [{ label: 'Note', click: () => a.openRoute('/notes?new=1') }] : []),
      ...(has('crm') ? [{ label: 'Lead', click: () => a.openRoute('/crm?new=1') }] : []),
      ...(has('files') ? [{ label: 'Upload file', click: () => a.openRoute('/files?upload=1') }] : []),
    ];
    if (create.length) items.push({ label: 'New', submenu: create });
  }
  sep();

  // One line per section, its detail in a submenu.
  if (has('chat')) {
    items.push({
      label: `Chat · ${m.unreadChat > 0 ? `${m.unreadChat} unread` : 'all read'}`,
      submenu: [
        { label: 'Open Chat', click: () => a.openRoute('/chat') },
        { label: 'Website Chats', click: () => a.openRoute('/chat?view=website') },
      ],
    });
  }
  if (has('mail')) {
    const mailLines = inner(trayMailItems(m, a)).filter((i) => !(i.enabled === false && typeof i.label === 'string' && /^(Connected|Offline) · /.test(i.label)));
    items.push({ label: mailSummary(m), submenu: [{ label: 'Open Mail', click: () => a.openRoute('/mail') }, ...(mailLines.length ? [{ type: 'separator' as const }, ...mailLines] : [])] });
  }
  if (has('support') && m.support) {
    const lines = inner(supportItems(m.support, a, m.supportShortcut ?? null));
    items.push({ label: supportSummary(m.support), submenu: lines });
  } else if (has('support') && m.unreadSupport) {
    // Before the desk's figures arrive: the tickets waiting for me, from the badge's count.
    items.push({ label: `Support · ${m.unreadSupport} waiting`, submenu: [{ label: 'My tickets', click: () => a.openRoute('/support?view=mine') }, { label: 'Open Support', click: () => a.openRoute('/support') }] });
  }
  // Orders waiting on my approval (WS-OMS-SRS-001 D-05): the badge counts them; this opens the queue.
  if (has('sales') && (m.salesApprovals ?? 0) > 0) {
    const n = m.salesApprovals ?? 0;
    items.push({ label: `Orders to approve · ${n}`, click: () => a.openRoute('/sales?tab=appr') });
  }
  // Purchase documents waiting on my approval (SRS-PUR-001 G-21): the badge counts them; this opens the queue.
  if (has('purchase') && (m.purchaseApprovals ?? 0) > 0) {
    const n = m.purchaseApprovals ?? 0;
    items.push({ label: `Purchases to approve · ${n}`, click: () => a.openRoute('/purchase?tab=appr') });
  }
  if (has('marketing') && m.marketing) {
    const lines = inner(trayMarketingItems(m, a));
    if (lines.length) items.push({ label: callsSummary(m.marketing), submenu: lines });
  }
  if (has('assets') && m.assets) {
    const lines = trayAssetsItems(m, a);
    if (lines.length) items.push({ label: m.assets.waiting > 0 ? `Assets · ${m.assets.waiting} waiting for you` : 'Assets', submenu: lines });
  }
  if (has('meet') && m.meet) {
    const lines = inner(trayMeetItems(m, a, m.shortcutLabels ?? {}));
    if (lines.length) items.push({ label: m.meet.inCall ? 'Meet · in a meeting' : m.meet.next ? fit(`Meet · next: ${m.meet.next.title}`) : 'Meet', submenu: lines });
  }
  if (has('meetings') && m.meetings) {
    const lines = inner(trayMeetingsItems(m, a));
    if (lines.length) items.push({ label: meetingsSummary(m.meetings), submenu: lines });
  }
  if (has('projects') && m.projectTimer?.available) {
    const lines = inner(trayProjectItems(m, a, now.getTime()));
    const r = m.projectTimer.running;
    if (lines.length) items.push({ label: r ? fit(`Timer · ${clockOf(Math.max(0, (now.getTime() - (stampMs(r.startedAt) ?? now.getTime())) / 1000)).replace(/:\d\d$/, '')} ${targetLabel(r)}`) : 'Timer', submenu: lines });
  }
  if (has('chat') && m.live) {
    const live: MenuItemConstructorOptions[] = [
      ...(a.showRingMenu ? [{ label: 'Live dashboard…', click: () => void a.showRingMenu?.(null) }] : []),
      ...(a.liveDashboard ? [{ label: 'Open Live dashboard', accelerator: 'CmdOrCtrl+Shift+D', registerAccelerator: false, click: a.liveDashboard }] : []),
      ...(a.liveMap ? [{ label: 'Show Live map window', accelerator: 'CmdOrCtrl+Shift+M', registerAccelerator: false, click: a.liveMap }] : []),
    ];
    if (live.length) items.push({ label: `Live · ${m.live.online} on your sites${m.live.atRisk ? ' ⚠' : ''}`, submenu: live });
  }
  sep();

  if (m.signedIn) {
    const paused = m.notificationsPausedUntil && new Date(m.notificationsPausedUntil).getTime() > now.getTime();
    items.push({
      label: paused ? `Notifications paused until ${new Date(m.notificationsPausedUntil!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Pause notifications',
      submenu: [
        { label: '30 minutes', click: () => a.pauseNotifications(30) },
        { label: '1 hour', click: () => a.pauseNotifications(60) },
        { label: 'Until tomorrow', click: () => a.pauseNotifications(untilTomorrowMinutes()) },
        ...(paused ? [{ type: 'separator' as const }, { label: 'Resume', click: () => a.pauseNotifications(null) }] : []),
      ],
    });
  }
  // The update only when there is something to do: ready to restart, or required by a deadline.
  const u = m.update;
  if (a.updateNow && u?.kind === 'required') items.push({ label: u.deadline ? `⚠ Update required · ${installBy(u.deadline, now).replace(/ · .*$/, '')}` : '⚠ Update required', click: a.updateNow });
  else if (a.updateNow && (u?.kind === 'ready' || m.updateReady)) items.push({ label: `Restart to update${u?.version ? ` to ${u.version}` : ''}`, click: a.updateNow });
  sep();

  items.push({ label: 'Settings…', click: a.openSettings });
  items.push({ label: 'Check for updates', click: a.checkUpdates });
  if (m.signedIn) items.push({ label: 'Lock WorkSuite', accelerator: 'CmdOrCtrl+Alt+L', registerAccelerator: false, click: a.lock });
  // Quit is always last, and always there.
  items.push({ label: 'Quit WorkSuite', click: a.quit });
  return forPlatform(items);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{n}', String(n)));

/**
 * The tray's Support section (WS-SUPPORT-SRS-001 D-05): the mini dashboard as menu items, the same on the macOS menu
 * bar and in a Windows or Linux tray.
 *
 *  - My numbers (FR-WSP-02): open, overdue, unassigned and at risk, each opening its view; unread and due today
 *    beside them.
 *  - Next SLA due (FR-SLA-07): the four soonest of mine, each opening its quick-reply window (D-04, FR-DSK-03).
 *  - Quick reply to latest (⌃⌥R) and Open Support. Online / Away (FR-ASN-06) is the menu's status line.
 */
export function supportItems(f: SupportPulseFigures, a: Pick<TrayActions, 'openRoute' | 'supportQuickReply' | 'supportQuickLatest' | 'supportPresence'>, shortcut: string | null = null): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const mine = [`My open ${f.open}`, f.unread ? plural(f.unread, '1 unread', '{n} unread') : null, f.dueToday !== null ? `${f.dueToday} due today` : null].filter(Boolean).join(' · ');
  items.push({ label: mine, click: () => a.openRoute('/support?view=mine') });
  if (f.overdue !== null) items.push({ label: `Overdue ${f.overdue}`, click: () => a.openRoute('/support?view=overdue') });
  if (f.unassigned !== null) items.push({ label: `Unassigned ${f.unassigned}`, click: () => a.openRoute('/support?view=unassigned') });
  items.push({ label: `At risk ${f.atRisk}${f.breached ? ' · breached' : ''}`, click: () => a.openRoute('/support?view=overdue') });
  if (f.next.length) {
    items.push({ label: 'Next SLA due', enabled: false });
    for (const n of f.next) {
      const subject = n.subject.length > 42 ? `${n.subject.slice(0, 41)}…` : n.subject;
      items.push({
        label: `${n.reference} · ${subject}${n.sla ? ` — ${n.sla}` : ''}`,
        sublabel: n.requester || undefined,
        click: () => (a.supportQuickReply ? a.supportQuickReply(n.id) : a.openRoute(`/support/ticket/${n.id}`)),
      });
    }
  }
  if (a.supportQuickLatest) items.push({ label: 'Quick reply to latest', ...(shortcut ? { accelerator: shortcut, registerAccelerator: false } : {}), click: a.supportQuickLatest });
  items.push({ label: 'Open Support', click: () => a.openRoute('/support') });
  // Online / Away is the status line's now (worksuite-desktop#346): one switch, not one per section.
  items.push({ type: 'separator' });
  return items;
}
