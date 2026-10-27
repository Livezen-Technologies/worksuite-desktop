import type { BoardVault } from '../../services/board-vault';
import type { DesktopSettingsService } from '../../services/desktop-settings';
import type { ElearningOffline } from '../../services/elearning-offline';
import type { EventDesk } from '../../services/event-desk';
import type { MarketingPulse } from '../../services/marketing-pulse';
import type { CallbackReminders } from '../../services/marketing-reminders';
import type { NextContactKey } from '../../services/marketing-shortcut';
import type { MeetKeys } from '../../services/meet-keys';
import type { MeetNext } from '../../services/meet-next';
import type { MeetingsDesk } from '../../services/meetings-desk';
import type { OfflineCache } from '../../services/offline-cache';
import type { PhoneService } from '../../services/phone';
import type { PurchaseDesk } from '../../services/purchase-desk';
import type { SinhalaService } from '../../services/sinhala';
import type { TrayService } from '../../tray/tray';
import { reportProblemUrl } from '../../updater/update-center';
import type { UpdaterService } from '../../updater/updater';
import type { WindowManager } from '../../windows/manager';
import { broadcast } from '../events';
import { buildMenu } from '../menu';
import { canOpenApp, canOpenRoute, visibleAppIds } from '@shared/access';
import { withoutDisabledIds } from '@shared/desktop-settings';
import type { Bootstrap, NavigateRequest } from '@shared/types';
import { app, shell } from 'electron';
import type { Restaurant } from '../../services/restaurant/index';

/**
 * What the person may open (shared/access.ts): the menu, the access the session grants each app, and what the local
 * caches may keep. Moved out of the composition root (electron/main/index.ts) unchanged (audit D-G13).
 */
/** What wireAccess reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WireAccessDeps {
  readonly board: BoardVault;
  readonly cache: OfflineCache;
  readonly callbackReminders: CallbackReminders;
  readonly desktopSettings: DesktopSettingsService;
  readonly elearning: ElearningOffline;
  readonly emitStatus: () => void;
  readonly eventDesk: EventDesk;
  readonly log: { debug: (msg: string, data?: unknown) => void; info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void; error: (msg: string, data?: unknown) => void; };
  readonly marketingPulse: MarketingPulse;
  readonly meetingsDesk: MeetingsDesk;
  readonly meetKeys: MeetKeys;
  readonly meetNext: MeetNext;
  readonly navigate: (asked: NavigateRequest) => void;
  readonly nextContactKey: NextContactKey;
  readonly phone: PhoneService;
  readonly purchaseDesk: PurchaseDesk;
  readonly quit: () => void;
  readonly restaurant: Restaurant;
  readonly sinhala: SinhalaService;
  readonly tray: TrayService;
  readonly updater: UpdaterService;
  readonly windows: WindowManager;
}

export function wireAccess(root: WireAccessDeps) {
  // ── what the person may open (shared/access.ts) ───────────────────────
  // READ_CACHE: which module's answers a GET path is.
  const CACHE_PREFIXES: Array<[string, string]> = [
    // User guides: the list and each guide read, for reading offline.
    ['/api/help/guides', 'help'],
    ['/api/mail/folders', 'mail'],
    ['/api/mail/mailboxes', 'mail'],
    ['/api/mail/messages', 'mail'],
    // The sidebar's counts, labels, the list's layout and the sync card: Mail opens offline as it was left.
    ['/api/mail/views', 'mail'],
    ['/api/mail/labels', 'mail'],
    ['/api/mail/prefs', 'mail'],
    ['/api/mail/sync/status', 'mail'],
    // Mail protection (ENH-MAIL-04): the quarantine as last seen opens offline; releasing it waits for the connection.
    ['/api/mail/quarantine', 'mail'],
    ['/api/whatsapp/accounts', 'chat'],
    ['/api/whatsapp/chats', 'chat'],
    ['/api/chat/rooms', 'chat'],
    ['/api/chat/messages', 'chat'],
    // Website chats: the list and each conversation opened, so a thread opens at once from its last copy (#239).
    ['/api/chat/widget-admin/conversations', 'chat'],
    // Missed chats and Offline enquiries too, so every website list opens at once from its last copy (#252).
    ['/api/chat/widget-admin/missed', 'chat'],
    ['/api/chat/widget-admin/offline', 'chat'],
    // The Live dashboard (its summary, the full answer) and who is on the sites, so it opens at once from its last copy (#248).
    ['/api/chat/widget-admin/dashboard', 'chat'],
    ['/api/chat/widget-admin/visitors', 'chat'],
    ['/api/calendar/events', 'calendar'],
    // Social Media Manager (SMM-DSK-004): the calendar, drafts and the accounts they go to, as last seen, open offline.
    // Scheduling and publishing stay on the server; nothing here is sent from the cache.
    ['/api/social-media/posts', 'social-media'],
    ['/api/social-media/accounts', 'social-media'],
    ['/api/social-media/brands', 'social-media'],
    ['/api/tasks', 'tasks'],
    ['/api/task-lists', 'tasks'],
    // WorkSuite Projects (PRJ-DSK-04): the boards opened (the pinned ones are fetched ahead by the screens), my work,
    // my time for the last 30 days, the list and the counts, so the app opens offline as it was last seen.
    ['/api/projects', 'projects'],
    ['/api/crm/leads', 'crm'],
    ['/api/hr/attendance/me', 'hr'],
    ['/api/hr/leave', 'hr'],
    ['/api/hr/approvals/pending', 'hr'],
    ['/api/files/browse', 'files'],
    // How Drive opens each kind of Office file (web-api §6), so an Office file offline still goes to its tab.
    ['/api/files/office/types', 'files'],
    ['/api/dashboard/home', 'home'],
    ['/api/notifications', 'notifications'],
    // A workshop terminal opens with WorkSuite out of reach: the technician's work and the board as last seen,
    // and the job cards (with their check-in, estimate, work and delivery), vehicles, customers and workshop.
    ['/api/garage/v1/options', 'garage'],
    ['/api/garage/v1/overview', 'garage'],
    ['/api/garage/v1/board', 'garage'],
    ['/api/garage/v1/my-work', 'garage'],
    ['/api/garage/v1/jobs', 'garage'],
    ['/api/garage/v1/vehicles', 'garage'],
    ['/api/garage/v1/customers', 'garage'],
    ['/api/garage/v1/workshop', 'garage'],
    // A learner opens My Learning, the catalogue and their courses' outlines (with the lessons already opened)
    // from the last copy; a course's lesson files kept offline are elearning-offline.ts's, not this cache's.
    // A till opens with WorkSuite out of reach: what the cashier may do, the registers and their drawer as last seen.
    ['/api/pos/options', 'pos'],
    ['/api/pos/registers', 'pos'],
    ['/api/pos/sessions', 'pos'],
    ['/api/pos/setup', 'pos'],
    ['/api/elearning/v1/options', 'elearning'],
    ['/api/elearning/v1/me/learning', 'elearning'],
    ['/api/elearning/v1/me/courses', 'elearning'],
    ['/api/elearning/v1/me/lessons', 'elearning'],
    ['/api/elearning/v1/catalog', 'elearning'],
    ['/api/elearning/v1/categories', 'elearning'],
    // Support: the rail and its counts, the lists, every ticket opened and the desk's vocabulary, so the desk opens
    // offline as it was left; who else is on a ticket is never taken from this copy (modules/support/api.ts).
    ['/api/support/v1/meta', 'support'],
    ['/api/support/v1/views', 'support'],
    ['/api/support/v1/badges', 'support'],
    ['/api/support/v1/tickets', 'support'],
    ['/api/support/v1/agents', 'support'],
    ['/api/support/v1/canned', 'support'],
    // Sales (WS-OMS-SRS-001 FR-DSK-07): the dashboard, the companies and every order list and order opened, so recent
    // orders read offline as last seen. Read only: every write in the app waits for the connection.
    ['/api/oms/overview', 'sales'],
    ['/api/oms/organizations', 'sales'],
    ['/api/oms/orders', 'sales'],
    // Billing (SRS-BIL-001 §16, per Desktop offline mode): the dashboard, the companies, every invoice list and invoice
    // opened, payments and customers, so Billing reads offline as last seen. Read only: its writes wait for the connection.
    ['/api/billing/dashboard', 'billing'],
    ['/api/billing/organizations', 'billing'],
    ['/api/billing/invoices', 'billing'],
    ['/api/billing/payments', 'billing'],
    ['/api/billing/customers', 'billing'],
    // Purchasing (SRS-PUR-001 G-21): the dashboard, the approvals waiting on me, the order, receipt, request, RFQ, bill,
    // payment and return lists and every one opened, and the vendors, so Purchasing reads offline as last seen. Read
    // only: every write in the app waits for the connection.
    ['/api/inventory/purchase/dashboard', 'purchase'],
    ['/api/inventory/purchase-orders', 'purchase'],
    ['/api/inventory/receipts', 'purchase'],
    ['/api/inventory/requests', 'purchase'],
    ['/api/inventory/quotations', 'purchase'],
    ['/api/inventory/bills', 'purchase'],
    ['/api/inventory/payments', 'purchase'],
    ['/api/inventory/payables', 'purchase'],
    ['/api/inventory/returns', 'purchase'],
    ['/api/inventory/vendors', 'purchase'],
    ['/api/purchase/approvals', 'purchase'],
    ['/api/purchase/qc', 'purchase'],
    ['/api/purchase/agreements', 'purchase'],
    ['/api/purchase/payment-runs', 'purchase'],
    ['/api/purchase/payables', 'purchase'],
    ['/api/purchase/landed-costs', 'purchase'],
    // Inventory (the desktop's offline stock count): the dashboard, the companies' warehouses, the products and their
    // categories, and every count list and count sheet opened, so a count goes on from this computer's copy with
    // WorkSuite out of reach. The counts typed there are queued (offline:submit) and sent in order when it is back;
    // nothing is posted to stock offline.
    ['/api/inventory/companies', 'inventory'],
    ['/api/inventory/dashboard', 'inventory'],
    ['/api/inventory/warehouses', 'inventory'],
    ['/api/inventory/products', 'inventory'],
    ['/api/inventory/categories', 'inventory'],
    ['/api/inventory/counts', 'inventory'],
    // Hotel PMS keeps the rack and the front desk's lists per property (shared/pms-cache.ts: `pmsCached`), below;
    // the Events tab its options, the events and their gates (shared/event-desk.ts: `eventsCached`).
  ];
  const rebuildMenu = (visible: Set<string>): void =>
    buildMenu(
      (id, arg) => {
        root.windows.showMain();
        broadcast('command', { id, arg });
      },
      {
        checkUpdates: () => void root.updater.check().then(() => root.navigate({ route: '/settings/updates', source: 'menu' })),
        diagnostics: () => root.navigate({ route: '/diagnostics', source: 'menu' }),
        reportProblem: () => void shell.openExternal(reportProblemUrl(app.getVersion())),
        quit: root.quit,
      },
      { ai: canOpenApp('ai', visible) },
    );
  /**
   * A new bootstrap: the tray and the menu offer only the apps it allows, and
   * what this computer saved of an app the person no longer has is removed.
   * (Every window gets it as `session:changed`; the Shell closes those tabs.)
   */
  const applyAccess = (b: Bootstrap | null): void => {
    const visible = withoutDisabledIds(visibleAppIds(b), root.desktopSettings.disabledModules());
    root.tray.update({ apps: [...visible] });
    rebuildMenu(visible);
    // Marketing given or taken away (or another organisation): its counts, reminders and key follow.
    root.marketingPulse.poke();
    root.callbackReminders.poke();
    root.nextContactKey.sync();
    root.meetKeys.sync();
    root.meetNext.poke();
    root.meetingsDesk.poke();
    // Purchasing given or taken away: the documents waiting on me follow on the badge.
    void root.purchaseDesk.refresh();
    // Sinhala Tools turned on or off for the organisation, or this person: asked again (WF-SI-05).
    if (b) void root.sinhala.sync();
    if (b) {
      const closed = root.windows.closeWhere((route) => !canOpenRoute(route, visible));
      if (closed) root.log.info('windows closed: app no longer available', { closed });
    }
    if (b) {
      for (const module of root.cache.modules(b.user.id)) {
        if (!canOpenApp(module, visible) && root.cache.clearModule(b.user.id, module) > 0) root.log.info('offline data removed: app no longer available', { module });
      }
      // Courses kept offline go with the app.
      if (!canOpenApp('elearning', visible)) void root.elearning.wipeUser(b.user.id).catch((e) => root.log.warn('offline courses not removed', { error: String(e) }));
      // Board packs kept offline go with the Board app.
      if (!canOpenApp('board', visible)) root.board.wipe('policy');
      // So do an event desk's copies of the gates' tickets (scans still unsent wait, should the app come back).
      if (!canOpenApp('events', visible)) root.eventDesk.signedOut(b.user.id);
      if (!canOpenApp('restaurant', visible)) root.restaurant.signedOut(b.user.id);
      // The Phone's global shortcuts go with it.
      if (!canOpenApp('phone', visible)) root.phone.reset();
    }
    root.emitStatus();
  };
  return { CACHE_PREFIXES, applyAccess, rebuildMenu };
}
