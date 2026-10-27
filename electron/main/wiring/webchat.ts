import type { CallService } from '../../services/calls';
import type { DeviceService } from '../../services/device';
import type { HttpClient } from '../../services/http';
import type { LockService } from '../../services/lock';
import { inDnd, type NotificationService } from '../../services/notifications';
import type { RealtimeService } from '../../services/realtime';
import type { SettingsService } from '../../services/settings';
import { SystemFocus } from '../../services/system-focus';
import { WebchatRinger, announceEvent, ringerHeight } from '../../services/webchat-ring';
import type { TrayService } from '../../tray/tray';
import type { WindowManager } from '../../windows/manager';
import { broadcast } from '../events';
import type { SessionController } from '../session';
import { FOLLOW_UP_DEFAULTS, type NavigateRequest, type WebchatOnCall, type WebchatRingState } from '@shared/types';
import { BrowserWindow, app, globalShortcut, powerMonitor } from 'electron';
import type { AtRiskAlerts } from '../../services/live-desk';
import type { LivePulse } from '../../services/live-desk';
import type { WallDisplay } from '@shared/types';

/**
 * Website chats ring like calls (WS-WCHAT ENH-01, R3): system focus, the web-chat ringer, the tray's ring and call
 * counts. Moved out of the composition root (electron/main/index.ts) unchanged (audit D-G13).
 */
/** What wireWebchat reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireWebchatDeps {
  readonly atRisk: AtRiskAlerts;
  readonly calls: CallService;
  readonly device: DeviceService;
  readonly emitStatus: () => void;
  followUpCount: number;
  readonly http: HttpClient;
  readonly liveDesk: { open: (to: "map" | "toggleMap" | "dashboard" | "wall" | "wallSheet" | "wallClose" | "chat", id?: number) => void; info: () => { wall: { display: string; name: string | null; } | null; displays: WallDisplay[]; wallPrefs: { displayId: number | null; keepAwake: boolean; cycle: boolean; openAtStart: boolean; }; wallOpen: boolean; wallGone: string | null; silencedUntil: string | null; shortcuts: boolean; }; wall: (choice: { displayId: number; keepAwake: boolean; cycle: boolean; openAtStart: boolean; }) => void; };
  readonly livePulse: LivePulse;
  liveSilencedUntil: number;
  readonly lock: LockService;
  readonly navigate: (asked: NavigateRequest) => void;
  readonly notifications: NotificationService;
  readonly onCall: WebchatOnCall | null;
  readonly quit: () => void;
  readonly realtime: RealtimeService;
  ringingCount: number;
  readonly sessionCtl: SessionController;
  readonly settings: SettingsService;
  readonly syncLive: () => void;
  readonly tray: TrayService;
  readonly windows: WindowManager;
}

export function wireWebchat(root: WireWebchatDeps) {
  // ── website chats ring like calls (WS-WCHAT ENH-01, R3) ─────────────────
  const JOIN_SHORTCUT = 'CommandOrControl+Shift+J';
  const liveSilenced = (): boolean => root.liveSilencedUntil > Date.now();
  // The system's own Focus / Do not disturb counts as Do not disturb for the ring, where it can be read (RING-47).
  const systemFocus = new SystemFocus({ onChange: () => webchat.refresh() });
  systemFocus.start();
  // Answers a visitor's voice call (ENH-WCHAT-05), held only while one rings.
  const ANSWER_SHORTCUT = 'CommandOrControl+Shift+A';
  let answerHeld = false;
  let bounceId: number | null = null;
  let flashing = false;
  let shortcutHeld = false;
  // Until joined or silenced: the Dock bounces (critical), the taskbar flashes, Linux sets urgency (RING-44).
  const attention = (on: boolean): void => {
    if (process.platform === 'darwin') {
      if (on && bounceId === null) bounceId = app.dock?.bounce('critical') ?? null;
      if (!on && bounceId !== null) {
        app.dock?.cancelBounce(bounceId);
        bounceId = null;
      }
      return;
    }
    const main = root.windows.getMain();
    if (main && flashing !== on) main.flashFrame(on);
    flashing = on;
  };
  // Registered only while something rings, released afterwards (RING-46).
  const joinShortcut = (on: boolean): boolean => {
    if (on && !shortcutHeld) {
      try {
        shortcutHeld = globalShortcut.register(JOIN_SHORTCUT, () => {
          const top = webchat.top();
          if (top) void webchat.join(top.id);
        });
      } catch {
        shortcutHeld = false;
      }
    } else if (!on && shortcutHeld) {
      globalShortcut.unregister(JOIN_SHORTCUT);
      shortcutHeld = false;
    }
    return shortcutHeld;
  };
  const answerShortcut = (on: boolean): boolean => {
    if (on && !answerHeld) {
      try {
        answerHeld = globalShortcut.register(ANSWER_SHORTCUT, () => {
          const top = webchat.topCall();
          if (top) void webchat.answerCall(top.id, true);
        });
      } catch {
        answerHeld = false;
      }
    } else if (!on && answerHeld) {
      globalShortcut.unregister(ANSWER_SHORTCUT);
      answerHeld = false;
    }
    return answerHeld;
  };
  const trayCalls = (s: WebchatRingState) => ({
    webchatRinging: s.chats.map((c) => ({ id: c.id, label: c.site ? `${c.visitor} · ${c.site}` : c.visitor, silenced: c.silenced })),
    webchatCalls: (s.calls ?? []).map((c) => ({ id: c.id, label: c.site ? `${c.visitor} · ${c.site}` : c.visitor })),
    webchatOnCall: root.onCall ? { conversationId: root.onCall.conversationId, label: root.onCall.visitor, held: root.onCall.held } : null,
  });
  const webchat: WebchatRinger = new WebchatRinger({
    http: root.http,
    signedIn: () => root.sessionCtl.isReady(),
    locked: () => root.lock.isLocked(),
    me: () => (root.sessionCtl.get().user?.id ? Number(root.sessionCtl.get().user?.id) : null),
    prefs: () => {
      const p = root.settings.effective();
      return { ...p.webchatRinging, ...(liveSilenced() ? { duringDnd: 'card' as const } : {}), volume: !p.notificationSounds || root.lock.isLocked() && p.lockedNotificationSounds === false ? 0 : p.webchatRinging.volume };
    },
    quiet: () => {
      const p = root.settings.effective();
      return (p.dndEnabled && inDnd(p.dndFrom, p.dndTo, new Date())) || root.notifications.pausedUntilIso() !== null || liveSilenced() || systemFocus.active();
    },
    // With a call just answered, the thread joins its audio (`call=`).
    open: (id, callId, then) => root.navigate({ route: `/chat?view=website&website=${id}${callId ? `&call=${callId}` : ''}${then === 'transfer' ? '&transfer=1' : ''}`, source: 'notification' }),
    openInbox: () => root.navigate({ route: '/chat?view=website&section=inbox', source: 'notification' }),
    // A visitor who left before anyone joined (R-03): their chat in Missed chats, never opened in the inbox (which joins).
    openMissed: (id) => root.navigate({ route: `/chat?view=website&section=missed&website=${id}`, source: 'notification' }),
    // The ringing card's mini chat replies as the conversation's composer does (#225).
    reply: (conversationId, text) => root.notifications.sendWebsiteReply?.(conversationId, text) ?? Promise.resolve({ delivered: false, queued: false, id: null, status: null, data: null, error: 'You are signed out.', code: 'NOT_SIGNED_IN' }),
    // This installation as a ringing device (RING-10): the registered device's id, stable across restarts.
    deviceId: () => {
      const d = Number(root.device.current()?.id);
      return Number.isInteger(d) && d > 0 ? `desktop-${d}` : 'desktop-unregistered';
    },
    // Minimised counts as away from the conversation (#230): a minimised window is never focused.
    focused: () => {
      const w = BrowserWindow.getFocusedWindow();
      return (!!w && !w.isMinimized() && w.isFocused()) || powerMonitor.getSystemIdleTime() < 120;
    },
    followUpPrefs: () => ({ ...FOLLOW_UP_DEFAULTS, ...root.settings.effective().webchatFollowUps }),
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    // While the live connection is down the list is read every 10 s (worksuite-desktop#251).
    realtimeUp: () => root.realtime.getState() === 'connected',
    // A chat found by reading the list is announced as its event would have been: the system notification with Join
    // and Reply when the card is not showing (#251).
    // Named by the ring's start, so a chat that rings again later is announced again (TRN-34).
    announce: (c) => root.notifications.handleRealtime(announceEvent(c)),
    testNotify: () => root.notifications.testChat(),
    onChanged: (s) => {
      broadcast('ring:changed', s);
      const prefs = root.settings.effective().webchatRinging;
      // A visitor who wrote again in my chat has the card too, when I keep it on (#230).
      const followUps = s.followUpCard !== false && !!s.followUps?.length;
      if ((s.followUps?.length ?? 0) !== root.followUpCount) {
        root.followUpCount = s.followUps?.length ?? 0;
        root.emitStatus();
      }
      // The card, or the mini chat on a chat just joined from it (#225), unless minimised; as tall as it measured itself.
      if ((s.chats.length || s.handoffs?.length || s.calls?.length || s.outcome || s.joined || followUps) && !s.minimised && prefs.window && (!root.lock.isLocked() || root.settings.effective().lockedChatNotifications !== false)) root.windows.showRinger(s.fit ?? ringerHeight(s));
      else root.windows.hideRinger();
      root.tray.update(trayCalls(s));
      // The Dock and taskbar badge count what rings until it is joined or silenced (RING-44).
      const nowRinging = s.chats.filter((c) => !c.silenced).length + (s.calls?.length ?? 0);
      if (nowRinging !== root.ringingCount) {
        root.ringingCount = nowRinging;
        root.emitStatus();
      }
      // The tray's ringing menu goes with the last chat ringing, and behind the lock (R-06) — unless it is the Live
      // mini-dashboard, which stays while it is open (L-05).
      if (s.hidden) root.windows.closeRingTray();
      else if (!s.chats.length && !root.livePulse.get()) root.windows.hideRingTray();
      // An at-risk chat as a system notification, withdrawn when somebody joins (MAP-23); the icon red while it lasts.
      root.atRisk.update(s);
      root.syncLive();
      const live = s.chats.some((c) => !c.silenced) || !!s.handoffs?.length;
      attention(live || !!s.calls?.length);
      webchat.shortcut = joinShortcut(live && prefs.shortcut);
      webchat.answerShortcut = answerShortcut(!!s.calls?.length && prefs.shortcut);
    },
  });
  // A visitor's message raises nothing while I look at that conversation; one writing again in my chat follows my
  // choice in Settings, and only while WorkSuite is not in front (worksuite-desktop#230).
  root.notifications.websiteAttending = (id) => webchat.attending(id);
  root.notifications.followUpDesktop = () => ({ ...FOLLOW_UP_DEFAULTS, ...root.settings.effective().webchatFollowUps }).desktop;
  root.notifications.lastInputAt = () => Date.now() - powerMonitor.getSystemIdleTime() * 1000;
  root.calls.attention = (key, context) => root.notifications.requestAttention(key, context);
  root.notifications.staffCallWindowOn = () => root.calls.canShowRing();
  root.notifications.isFocused = () => {
    const w = BrowserWindow.getFocusedWindow();
    return !!w && !w.isMinimized() && w.isFocused();
  };
  root.notifications.ringerShowing = () => root.settings.effective().webchatRinging.window && (webchat.state().chats.length > 0 || !!webchat.state().handoffs?.length || !!webchat.state().calls?.length);
  // The call window shows a visitor's call whenever it is on and the lock lets it (V-04): as onChanged decides.
  root.notifications.callWindowOn = () => root.settings.effective().webchatRinging.window && (!root.lock.isLocked() || root.settings.effective().lockedChatNotifications !== false);
  // The tray's ringing menu (R-06, RING-UI-07; UX-ALR-02): by the icon while chats ring, never behind the lock — the
  // plain menu says only what it always says there.
  let ringTrayHeight: number | null = null;
  const ringTray = {
    show: (anchor: Electron.Rectangle | null): boolean => {
      const s = webchat.state();
      // For website staff the menu is the Live mini-dashboard (L-05, MAP-22), ringing or not.
      const live = !!root.livePulse.get();
      if (root.lock.isLocked() || s.hidden || (!s.chats.length && !live)) return false;
      root.windows.showRingTray(anchor, ringTrayHeight ?? (live ? 640 : 120 + Math.min(4, s.chats.length) * 64), live);
      void root.livePulse.read();
      return true;
    },
    fit: (height: number): void => {
      ringTrayHeight = height;
      root.windows.fitRingTray(height);
    },
    act: (action: 'inbox' | 'settings' | 'quit' | 'close' | 'dashboard' | 'liveMap' | 'wall' | 'silence'): void => {
      root.windows.hideRingTray();
      if (action === 'inbox') root.navigate({ route: '/chat?view=website&section=inbox', source: 'tray' });
      else if (action === 'settings') root.navigate({ route: '/settings/notifications', source: 'tray' });
      else if (action === 'quit') root.quit();
      else if (action === 'dashboard') root.liveDesk.open('dashboard');
      else if (action === 'liveMap') root.liveDesk.open('map');
      // Wall mode on Display 2 asks first which screen and how (WF-M3); while the wall is up, the item closes it (MAP-24).
      else if (action === 'wall') root.liveDesk.open(root.windows.wallOpen() ? 'wallClose' : 'wallSheet');
      else if (action === 'silence') {
        root.liveSilencedUntil = Date.now() + 15 * 60_000;
        webchat.refresh();
      }
    },
  };
  return { liveSilenced, ringTray, systemFocus, trayCalls, webchat };
}
