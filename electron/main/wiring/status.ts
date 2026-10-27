import type { BackgroundAccounts } from '../../services/accounts/background';
import type { AccountRegistry } from '../../services/accounts/registry';
import { pendingCount, unsyncedSummary } from '../../services/accounts/unsynced';
import type { CallService } from '../../services/calls';
import type { ConnectionMonitor } from '../../services/connection-quality';
import type { Database } from '../../services/db';
import type { DesktopSettingsService } from '../../services/desktop-settings';
import type { HealthMonitor } from '../../services/discovery/health';
import type { LockService } from '../../services/lock';
import { lockedClickTarget } from '../../services/locked-notifications';
import type { MailAlertService } from '../../services/mail-alerts';
import type { MeetingsDesk } from '../../services/meetings-desk';
import type { NotificationService } from '../../services/notifications';
import type { OfficeExternal } from '../../services/office-external';
import type { OfflineQueue } from '../../services/offline-queue';
import type { PurchaseDesk } from '../../services/purchase-desk';
import type { RealtimeService } from '../../services/realtime';
import type { SalesDesk } from '../../services/sales-desk';
import type { SettingsService } from '../../services/settings';
import type { ServiceSupervisor } from '../../services/supervisor';
import type { SupportDesk } from '../../services/support-desk';
import type { SupportNotices } from '../../services/support-notices';
import type { SupportUrgent } from '../../services/support-urgent';
import type { TransferManager } from '../../services/transfers';
import type { Vault } from '../../services/vault';
import type { UpdaterService } from '../../updater/updater';
import type { WindowManager } from '../../windows/manager';
import type { AccessWatch } from '../access';
import { broadcast, guestWindowIds } from '../events';
import type { SessionController } from '../session';
import { canOpenApp, canOpenLink, notificationAllowed } from '@shared/access';
import { hostingBadge, type TrayHosting } from '@shared/hosting';
import { resolveWebLink } from '@shared/links';
import { lockedScope } from '@shared/locked-access';
import { touchesInvitations } from '@shared/meeting-invitations';
import { networkStatus } from '@shared/network';
import type { NavigateRequest, RealtimeState, ServiceHealth, StatusSnapshot } from '@shared/types';
import { websiteDraftKey, websiteReplyMutation } from '@shared/website-reply';
import { BrowserWindow, net as electronNet } from 'electron';
import type { AiPendingWatcher } from '../../services/ai-pending';
import type { BootState } from '../boot';
import type { RemoteControlService } from '../../services/remote-control/service';
import type { TrayService } from '../../tray/tray';
import type { WebchatRinger } from '../../services/webchat-ring';

/**
 * Status: the snapshot of connection, services, unread counts and updates that the windows and the tray show, sent at
 * most once per tick (emitStatus). Moved out of the composition root (electron/main/index.ts) unchanged (audit D-G13).
 */
/** What wireStatus reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireStatusDeps {
  readonly accessWatch: AccessWatch;
  readonly aiPending: AiPendingWatcher;
  readonly apiReachable: boolean;
  readonly background: BackgroundAccounts;
  readonly boot: BootState;
  readonly calls: CallService;
  readonly connection: ConnectionMonitor;
  readonly db: Database;
  readonly desktopSettings: DesktopSettingsService;
  readonly followUpCount: number;
  readonly health: HealthMonitor;
  readonly hostingCounts: TrayHosting | null;
  readonly lock: LockService;
  readonly mailAlerts: MailAlertService;
  readonly meetingsDesk: MeetingsDesk;
  readonly navigate: (asked: NavigateRequest) => void;
  readonly notifications: NotificationService;
  readonly officeLocal: OfficeExternal;
  readonly openLink: (link: string | null) => void;
  readonly purchaseDesk: PurchaseDesk;
  readonly queue: OfflineQueue;
  readonly realtime: RealtimeService;
  realtimeDownSince: number | null;
  readonly registry: AccountRegistry;
  readonly remoteControl: RemoteControlService;
  readonly ringingCount: number;
  readonly salesDesk: SalesDesk;
  readonly sessionCtl: SessionController;
  readonly settings: SettingsService;
  statusTimer: NodeJS.Timeout | null;
  readonly supervisor: ServiceSupervisor;
  readonly supportDesk: SupportDesk;
  readonly supportNotices: SupportNotices;
  readonly supportUrgent: SupportUrgent;
  readonly transfers: TransferManager;
  readonly tray: TrayService;
  readonly updater: UpdaterService;
  readonly vault: Vault;
  readonly webchat: WebchatRinger;
  readonly windows: WindowManager;
}

export function wireStatus(root: WireStatusDeps) {
  const snapshot = (): StatusSnapshot => {
    const uid = root.sessionCtl?.userId();
    const { supportNotices: supportBell, ...raw } = root.notifications.counts();
    const support = root.supportNotices.count();
    // Counts only of apps the person has: the badge, tray and title bar never count an app they cannot open.
    const visible = root.sessionCtl?.visibleApps() ?? new Set<string>();
    const hasMail = canOpenApp('mail', visible);
    const counts = { ...raw, mailBadge: hasMail ? root.mailAlerts.unread() : 0, mailNotices: hasMail ? raw.mailNotices : 0, chat: canOpenApp('chat', visible) ? raw.chat : 0, mail: hasMail ? raw.mail : 0, tasks: canOpenApp('tasks', visible) ? raw.tasks : 0, webchat: canOpenApp('chat', visible) ? root.followUpCount : 0, ringing: canOpenApp('chat', visible) ? root.ringingCount : 0, support, supportNotices: canOpenApp('support', visible) ? supportBell : 0, salesApprovals: canOpenApp('sales', visible) ? raw.salesApprovals : 0, salesNotices: canOpenApp('sales', visible) ? raw.salesNotices : 0, purchaseApprovals: canOpenApp('purchase', visible) ? root.purchaseDesk.count() : 0, purchaseNotices: canOpenApp('purchase', visible) ? raw.purchaseNotices : 0, hosting: canOpenApp('hosting', visible) ? hostingBadge(root.hostingCounts) : 0 };
    const services: Record<string, ServiceHealth> = { ...root.supervisor.health() };
    return {
      internetOnline: electronNet.isOnline(),
      realtimeDiagnostics: root.realtime.diagnostics(),
      network: networkStatus(root.apiReachable, root.realtime.getState(), root.realtimeDownSince),
      realtime: root.realtime.getState(),
      connection: root.connection.stats(),
      // The service banner (screen 16) and the switcher's dot for the accounts not open now.
      service: root.health.state(),
      otherAccountsUnread: root.background.totalUnread(),
      // The same list the sign-out dialog shows (accounts/unsynced.ts): one count, so the two never disagree.
      pendingChanges: uid ? pendingCount(unsyncedSummary({ db: root.db, vault: root.vault, accountId: root.registry.activeId() ?? '', userId: uid, officeCopies: () => root.officeLocal.list(), itemsOnly: true })) : 0,
      unread: counts,
      notificationsPausedUntil: root.notifications.pausedUntilIso(),
      mailAlertsPaused: hasMail ? (root.mailAlerts.state().pauseLabel ?? null) : null,
      notificationsSupported: root.notifications.supported(),
      services,
      locked: root.lock.isLocked(),
      safeMode: root.boot.safeMode,
    };
  };
  function emitStatus(): void {
    if (root.statusTimer) return;
    root.statusTimer = setTimeout(() => {
      root.statusTimer = null;
      const s = snapshot();
      broadcast('status:changed', s);
      const st = root.sessionCtl?.get();
      const failed = Object.entries(s.services).find(([, h]) => h === 'FAILED');
      root.tray.update({
        signedIn: st?.stage === 'ready',
        userName: st?.user?.name ?? null,
        organization: st?.user?.organizationName ?? null,
        offline: s.network === 'OFFLINE',
        pending: s.pendingChanges,
        error: failed ? `${failed[0]} stopped — open Diagnostics` : null,
        unreadChat: s.unread.chat + (s.unread.webchat ?? 0),
        unreadMail: s.unread.mail,
        unreadOther: s.unread.notifications,
        unreadSupport: s.unread.support ?? 0,
        unreadSupportNotices: s.unread.supportNotices ?? 0,
        badge: root.settings.effective().badgeCount !== false,
        notificationsPausedUntil: s.notificationsPausedUntil,
        mailBadge: s.unread.mailBadge ?? 0,
        mailNotices: s.unread.mailNotices ?? 0,
        salesApprovals: s.unread.salesApprovals ?? 0,
        salesNotices: s.unread.salesNotices ?? 0,
        purchaseApprovals: s.unread.purchaseApprovals ?? 0,
        purchaseNotices: s.unread.purchaseNotices ?? 0,
        mail: trayMail(),
      });
    }, 300);
  }

  root.realtime.onState = (s: RealtimeState) => {
    root.notifications.realtimeState(s);
    root.connection.realtimeState(s);
    root.realtimeDownSince = s === 'down' || s === 'connecting' ? (root.realtimeDownSince ?? Date.now()) : null;
    emitStatus();
  };
  function scopeFor(sender: Electron.WebContents) {
    const win = BrowserWindow.fromWebContents(sender);
    const scope = lockedScope(sender.getURL(), win ? root.windows.kindOf(win.id) : null);
    if (scope && (!root.sessionCtl.isReady() || !canOpenApp(scope.kind === 'chat-mini' ? 'chat' : 'calls', root.sessionCtl.visibleApps()))) return null;
    if (scope && !scope.uuid && scope.kind !== 'chat-mini' && win) scope.uuid = root.calls.list().find(c => c.windowId === win.id && c.kind === 'call')?.uuid ?? null;
    return scope;
  }
  // Mail's lines in the tray (D28): accounts, the pause and its choices.
  const trayMail = () => {
    const m = root.mailAlerts.state();
    return { accounts: m.accounts, unread: m.unread, paused: m.paused, pauseLabel: m.pauseLabel, pauseSet: !!m.pause, choices: m.pauseChoices, hoursNote: m.hoursNote };
  };
  root.realtime.onEvent = (e) => {
    // My own status changed somewhere (the window, another device): the tray's status line follows (#346).
    const pe = e as { type?: string; who?: number | string; status?: string };
    if (pe.type === 'chat.presence' && String(pe.who ?? '') === String(root.sessionCtl.get().user?.id ?? '-') && pe.status) root.tray.update({ presence: pe.status === 'online' ? 'available' : pe.status });
    root.notifications.handleRealtime(e);
    root.mailAlerts.handleRealtime(e);
    root.supportNotices.handle(e);
    root.salesDesk.handle(e as { type?: string });
    root.purchaseDesk.handle(e as { type?: string });
    // An invitation answered, moved or cancelled anywhere: the tray's Meetings lines follow (Meetings D07).
    if (touchesInvitations(e as { type: string; event?: unknown })) root.meetingsDesk.poke();
    root.supportDesk.handle(e);
    root.supportUrgent.handle(e);
    root.webchat.handle(e);
    root.calls.handle(e);
    root.aiPending.handle(e as { type?: string });
    root.remoteControl.onRealtime(e as { type?: string; meeting?: string });
    if (!root.lock.isLocked()) broadcast('realtime:event', e);
    else for (const win of BrowserWindow.getAllWindows()) {
      const scope = scopeFor(win.webContents);
      const event = e as { type?: string; uuid?: string; outcome?: string; reason?: string };
      if (!guestWindowIds.has(win.webContents.id) && scope?.uuid && event.type === 'chat.call.stopped' && event.uuid === scope.uuid) win.webContents.send('realtime:event', { type: event.type, uuid: event.uuid, outcome: event.outcome, reason: event.reason });
    }
    // `access.changed` (the person's apps changed) and `profile.updated`: fetch the bootstrap again.
    root.accessWatch.onEvent(e);
    // `desktop.settings.changed` {version}: the policy or the person's choices changed elsewhere.
    root.desktopSettings.handleRealtime(e as { type?: string; version?: unknown });
    // A desktop release was published: ask the Update Center now rather than at the next 4-hourly check.
    if ((e as { type?: string }).type === 'desktop.release.published') void root.updater.check();
  };
  root.realtime.onResync = () => {
    broadcast('realtime:resync');
    // Events may have been missed while the socket was down, `access.changed` among them.
    if (root.sessionCtl.isReady()) void root.accessWatch.refresh('resync');
    if (root.sessionCtl.isReady()) void root.desktopSettings.refresh();
    // Announcing what the push missed, chat included: not just taking it as already seen (#114).
    void root.notifications.refreshList(true);
    void root.notifications.catchUpChat();
    void root.notifications.refreshCounts();
    // New mail the push missed (ENH-MAIL-05): from the server's recent alerts, each still once.
    void root.mailAlerts.catchUp();
  };
  root.notifications.onChanged = () => {
    emitStatus();
    broadcast('notifications:changed');
  };
  root.notifications.onClick = (link) => {
    if (!root.lock.isLocked()) return root.openLink(link);
    // Locked (#114): a conversation opens in the restricted chat window when that is allowed; anything else after the unlock.
    const target = lockedClickTarget(link, root.settings.effective());
    if (target.kind === 'restricted-chat' && canOpenLink(link, root.sessionCtl.visibleApps())) {
      root.windows.open('chat-mini', `/chat?room=${target.room}`, 'WorkSuite chat');
      return;
    }
    broadcast('toast', { kind: 'info', text: 'Unlock WorkSuite to open this.' });
    const web = resolveWebLink(link);
    // Never into the browser from behind the lock: only a tab, and it waits for the unlock.
    if (web.kind === 'tab' && canOpenLink(link, root.sessionCtl.visibleApps())) root.navigate({ route: web.route, source: 'notification' });
    else root.windows.showMain();
  };
  // An app the person may not open never alerts (and Mail is not polled for them).
  root.notifications.moduleEnabled = (n) => notificationAllowed(n, root.sessionCtl.visibleApps());
  root.notifications.isLocked = () => root.lock.isLocked();
  // A reply typed in a website visitor's banner goes the way the conversation's composer sends one (RDC-15).
  root.notifications.sendWebsiteReply = async (conversationId, text) => {
    const me = root.sessionCtl.userId();
    if (!me) return { delivered: false, queued: false, id: null, status: null, data: null, error: 'You are signed out.', code: 'NOT_SIGNED_IN' };
    // A chat still ringing: the reply joins it and is sent in one step, first come (#225). Too late, it is refused.
    if (root.webchat.isRinging(conversationId)) {
      const r = await root.webchat.joinAndSend(conversationId, text, { stay: false });
      return { delivered: r.ok, queued: false, id: null, status: r.ok ? 200 : 409, data: null, error: r.why, code: r.ok ? null : 'TAKEN' };
    }
    return root.queue.submit(me, websiteReplyMutation(conversationId, text));
  };
  root.notifications.websiteReplyRefused = (w, text, error) => {
    const me = root.sessionCtl.userId();
    const key = websiteDraftKey(w.conversationId);
    // Signed out meanwhile: there is no draft to keep it in.
    if (me) root.queue.saveDraft(me, key.module, key.context, text);
    root.openLink(`/chat?website=${w.conversationId}`);
    broadcast('toast', { kind: 'error', text: `Your reply to ${w.visitor} was not sent: ${error} It is in the message box to send again.` });
  };
  root.queue.onChanged = () => {
    emitStatus();
    broadcast('offline:changed');
  };
  root.transfers.onChanged = (list) => broadcast('transfers:changed', list);
  return { emitStatus, scopeFor, snapshot };
}
