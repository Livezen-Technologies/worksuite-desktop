import { openExternalSafely } from '../../security/hardening';
import type { AccountsService } from '../../services/accounts/handlers';
import { routeLink, withoutServerParam } from '../../services/accounts/links';
import type { AccountRegistry } from '../../services/accounts/registry';
import { AI_ANSWER_LINK, AI_CHANGES_LINK } from '../../services/ai-pending';
import type { AuditService } from '../../services/audit';
import type { AuthService } from '../../services/auth';
import type { CallService } from '../../services/calls';
import { ChequeStation } from '../../services/cheque-print';
import type { Database } from '../../services/db';
import type { DesktopSettingsService } from '../../services/desktop-settings';
import type { DeviceService } from '../../services/device';
import type { HttpClient } from '../../services/http';
import type { LocalSession } from '../../services/local-workspace';
import type { LockService } from '../../services/lock';
import type { MailAlertService } from '../../services/mail-alerts';
import { nextContactRoute } from '../../services/marketing-shortcut';
import { MeetingsDesk } from '../../services/meetings-desk';
import type { NotificationService } from '../../services/notifications';
import { OfficeAiPolicySync } from '../../services/office-ai-policy';
import { OfficeApp } from '../../services/office-app';
import { DesktopAccountsFile, OfficeSignIn } from '../../services/office-signin';
import type { OfflineQueue } from '../../services/offline-queue';
import { listPrinters } from '../../services/print';
import { createProjects } from '../../services/projects';
import { PurchaseDesk } from '../../services/purchase-desk';
import { SalesDesk } from '../../services/sales-desk';
import type { SettingsService } from '../../services/settings';
import { SupportDesk } from '../../services/support-desk';
import { SupportNotices } from '../../services/support-notices';
import { SupportUrgent } from '../../services/support-urgent';
import type { Vault } from '../../services/vault';
import type { WindowManager } from '../../windows/manager';
import { NO_ACCESS } from '../access';
import { emitAccounts, type AccountsWiring } from '../accounts-wiring';
import { isDesktopError } from '../errors';
import { broadcast, sendTo } from '../events';
import { logger } from '../log';
import type { SessionController } from '../session';
import { canOpenApp, canOpenLink, canOpenRoute } from '@shared/access';
import { BillingBanners } from '@shared/billing';
import { redirectRoute } from '@shared/channels';
import { parseDeepLink } from '@shared/deeplink';
import { itemApp, itemRoute, looksLikeItemLink, parseItemLink } from '@shared/item-links';
import { linkPrefs } from '@shared/link-prefs';
import { resolveWebLink } from '@shared/links';
import { mailtoRoute, parseMailto } from '@shared/mailto';
import { OFFICE_CLIENT, isOfficeSignInLink } from '@shared/office-signin';
import { redactUrl } from '@shared/redact';
import { SUPPORT_QUICK_SHORTCUT, quickRoute, ringRoute, supportNoticePrefs } from '@shared/support';
import type { TrustedConfig } from '@shared/trusted-config';
import type { NavigateRequest } from '@shared/types';
import { BrowserWindow, app, dialog, globalShortcut, powerMonitor, shell } from 'electron';
import { execFile as execFileCb } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Paths } from '../paths';
import type { TrayService } from '../../tray/tray';

/**
 * Navigation: deep links, notification and tray clicks, item links and the desks that open windows of their own
 * (support, sales, purchase, meetings, cheque printing, Office sign-in). Moved out of the composition root
 * (electron/main/index.ts) unchanged (audit D-G13).
 */
/** What wireNavigation reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireNavigationDeps {
  readonly accountsService: AccountsService;
  readonly accountsWiring: AccountsWiring | null;
  readonly audit: AuditService;
  readonly auth: AuthService;
  readonly calls: CallService;
  readonly db: Database;
  readonly desktopSettings: DesktopSettingsService;
  readonly device: DeviceService;
  readonly emitStatus: () => void;
  readonly getVault: () => Vault;
  readonly globalKeysOn: () => boolean;
  readonly http: HttpClient;
  readonly localSession: LocalSession;
  readonly lock: LockService;
  readonly log: { debug: (msg: string, data?: unknown) => void; info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void; error: (msg: string, data?: unknown) => void; };
  readonly mailAlerts: MailAlertService;
  readonly notifications: NotificationService;
  readonly openGuest: (input: string, server?: string, localName?: string) => Promise<{ id: number; }>;
  readonly p: Paths;
  pendingGuest: { input: string; server?: string; } | null;
  readonly queue: OfflineQueue;
  readonly registry: AccountRegistry;
  readonly sessionCtl: SessionController;
  readonly setLinkHandler: (fn: (url: string) => void) => void;
  readonly settings: SettingsService;
  supportKeyHeld: boolean;
  readonly tray: TrayService;
  readonly trustedNow: () => TrustedConfig;
  readonly windows: WindowManager;
}

export function wireNavigation(root: WireNavigationDeps) {
  // ── navigation (deep links, notifications, tray) ──────────────────────
  const pendingNav: NavigateRequest[] = [];
  const refuse = (): void => {
    root.windows.showMain();
    broadcast('toast', { kind: 'error', text: NO_ACCESS });
  };
  const navigate = (asked: NavigateRequest): void => {
    // A channel's old route (`/whatsapp?chat=5`) opens in its host now, on the same conversation (#35).
    const req = { ...asked, route: redirectRoute(asked.route) };
    // Locked: the workspace is not there to take it; it opens once WorkSuite is unlocked (#114).
    if (root.lock.isLocked()) {
      pendingNav.push(req);
      root.windows.showMain();
      return;
    }
    // Guest mode (#149): the main window's guard opens what guest mode has, or the sign-in panel for what needs an account.
    const main = root.windows.getMain();
    if (!root.sessionCtl.isReady() && main && root.localSession.isGuest(main.webContents.id) && !root.localSession.access.locked(main.webContents.id)) {
      root.windows.showMain().webContents.send('navigate', req);
      return;
    }
    if (!root.sessionCtl.isReady() || !root.windows.getMain()) {
      // Checked by the main window when it takes them (Shell).
      pendingNav.push(req);
      if (!root.sessionCtl.isReady()) root.windows.showMain();
      return;
    }
    // A deep link, the tray or a notification never opens an app the person was not given.
    if (!canOpenRoute(req.route, root.sessionCtl.visibleApps())) {
      refuse();
      return;
    }
    if (req.newWindow) {
      root.windows.open('record', req.route);
      return;
    }
    const w = root.windows.showMain();
    // A window just made (closed to the tray) is still loading: a route sent now is lost (#346). Send it once loaded.
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => w.webContents.send('navigate', req));
    else w.webContents.send('navigate', req);
  };
  // Marketing's Next contact (MKT-DSK-01): the global key and the tray's line — My call queue's workspace, on a new claim.
  const openNextContact = (source: 'shortcut' | 'tray'): void => navigate({ route: nextContactRoute(), source });

  /** The meeting this computer is in, if any: whose window answers mute and the camera. */
  const liveMeetWindow = (): BrowserWindow | null => {
    const live = root.calls.list().find((c) => c.kind === 'meet');
    const win = live ? BrowserWindow.fromId(live.windowId) : null;

    return win && !win.isDestroyed() ? win : null;
  };

  /**
   * One Meet action, however it was asked for (WS-MEET-ENH-01 D04, D06): a
   * global key, or the tray's own line. One implementation, because a tray
   * entry and a key that did subtly different things would be a bug nobody
   * would think to look for.
   */
  const meetAction = (id: string, source: 'shortcut' | 'tray'): void => {
    const win = liveMeetWindow();

    // In a meeting, these belong to its own window: muting the call you are in
    // is never the main window's business.
    if (win && (id === 'meet-mute' || id === 'meet-camera' || id === 'meet-share-screen')) {
      sendTo(win, 'meet:shortcut', { id });

      return;
    }
    // Without a meeting, mute and camera have nothing to act on. The keys are
    // held only while a call is live, so arriving here means it ended between
    // the press and the delivery; the tray does not offer them at all.
    if (id === 'meet-mute' || id === 'meet-camera') return;

    // The rest start something, which only the workspace can do, so it comes
    // forward with the action in the route.
    const action = id === 'meet-new' ? 'new' : id === 'meet-join-next' ? 'join-next' : 'share';

    navigate({ route: `/meet?do=${action}&n=${Date.now()}`, source });
  };
  const flushNavigation = (): void => {
    if (!root.sessionCtl.isReady()) return;
    const w = root.windows.getMain();
    if (!w) return;
    while (pendingNav.length) w.webContents.send('navigate', pendingNav.shift());
  };
  // The main window's Changes view: where a waiting change the assistant proposed is decided (DSK-5).
  const openAiChanges = (): void => {
    const w = root.windows.showMain();
    w.webContents.send('ai:open', { to: 'changes', text: '', result: null });
  };
  // The assistant's conversation, where an answer that arrived in the background is read (#126).
  const openAiAnswer = (): void => {
    const w = root.windows.showMain();
    w.webContents.send('ai:open', { to: 'ask', text: '', result: null });
  };
  const openLink = (link: string | null): void => {
    if (link === AI_CHANGES_LINK) return openAiChanges();
    if (link === AI_ANSWER_LINK) return openAiAnswer();
    const target = resolveWebLink(link);
    // Nor in the browser instead: a link into an app the person may not open is refused.
    if (!canOpenLink(link, root.sessionCtl.visibleApps())) refuse();
    else if (target.kind === 'tab') navigate({ route: target.route, source: 'notification' });
    else if (target.kind === 'browser') {
      const origin = root.auth.getServer()?.origin;
      if (origin) void openExternalSafely(`${origin}${target.path}`);
    } else root.windows.showMain();
  };
  /* WorkSuite Office's Local AI policy (W10): the company's policy from the server, written where Office's local
     AI service reads managed configuration. Refreshed with every bootstrap, removed on sign-out. */
  const officeAiPolicy = new OfficeAiPolicySync({
    platform: process.platform,
    env: process.env,
    home: app.getPath('home'),
    fetchPolicy: () => root.http.get<unknown>('/api/ai/office-policy'),
    run: (file, args) =>
      new Promise<string>((resolveRun, reject) => {
        execFileCb(file, args, { timeout: 30_000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolveRun(String(stdout))));
      }),
    readFile: (path) => fsp.readFile(path, 'utf8').catch(() => null),
    writeFile: async (path, data, mode) => {
      await fsp.mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, data, { mode });
      await fsp.rename(tmp, path);
    },
    removeFile: (path) => fsp.rm(path, { force: true }),
    log: logger('office-ai-policy'),
  });
  // WorkSuite Office, the desktop editor: "Open with ▸ WorkSuite Office" hands it a link this process builds (#322).
  const officeApp = new OfficeApp({
    protocolApp: (url) => app.getApplicationNameForProtocol(url),
    open: async (url) => {
      if (!app.isPackaged && process.env.WS_E2E_EXTERNAL_LOG) await fsp.writeFile(process.env.WS_E2E_EXTERNAL_LOG, `${url}\n`, { flag: 'a' });
      else await shell.openExternal(url);
    },
    account: () => {
      const origin = root.auth.getServer()?.origin;
      const uid = root.sessionCtl.userId();
      return origin && uid && root.sessionCtl.isReady() ? { origin, userId: String(uid) } : null;
    },
    canOpenFiles: () => root.sessionCtl.hasPermission('desktop.files.open_external'),
    audit: (action, details) => root.audit.record(root.sessionCtl.userId(), action, details),
  });
  // WorkSuite Office on this computer: who this app is signed in as, and its "Continue as" (worksuite-office#6).
  const desktopAccounts = new DesktopAccountsFile(join(root.p.userData, 'desktop-accounts.json'), root.log);
  const officeSignIn = new OfficeSignIn({
    account: () => {
      const origin = root.auth.getServer()?.origin;
      const uid = root.sessionCtl.userId();
      const user = root.sessionCtl.current()?.user ?? root.sessionCtl.get().user;
      if (!origin || !uid || !user || !root.sessionCtl.isReady()) return null;
      return { origin, userId: String(uid), name: user.name, organization: user.organizationName ?? null };
    },
    isLocked: () => root.lock.isLocked(),
    confirm: async ({ message, detail }) => {
      const parent = root.windows.getMain();
      const opts = { type: 'question' as const, buttons: ['Continue', 'Cancel'], defaultId: 1, cancelId: 1, message, detail };
      const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
      return response === 0;
    },
    handoff: (challenge) => root.http.post('/api/auth/apps/handoff', { client: OFFICE_CLIENT, code_challenge: challenge, code_challenge_method: 'S256' }),
    // A fixed address with this app's code: nothing from the link that asked (hardening.ts allows https only).
    open: async (url) => {
      if (!app.isPackaged && process.env.WS_E2E_EXTERNAL_LOG) await fsp.writeFile(process.env.WS_E2E_EXTERNAL_LOG, `${url}\n`, { flag: 'a' });
      else await shell.openExternal(url);
    },
    showMain: () => void root.windows.showMain(),
    toast: (kind, text) => broadcast('toast', { kind, text }),
    isNotFound: (e) => isDesktopError(e) && e.code === 'NOT_FOUND',
    log: root.log,
  });
  const handleDeepLink = (url: string): void => {
    // A mailto: link from another app (WorkSuite is the default mail app): a new message, prefilled, for the person to send.
    if (/^mailto:/i.test(url)) {
      const fields = parseMailto(url);
      if (fields) navigate({ route: mailtoRoute(fields), source: 'deep-link' });
      else root.windows.showMain();
      return;
    }
    // A browser sign-in (OIDC, Core's AppHandoff) coming back: its attempt takes it first (Connection & Startup §3).
    if (/^worksuite:\/\/auth\/(oidc|callback)\?/i.test(url) && root.accountsWiring?.handleAuthCallback(url)) {
      root.windows.showMain();
      return;
    }
    // A setup link from IT (§4 step 5): Add Account › Enterprise with it filled in; it still takes a click on Continue.
    if (/^worksuite:\/\/setup\?/i.test(url)) {
      root.windows.showMain();
      if (!root.accountsService.setupLink(url)) broadcast('toast', { kind: 'info', text: root.trustedNow().lockServer ? 'Your organization manages the server this computer connects to.' : 'That setup link could not be used.' });
      return;
    }
    // A passkey sign-in coming back from the browser. Handled before the link
    // grammar, and never logged: it carries a one-time code.
    if (/^worksuite:\/\/auth\/callback\?/i.test(url)) {
      root.windows.showMain();
      let code = '';
      let state = '';
      try {
        const q = new URL(url).searchParams;
        code = q.get('code') ?? '';
        state = q.get('state') ?? '';
      } catch {
        /* treated as not started below */
      }
      // Only the attempt waiting now; anything else is ignored and leaves that
      // attempt running — a stray or replayed link must not cancel it.
      if (!root.auth.isPendingPasskey(state)) {
        root.log.warn('passkey callback for no sign-in waiting');
        broadcast('toast', { kind: 'error', text: 'That sign-in was not started from this app.' });
        return;
      }
      void root.sessionCtl.completePasskey(code, state);
      return;
    }
    // WorkSuite Office asking to use this sign-in (worksuite-office#6). Before the link grammar, where
    // office/:id would take it for a document, and never logged: it carries a PKCE challenge and state.
    if (isOfficeSignInLink(url)) {
      void officeSignIn.handle(url);
      return;
    }
    const meeting = /^worksuite:\/\/meet\/([0-9a-f-]{36})(?:[?#]|$)/i.exec(url);
    if ((meeting && !root.sessionCtl.isReady()) || /^https:\/\/[^/]+\/meet\//i.test(url)) {
      const destination = { input: meeting ? meeting[1]! : url, server: meeting ? new URL(url).searchParams.get('server') ?? undefined : undefined };
      root.pendingGuest = destination;
      void root.openGuest(destination.input, destination.server).then(() => { root.pendingGuest = null; }, (e) => {
        const main = root.windows.showMain();
        main.webContents.send('guest:destination', destination);
        broadcast('toast', { kind: 'error', text: String(e.message) });
      });
      return;
    }
    // Which account the link is for (§4 step 5): another account's opens there once the person agrees; a server not
    // added on this computer is screen 16, and nothing is fetched from it.
    const routed = routeLink(url, root.registry.list(), root.registry.activeId());
    if (routed?.kind === 'unknown') {
      root.log.info('link for a server not added', { host: routed.host });
      root.windows.showMain();
      emitAccounts('accounts:unknownLink', { url: redactUrl(url), host: routed.host, label: routed.label });
      return;
    }
    if (routed?.kind === 'account') {
      const target = root.registry.get(routed.accountId);
      if (!target) return;
      const parent = root.windows.showMain();
      void dialog
        .showMessageBox(parent, { type: 'question', buttons: [`Open in ${target.organizationName ?? target.serverName}`, 'Cancel'], defaultId: 0, cancelId: 1, message: `Open in ${target.organizationName ?? target.serverName}?`, detail: 'This link belongs to another account on this computer.' })
        .then(({ response }) => {
          if (response !== 0) return;
          return root.accountsService.switchTo(target.id).then(() => handleDeepLink(withoutServerParam(url)));
        })
        .catch((e: unknown) => broadcast('toast', { kind: 'error', text: e instanceof Error ? e.message : 'That account could not be opened.' }));
      return;
    }
    if (routed?.kind === 'active' && url !== withoutServerParam(url)) url = withoutServerParam(url);
    // An item link (#170): worksuite://{org}/{type}/{id} or https://app.worksuite.lk/o/{org}/{type}/{id}.
    if (looksLikeItemLink(url)) {
      const serverHost = (() => {
        try {
          const origin = root.auth.getServer()?.origin;
          return origin ? new URL(origin).hostname : null;
        } catch {
          return null;
        }
      })();
      const item = parseItemLink(url, { hosts: [serverHost, ...(root.registry.active()?.linkHosts ?? [])] });
      if (!item.ok) {
        root.log.warn('item link rejected', { reason: item.reason, url: redactUrl(url) });
        root.windows.showMain();
        broadcast('toast', { kind: 'error', text: 'That WorkSuite link could not be opened.' });
        return;
      }
      // "Open WorkSuite links in the desktop app" off: a web link the system handed over goes on to the browser.
      if (item.link.format === 'web' && !linkPrefs(root.settings.effective()).openInApp) {
        void openExternalSafely(url);
        return;
      }
      // `features.itemLinks` off: links do not open items here at all.
      if (!root.desktopSettings.feature('itemLinks')) {
        broadcast('toast', { kind: 'warning', text: 'Opening WorkSuite links in the app is turned off.' });
        return;
      }
      root.log.info('item link', { type: item.link.type, action: item.link.action });
      navigate({ route: itemRoute(item.link), organizationId: item.link.org, source: 'deep-link', item: { link: item.link, source: item.link.source ?? 'external', app: itemApp(item.link) } });
      return;
    }
    const parsed = parseDeepLink(url);
    if (!parsed.ok) {
      root.log.warn('deep link rejected', { reason: parsed.reason, url: redactUrl(url) });
      navigate({ route: '/home', source: 'deep-link' });
      broadcast('toast', { kind: 'error', text: 'That WorkSuite link could not be opened.' });
      return;
    }
    root.log.info('deep link', { module: parsed.link.module, pattern: parsed.link.pattern });
    const go = (organizationId: string | null) =>
      navigate({ route: parsed.link.route, newWindow: parsed.link.newWindow, organizationId, source: 'deep-link' });
    // WF-04 step 3: a desktop-API server resolves the record — its module,
    // its organization, and whether this user may see it — before anything
    // opens. A refusal says only that, never what the record is.
    if (root.auth.getServer()?.api === 'desktop-v1' && root.sessionCtl.isReady()) {
      root.http
        .get<{ allowed?: boolean; organization_id?: string | number | null }>('/desktop/v1/links/resolve', { query: { url } })
        .then((r) => {
          if (r.allowed === false) {
            broadcast('toast', { kind: 'error', text: "You don't have access to this record." });
            root.windows.showMain();
            return;
          }
          const org = r.organization_id === null || r.organization_id === undefined ? parsed.link.organizationId : String(r.organization_id);
          go(org);
        })
        .catch(() => go(parsed.link.organizationId));
      return;
    }
    go(parsed.link.organizationId);
  };
  root.setLinkHandler(handleDeepLink);

  // A support ticket's quick-reply window (WS-SUPPORT-SRS-001 D-04, FR-DSK-03): floating over whatever is in front,
  // from a banner, the tray or the global shortcut. Never behind the lock, never for somebody without the desk.
  const openQuickReply = (ticketId: number): void => {
    if (root.lock.isLocked() || !root.sessionCtl.isReady() || !canOpenApp('support', root.sessionCtl.visibleApps())) return;
    root.windows.open('support-quick', quickRoute(ticketId), 'Quick reply', true);
  };
  // Support's banners and count (WS-SUPPORT-SRS-001 D-03, FR-DSK-02/04): the desk's notifications with their own buttons.
  const supportNotices = new SupportNotices({
    http: root.http,
    notify: (n) => root.notifications.notify(n),
    markRead: (ids) => root.notifications.markRead(ids),
    me: () => Number(root.sessionCtl.userId()) || null,
    enabled: () => canOpenApp('support', root.sessionCtl.visibleApps()),
    prefs: () => root.settings.effective(),
    open: (link) => root.notifications.onClick(link, 'support'),
    quickReply: (id) => openQuickReply(id),
    refused: (ticketId, text, mode, error) => {
      const me = root.sessionCtl.userId();
      // Kept as the ticket's draft, where its composer finds it (modules/support/Composer.tsx).
      if (me) root.queue.saveDraft(me, 'support', `ticket:${ticketId}`, { body: text, mode });
      openLink(`/tickets?ticket=${ticketId}`);
      broadcast('toast', { kind: 'error', text: `Your ${mode === 'note' ? 'note' : 'reply'} was not sent: ${error} It is in the ticket's message box to send again.` });
    },
    onChanged: () => {
      root.emitStatus();
      supportDesk.soon();
    },
  });
  // The desk in the tray / menu bar (D-05): my numbers, the next SLAs due, availability.
  const supportDesk: SupportDesk = new SupportDesk({
    http: root.http,
    enabled: () => canOpenApp('support', root.sessionCtl.visibleApps()),
    badges: () => supportNotices.badges(),
    onChanged: () => root.tray.update({ support: supportDesk.get() }),
  });
  // An urgent ticket nobody has rings as a centred card (D-07): one at a time, each once; it closes when it is taken.
  const supportUrgent: SupportUrgent = new SupportUrgent({
    http: root.http,
    allowed: () =>
      root.sessionCtl.isReady() && !root.lock.isLocked() && canOpenApp('support', root.sessionCtl.visibleApps()) && root.settings.effective().notificationsEnabled !== false && supportNoticePrefs(root.settings.effective().supportNotices).urgentPopup,
    ring: (id) => {
      const win = root.windows.open('support-ring', ringRoute(id), 'Urgent ticket', true);
      win.once('closed', () => supportUrgent.closed(id));
    },
    close: () => root.windows.closeKind('support-ring'),
  });
  const quickLatest = (): void => {
    void supportDesk.latest().then((id) => (id ? openQuickReply(id) : navigate({ route: '/support?view=mine', source: 'tray' })));
  };
  const syncSupportKeys = (): void => {
    const want = root.sessionCtl.isReady() && !root.lock.isLocked() && root.globalKeysOn() && canOpenApp('support', root.sessionCtl.visibleApps()) && supportNoticePrefs(root.settings.effective().supportNotices).quickShortcut;
    if (want && !root.supportKeyHeld) {
      try {
        root.supportKeyHeld = globalShortcut.register(SUPPORT_QUICK_SHORTCUT, quickLatest);
      } catch {
        root.supportKeyHeld = false;
      }
    } else if (!want && root.supportKeyHeld) {
      globalShortcut.unregister(SUPPORT_QUICK_SHORTCUT);
      root.supportKeyHeld = false;
    }
    root.tray.update({ supportShortcut: root.supportKeyHeld ? SUPPORT_QUICK_SHORTCUT : null });
  };
  // WorkSuite Projects (PRJ-DSK-02..04): the tray timer and its idle prompt, the offline outbox, banners with buttons.
  const projects = createProjects({
    db: root.db,
    vault: root.getVault,
    http: root.http,
    origin: () => root.auth.getServer()?.origin ?? null,
    user: () => (root.sessionCtl.isReady() && canOpenApp('projects', root.sessionCtl.visibleApps()) ? root.sessionCtl.userId() : null),
    notify: (n) => root.notifications.notify(n),
    markRead: (ids) => root.notifications.markRead(ids),
    open: (route) => navigate({ route, source: 'notification' }),
    openMini: () => {
      if (root.lock.isLocked() || !root.sessionCtl.isReady() || !canOpenApp('projects', root.sessionCtl.visibleApps())) return;
      root.windows.open('timer', '/projects/timer', 'Timer', true);
    },
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    changed: (c) => {
      broadcast('projects:changed', c);
      if (c.outbox) root.emitStatus();
    },
    tray: (t) => root.tray.update({ projectTimer: t }),
  });
  // A new email's bell entry is the new-mail alerts' to show (ENH-MAIL-05): never a plain banner as well.
  // Meetings' reminders and invitations (Meetings D07): their own buttons, and today's meetings in the tray.
  const meetingsDesk = new MeetingsDesk({
    get: (path, query, timeoutMs) => root.http.get(path, { query, timeoutMs }),
    post: (path, body) => root.http.post(path, body),
    notify: (n) => root.notifications.notify(n),
    markRead: (ids) => root.notifications.markRead(ids),
    allowed: () => root.sessionCtl.isReady() && !root.lock.isLocked() && canOpenApp('meetings', root.sessionCtl.visibleApps()),
    canMeet: () => canOpenApp('meet', root.sessionCtl.visibleApps()),
    open: (route) => root.notifications.onClick(route, 'meetings'),
    joinMeet: (uuid, title) => void root.windows.open('meet', `/meet/${uuid}`, title || 'WorkSuite Meet', false),
    openExternal: (url) => void openExternalSafely(url),
    onChange: (meetings) => root.tray.update({ meetings }),
  });
  // Cheque Manager's print station (D02–D06): the leaf's layout is fetched here from the server, printed at exact size.
  const chequeStation = new ChequeStation({
    http: root.http,
    deviceId: () => root.device.current()?.id ?? null,
    host: () => root.device.deviceName(),
    version: () => app.getVersion(),
    printers: (sender) => listPrinters(sender ? BrowserWindow.fromWebContents(sender) : null),
  });
  // Sales' approvals (WS-OMS-SRS-001 D-05, FR-APR-10): Approve and Open on the banner; printing on this computer.
  const salesDesk = new SalesDesk({
    http: root.http,
    config: root.db,
    origin: () => root.auth.getServer()?.origin ?? null,
    notify: (n) => root.notifications.notify(n),
    markRead: (ids) => root.notifications.markRead(ids),
    enabled: () => root.sessionCtl.isReady() && !root.lock.isLocked() && canOpenApp('sales', root.sessionCtl.visibleApps()),
    open: (route) => navigate({ route, source: 'notification' }),
    refreshCounts: () => void root.notifications.refreshCounts(),
    toast: (kind, text) => broadcast('toast', { kind, text }),
    printers: async (sender) => (await listPrinters(BrowserWindow.fromWebContents(sender))).map((p) => p.name),
    saveDialog: async (sender, defaultPath) => {
      const w = BrowserWindow.fromWebContents(sender);
      const opts: Electron.SaveDialogOptions = { title: 'Save as PDF', defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] };
      const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      return res.canceled || !res.filePath ? null : res.filePath;
    },
    documents: () => app.getPath('documents'),
    temp: () => app.getPath('temp'),
    openPath: async (path) => void (await shell.openPath(path)),
    reveal: (path) => shell.showItemInFolder(path),
  });
  // Billing's eight events (SRS-BIL-001 G-10): a banner in Billing's words whose Open goes to the invoice, payment, note or profile.
  const billingBanners = new BillingBanners({
    notify: (n) => root.notifications.notify(n),
    markRead: (ids) => root.notifications.markRead(ids),
    enabled: () => root.sessionCtl.isReady() && !root.lock.isLocked() && canOpenApp('billing', root.sessionCtl.visibleApps()),
    open: (route) => navigate({ route, source: 'notification' }),
  });
  // Purchasing's approvals (SRS-PUR-001 G-21): Approve and Open on the banner; the documents waiting on me on the badge.
  const purchaseDesk = new PurchaseDesk({
    get: (path, query) => root.http.get(path, { query }),
    post: (path, body) => root.http.post(path, body),
    notify: (n) => root.notifications.notify(n),
    markRead: (ids) => root.notifications.markRead(ids),
    enabled: () => root.sessionCtl.isReady() && !root.lock.isLocked() && canOpenApp('purchase', root.sessionCtl.visibleApps()),
    open: (route) => navigate({ route, source: 'notification' }),
    toast: (kind, text) => broadcast('toast', { kind, text }),
    changed: () => root.emitStatus(),
  });
  root.notifications.claim = (n) => supportNotices.claim(n) || projects.claim(n) || root.mailAlerts.claim(n) || meetingsDesk.claim(n) || salesDesk.claim(n) || purchaseDesk.claim(n) || billingBanners.claim(n);
  root.notifications.onRefresh = () => {
    void supportNotices.refreshBadges();
    void purchaseDesk.refresh();
  };
  return { chequeStation, desktopAccounts, flushNavigation, handleDeepLink, liveMeetWindow, meetAction, meetingsDesk, navigate, officeAiPolicy, officeApp, officeSignIn, openAiChanges, openLink, openNextContact, openQuickReply, pendingNav, projects, purchaseDesk, quickLatest, salesDesk, supportDesk, supportNotices, supportUrgent, syncSupportKeys };
}
