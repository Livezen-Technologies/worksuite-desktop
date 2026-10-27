import type { CallService } from '../../services/calls';
import type { HttpClient } from '../../services/http';
import type { LockService } from '../../services/lock';
import type { MailAlertService } from '../../services/mail-alerts';
import type { MeetRecorder } from '../../services/meet-recorder';
import type { MeetingsDesk } from '../../services/meetings-desk';
import type { NotificationService } from '../../services/notifications';
import type { SinhalaService } from '../../services/sinhala';
import type { SupportDesk } from '../../services/support-desk';
import { TrayService } from '../../tray/tray';
import type { UpdaterService } from '../../updater/updater';
import type { WindowManager } from '../../windows/manager';
import { broadcast } from '../events';
import type { SessionController } from '../session';
import type { TrayAssets } from '@shared/assets';
import type { TrayHosting } from '@shared/hosting';
import type { NavigateRequest } from '@shared/types';
import { app, dialog } from 'electron';
import type { Projects } from '../../services/projects/index';
import type { QuickAsk } from '../../services/quick-ask';
import type { RemoteControlService } from '../../services/remote-control/service';
import type { WallDisplay } from '@shared/types';
import type { WebchatRinger } from '../../services/webchat-ring';

/**
 * The tray: its menu, presence and quit. Moved out of the composition root (electron/main/index.ts) unchanged (audit
 * D-G13).
 */
/** What wireTray reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireTrayDeps {
  assetsTray: ((t: TrayAssets | null) => void) | null;
  readonly calls: CallService;
  readonly clock: (direction: "in" | "out") => Promise<void>;
  readonly emitStatus: () => void;
  hostingTray: ((t: TrayHosting | null) => void) | null;
  readonly http: HttpClient;
  readonly liveDesk: { open: (to: "map" | "toggleMap" | "dashboard" | "wall" | "wallSheet" | "wallClose" | "chat", id?: number) => void; info: () => { wall: { display: string; name: string | null; } | null; displays: WallDisplay[]; wallPrefs: { displayId: number | null; keepAwake: boolean; cycle: boolean; openAtStart: boolean; }; wallOpen: boolean; wallGone: string | null; silencedUntil: string | null; shortcuts: boolean; }; wall: (choice: { displayId: number; keepAwake: boolean; cycle: boolean; openAtStart: boolean; }) => void; };
  readonly lock: LockService;
  readonly log: { debug: (msg: string, data?: unknown) => void; info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void; error: (msg: string, data?: unknown) => void; };
  readonly mailAlerts: MailAlertService;
  readonly meetAction: (id: string, source: "shortcut" | "tray") => void;
  readonly meetingsDesk: MeetingsDesk;
  readonly meetRecorder: MeetRecorder;
  readonly navigate: (asked: NavigateRequest) => void;
  readonly notifications: NotificationService;
  readonly openAiChanges: () => void;
  readonly openNextContact: (source: "shortcut" | "tray") => void;
  readonly openQuickReply: (ticketId: number) => void;
  readonly projects: Projects;
  readonly quickAsk: QuickAsk;
  readonly quickLatest: () => void;
  readonly remoteControl: RemoteControlService;
  readonly ringTray: { show: (anchor: Electron.Rectangle | null) => boolean; fit: (height: number) => void; act: (action: "inbox" | "settings" | "quit" | "close" | "dashboard" | "liveMap" | "wall" | "silence") => void; };
  readonly sessionCtl: SessionController;
  readonly sinhala: SinhalaService;
  readonly supportDesk: SupportDesk;
  readonly updateNow: () => void;
  readonly updater: UpdaterService;
  readonly webchat: WebchatRinger;
  readonly windows: WindowManager;
}

export function wireTray(root: WireTrayDeps) {
  // ── the tray ───────────────────────────────────────────────────────────
  const quit = (): void => {
    // RC15: someone controls this computer or it is being shared — say what quitting ends first.
    if (root.remoteControl.isLive() || root.remoteControl.isSharing()) {
      const live = root.remoteControl.view().session;
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: [live ? 'Stop control and quit' : 'Stop sharing and quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Quit WorkSuite?',
        message: live ? `${live.controller} is controlling this computer.` : 'You are sharing your screen in a meeting.',
        detail: live ? 'Quitting stops remote control and screen sharing, and leaves the meeting.' : 'Quitting stops sharing and leaves the meeting.',
      });
      if (choice !== 0) return;
      void root.remoteControl.shutdown('stopped');
    }
    // A recording on this computer, or one still being finished or uploaded (worksuite-desktop#68): quitting pauses it.
    const rec = root.meetRecorder.pending();
    if (rec.recording || rec.working) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['Quit anyway', 'Keep WorkSuite open'],
        defaultId: 1,
        cancelId: 1,
        title: 'Quit WorkSuite?',
        message: rec.recording ? 'A meeting is being recorded on this computer.' : 'A meeting recording is still being finished and uploaded.',
        detail: rec.recording
          ? 'Quitting stops the recording. What was recorded so far is kept, finished and uploaded the next time you open WorkSuite.'
          : 'Quitting pauses it. It carries on from where it was the next time you open WorkSuite. Closing windows does not stop it — only quitting does.',
      });
      if (choice !== 0) return;
    }
    root.windows.quitting = true;
    // Leave any call first, so the other side is not left talking to nobody.
    void Promise.race([root.calls.endAll(), new Promise((r) => setTimeout(r, 2_000))]).finally(() => app.quit());
  };
  /** The status the tray shows, from the server (#346): at sign-in, and after a change from the tray did not go through. */
  const refreshTrayPresence = async (): Promise<void> => {
    try {
      const me = await root.http.get<{ status?: string; choice?: string }>('/api/chat/presence/me');
      tray.update({ presence: me?.choice ?? (me?.status === 'online' ? 'available' : (me?.status ?? null)) });
    } catch {
      /* the status line falls back to Online */
    }
  };
  const tray = new TrayService({
    open: () => root.windows.showMain(),
    openRoute: (route) => root.navigate({ route, source: 'tray' }),
    clockIn: () => void root.clock('in'),
    clockOut: () => void root.clock('out'),
    pauseNotifications: (m) => {
      root.notifications.pause(m);
      root.emitStatus();
    },
    mailPause: (mode) => void root.mailAlerts.pause(mode),
    openSettings: () => root.navigate({ route: '/settings', source: 'tray' }),
    checkUpdates: () => {
      if (root.updater.get().state === 'STAGED') void root.updater.install(false).then((r) => !r.started && root.navigate({ route: '/settings/updates', source: 'tray' }));
      else void root.updater.check().then(() => root.navigate({ route: '/settings/updates', source: 'tray' }));
    },
    updateNow: () => root.updateNow(),
    quit,
    lock: () => root.lock.lock('manual'),
    pauseRemoteControl: () => {
      const s = root.remoteControl.view().session;
      if (s) void root.remoteControl.pause(s.id, 'sharer');
    },
    stopRemoteControl: () => void root.remoteControl.stopAll('stopped'),
    joinWebchat: (id) => void root.webchat.join(id),
    answerWebchatCall: (id) => void root.webchat.answerCall(id, true),
    quickAsk: () => void root.quickAsk.open(),
    // Sinhala Tools (WF-SI-04): what is on the clipboard, converted to Unicode and put back.
    sinhalaClipboard: () => root.sinhala.pressed(),
    aiChanges: () => root.openAiChanges(),
    ringingSettings: () => root.navigate({ route: '/settings/notifications', source: 'tray' }),
    showRingMenu: (anchor) => root.ringTray.show(anchor),
    liveDashboard: () => root.liveDesk.open('dashboard'),
    liveMap: () => root.liveDesk.open('map'),
    supportQuickReply: (id) => root.openQuickReply(id),
    supportQuickLatest: () => root.quickLatest(),
    supportPresence: (status) => void root.supportDesk.setPresence(status),
    // The status line (worksuite-desktop#346): Chat's presence, sent now; the window hears it as a realtime event.
    setPresence: (status) => {
      tray.update({ presence: status });
      void root.http
        .post('/api/chat/presence', { status, active: true })
        .then(() => broadcast('realtime:event', { type: 'chat.presence', who: Number(root.sessionCtl.get().user?.id ?? 0), status: status === 'available' ? 'online' : status }))
        .catch((e) => {
          root.log.info('status not set from the tray', { error: String((e as Error)?.message ?? e) });
          void refreshTrayPresence();
        });
    },
    marketingNextContact: () => root.openNextContact('tray'),
    meetJoinNext: () => root.meetAction('meet-join-next', 'tray'),
    meetingOpen: (id) => root.meetingsDesk.openFromTray(id),
    meetStart: () => root.meetAction('meet-new', 'tray'),
    meetShare: () => root.meetAction('meet-share-screen', 'tray'),
    meetMute: () => root.meetAction('meet-mute', 'tray'),
    meetCamera: () => root.meetAction('meet-camera', 'tray'),
    projectTimerStop: () => void root.projects.timer.end().catch((e) => broadcast('toast', { kind: 'error', text: String((e as Error).message ?? e) })),
    projectTimerSwitch: (t) => void root.projects.timer.switchTo(t).catch((e) => broadcast('toast', { kind: 'error', text: String((e as Error).message ?? e) })),
    projectTimerResume: () => void root.projects.timer.resume().catch((e) => broadcast('toast', { kind: 'error', text: String((e as Error).message ?? e) })),
    projectTimerWindow: () => {
      if (root.lock.isLocked() || !root.sessionCtl.isReady()) return;
      root.windows.open('timer', '/projects/timer', 'Timer', true);
    },
  });
  root.assetsTray = (t) => tray.update({ assets: t });
  root.hostingTray = (t) => {
    tray.update({ hosting: t });
    root.emitStatus();
  };
  return { quit, refreshTrayPresence, tray };
}
