import type { HttpClient } from '../../services/http';
import { AtRiskAlerts, LivePulse, wallDisplays, wallPrefsOf, wallTarget } from '../../services/live-desk';
import type { LockService } from '../../services/lock';
import { inDnd, type NotificationService } from '../../services/notifications';
import type { SettingsService } from '../../services/settings';
import type { SystemFocus } from '../../services/system-focus';
import type { WebchatRinger } from '../../services/webchat-ring';
import type { TrayService } from '../../tray/tray';
import type { WindowManager } from '../../windows/manager';
import type { SessionController } from '../session';
import { canOpenApp } from '@shared/access';
import type { NavigateRequest, WebchatOnCall, WebchatRingState } from '@shared/types';
import { BrowserWindow, Notification, app, globalShortcut, screen } from 'electron';

/**
 * The Live dashboard outside the main window (L-04, L-05; MAP-21…25): the live desk, its pulse, at-risk alerts and the
 * wall displays. Moved out of the composition root (electron/main/index.ts) unchanged (audit D-G13).
 */
/** What wireLiveDesk reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireLiveDeskDeps {
  readonly globalKeysOn: () => boolean;
  readonly http: HttpClient;
  readonly liveSilenced: () => boolean;
  readonly liveSilencedUntil: number;
  readonly lock: LockService;
  readonly navigate: (asked: NavigateRequest) => void;
  readonly notifications: NotificationService;
  onCall: WebchatOnCall | null;
  readonly onUpdateActivity: () => void;
  readonly sessionCtl: SessionController;
  readonly settings: SettingsService;
  readonly systemFocus: SystemFocus;
  readonly tray: TrayService;
  readonly trayCalls: (s: WebchatRingState) => { webchatRinging: { id: number; label: string; silenced: boolean; }[]; webchatCalls: { id: number; label: string; }[]; webchatOnCall: { conversationId: number; label: string; held: boolean; } | null; };
  readonly webchat: WebchatRinger;
  webchatCallLive: boolean;
  readonly windows: WindowManager;
}

export function wireLiveDesk(root: WireLiveDeskDeps) {
  // ── the Live dashboard outside the main window (L-04, L-05; MAP-21…25) ──
  // The figures the menu-bar icon carries, read with the main window closed (MAP-22).
  const livePulse = new LivePulse({
    http: root.http,
    allowed: () => root.sessionCtl.isReady() && canOpenApp('chat', root.sessionCtl.visibleApps()),
    onChanged: () => syncLive(),
  });
  const atRisk = new AtRiskAlerts({
    allowed: () => root.sessionCtl.isReady() && !root.lock.isLocked() && canOpenApp('chat', root.sessionCtl.visibleApps()) && root.settings.effective().notificationsEnabled !== false,
    quiet: () => {
      const p = root.settings.effective();
      return (p.dndEnabled && inDnd(p.dndFrom, p.dndTo, new Date())) || root.notifications.pausedUntilIso() !== null || root.liveSilenced() || root.systemFocus.active();
    },
    duringDnd: () => (root.liveSilenced() ? 'card' : root.settings.effective().webchatRinging.duringDnd),
    sound: () => root.settings.effective().notificationSounds,
    join: (id) => void root.webchat.join(id),
    showOnMap: (id) => liveDesk.open('map', id),
  });
  // ⌘⇧M shows or hides the Live map window and ⌘⇧D opens the Live dashboard from other apps (MAP-21, MAP-22). Held
  // only while WorkSuite is not in front: in WorkSuite the keys keep their own meanings (Dock Tab Beside, mute on a call),
  // and the Live map window and the tray's mini-dashboard answer them themselves.
  const LIVE_MAP_SHORTCUT = 'CommandOrControl+Shift+M';
  const LIVE_DASHBOARD_SHORTCUT = 'CommandOrControl+Shift+D';
  let liveKeysHeld = false;
  const syncLiveKeys = (): void => {
    // Unless turned off in Settings › Notifications & calls › Shortcuts.
    const want = root.globalKeysOn() && root.settings.effective().webchatRinging.liveShortcuts !== false && !!livePulse.get() && !root.lock.isLocked() && !BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
    if (want === liveKeysHeld) return;
    if (want) {
      try {
        const map = globalShortcut.register(LIVE_MAP_SHORTCUT, () => liveDesk.open('toggleMap'));
        const dash = globalShortcut.register(LIVE_DASHBOARD_SHORTCUT, () => liveDesk.open('dashboard'));
        liveKeysHeld = map || dash;
      } catch {
        liveKeysHeld = false;
      }
    } else {
      globalShortcut.unregister(LIVE_MAP_SHORTCUT);
      globalShortcut.unregister(LIVE_DASHBOARD_SHORTCUT);
      liveKeysHeld = false;
    }
  };
  app.on('browser-window-focus', () => syncLiveKeys());
  app.on('browser-window-blur', () => setImmediate(syncLiveKeys));
  // Open wall mode when WorkSuite starts (L-06, MAP-24): once a launch, as soon as the dashboard answers for somebody
  // who staffs website chat.
  let wallStarted = false;
  const syncLive = (): void => {
    const f = livePulse.get();
    if (f && !wallStarted) {
      wallStarted = true;
      if (wallPrefsOf(root.settings.effective().wallMode).openAtStart && !root.lock.isLocked()) liveDesk.open('wall');
    }
    root.tray.update({ live: f ? { online: f.online, atRisk: f.atRisk > 0 || root.webchat.state().chats.some((c) => c.atRisk) } : null });
    syncLiveKeys();
  };
  // When the wall's screen was last unplugged (MAP-24 "the tray says so"), until the wall opens again.
  let wallGoneAt: string | null = null;
  const wallTo = () => wallTarget(screen.getAllDisplays(), screen.getPrimaryDisplay().id, wallPrefsOf(root.settings.effective().wallMode).displayId);
  const liveDesk = {
    open: (to: 'map' | 'toggleMap' | 'dashboard' | 'wall' | 'wallSheet' | 'wallClose' | 'chat', id?: number): void => {
      root.windows.hideRingTray();
      if (to === 'map') root.windows.showLiveMap(id ?? null);
      else if (to === 'toggleMap') root.windows.toggleLiveMap();
      else if (to === 'dashboard') root.navigate({ route: '/chat?view=website&section=dashboard', source: 'tray' });
      else if (to === 'wall') {
        wallGoneAt = null;
        root.windows.showWall(wallTo()?.id ?? null, { keepAwake: wallPrefsOf(root.settings.effective().wallMode).keepAwake });
      } else if (to === 'wallSheet') root.windows.showWallSheet();
      else if (to === 'wallClose') root.windows.closeWall();
      else if (to === 'chat' && id) root.navigate({ route: `/chat?view=website&website=${id}`, source: 'tray' });
    },
    info: () => {
      const t = wallTo();
      const prefs = wallPrefsOf(root.settings.effective().wallMode);
      return {
        wall: t ? { display: t.display, name: t.name } : null,
        displays: wallDisplays(screen.getAllDisplays(), root.windows.mainDisplayId()),
        wallPrefs: { ...prefs, displayId: t?.id ?? prefs.displayId },
        wallOpen: root.windows.wallOpen(),
        wallGone: wallGoneAt,
        silencedUntil: root.liveSilenced() ? new Date(root.liveSilencedUntil).toISOString() : null,
        shortcuts: liveKeysHeld,
      };
    },
    // The sheet's Open on Display 2 (MAP-24): its choices kept for next time, the wall opened there, the sheet gone.
    wall: (choice: { displayId: number; keepAwake: boolean; cycle: boolean; openAtStart: boolean }): void => {
      root.settings.update({ wallMode: wallPrefsOf(choice) });
      root.windows.closeWallSheet();
      liveDesk.open('wall');
    },
  };
  // The wall's display was unplugged (MAP-24): its window has closed, and WorkSuite says so — a notification now, and
  // the tray's mini-dashboard until the wall opens again.
  root.windows.onWallGone = () => {
    wallGoneAt = new Date().toISOString();
    if (Notification.isSupported()) new Notification({ title: 'Wall mode closed', body: 'Its display was disconnected.', silent: true }).show();
  };
  const webchatOnCall = (c: WebchatOnCall | null): void => {
    root.onCall = c;
    root.webchatCallLive = !!c;
    root.tray.update(root.trayCalls(root.webchat.state()));
    root.onUpdateActivity();
  };
  return { atRisk, liveDesk, livePulse, syncLive, syncLiveKeys, webchatOnCall };
}
