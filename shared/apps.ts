/**
 * The desktop app catalogue and the seven visibility gates (§4.3, FR-REG-01,
 * WF-02).
 *
 *   Visible = Installed ∧ Enabled globally ∧ Enabled for organization ∧
 *             Licensed ∧ Desktop supported ∧ User app access ∧ Module permission
 *
 * The first four and "user app access" are decided by the server: the
 * bootstrap carries the app slugs this user may open (`apps`), exactly as
 * WorkSuite's AppGate resolves them for the web. "Desktop supported" is
 * decided here, by whether this build carries a desktop module for the app or
 * can hand it to the browser. "Module permission" is the permission the app's
 * own screens demand — gating on anything tidier has repeatedly hidden modules
 * from the people who needed them (see web/src/core/sidebar/apps.ts).
 *
 * Apps that fail a gate are not returned at all: no greyed-out entries
 * (FR-REG-05). One exception, decided by the server too: an app the person
 * may open only for themselves (`selfService`, e.g. Expenses for filing
 * their own claims) is returned, marked `selfService`, even without the app.
 */

export type LauncherGroup = 'communication' | 'work' | 'business' | 'people' | 'operations' | 'admin';

export const LAUNCHER_GROUPS: Array<{ id: LauncherGroup; label: string }> = [
  { id: 'communication', label: 'Communication' },
  { id: 'work', label: 'Work' },
  { id: 'business', label: 'Business' },
  { id: 'people', label: 'People' },
  { id: 'operations', label: 'Operations' },
  { id: 'admin', label: 'Admin' },
];

/**
 * How the desktop presents an app.
 *  - `native`: a desktop module in this build renders it in a tab.
 *  - `browser`: no desktop module yet; the launcher opens it in the user's
 *    browser on the WorkSuite server (§14 schedules each module's desktop
 *    screens by phase).
 */
export type AppSurface = 'native' | 'browser';

export interface AppDefinition {
  id: string;
  label: string;
  group: LauncherGroup;
  /** Icon name understood by the renderer's icon set. */
  icon: string;
  /** Server app slug checked against the user's app access. Omitted = not app-gated. */
  app?: string;
  /** Permission the app's own screens demand. Omitted = no permission gate. */
  perm?: string;
  /** Path of the app in the WorkSuite web client. */
  webPath: string;
  surface: AppSurface;
  /** Sidebar section for native apps shown by default. */
  sidebar?: 'work' | 'business';
  order: number;
  /** Badge counter key (from /api/badges or module unread endpoints). */
  badge?: 'mail' | 'chat' | 'tasks' | 'notifications';
  keywords?: string;
  /** Set on a visible app the person has only in self-service mode (their own claims), not the full app. */
  selfService?: boolean;
  /**
   * A channel of this app's screen, not an app of its own in navigation (shared/channels.ts): WhatsApp is a channel
   * of Chat (worksuite-desktop#35). Its access is its own; the sidebar, launcher and search list it only for someone
   * who has it and not its host, and it opens at `route`.
   */
  channelOf?: string;
  /** The desktop route the app opens at, when it is not `/<id>`. */
  route?: string;
}

export const APP_CATALOGUE: AppDefinition[] = [
  // Everyday — native desktop modules (Phase 1, §18).
  { id: 'home', label: 'Home', group: 'work', icon: 'home', webPath: '/', surface: 'native', sidebar: 'work', order: 10, keywords: 'dashboard start overview' },
  { id: 'activity', label: 'Activity', group: 'work', icon: 'activity', perm: 'analytics.view', webPath: '/activity', surface: 'native', sidebar: 'work', order: 20, keywords: 'feed history timeline' },
  { id: 'mail', label: 'Mail', group: 'communication', icon: 'mail', app: 'mail', webPath: '/mail', surface: 'native', sidebar: 'work', order: 30, badge: 'mail', keywords: 'email inbox message' },
  { id: 'chat', label: 'Chat', group: 'communication', icon: 'chat', app: 'chat', webPath: '/chat', surface: 'native', sidebar: 'work', order: 40, badge: 'chat', keywords: 'message im team' },
  { id: 'calendar', label: 'Calendar', group: 'work', icon: 'calendar', app: 'calendar', webPath: '/calendar', surface: 'native', sidebar: 'work', order: 50, keywords: 'events meetings schedule' },
  { id: 'tasks', label: 'Tasks', group: 'work', icon: 'tasks', app: 'tasks', webPath: '/tasks', surface: 'native', sidebar: 'work', order: 60, badge: 'tasks', keywords: 'todo to-do' },
  { id: 'files', label: 'Files', group: 'work', icon: 'folder', app: 'drive', webPath: '/files', surface: 'native', sidebar: 'work', order: 70, keywords: 'drive documents folders storage' },
  // Office: new documents, spreadsheets and presentations, templates and the recent ones (src/modules/office/OfficeHome).
  // A part of Files (shared/access APP_PARTS), so it shows with the Drive; a document is a tab of its own, `/office/<id>`.
  { id: 'office', label: 'Office', group: 'work', icon: 'file-text', app: 'drive', webPath: '/office', surface: 'native', order: 71, keywords: 'word excel powerpoint document spreadsheet presentation docx xlsx pptx template new write' },
  // PDF Studio: native here for everyone signed in (a PDF from this computer needs no app); a Drive file is still the
  // server's to allow. The web's `/pdf?file=<id>` links open the file here.
  { id: 'pdf', label: 'PDF Studio', group: 'work', icon: 'file-text', webPath: '/pdf', surface: 'native', order: 72, keywords: 'pdf viewer reader acrobat document open print search bookmarks' },
  { id: 'crm', label: 'CRM', group: 'business', icon: 'users', app: 'crm', perm: 'crm.view', webPath: '/crm', surface: 'native', sidebar: 'business', order: 110, keywords: 'leads customers pipeline' },
  // The server's OMS: `/oms?order=` (what notifications and shares link to) opens here as `/sales?order=`.
  { id: 'sales', label: 'Sales & Orders', group: 'business', icon: 'trending-up', app: 'oms', perm: 'oms.view', webPath: '/oms', surface: 'native', sidebar: 'business', order: 120, keywords: 'orders sales order fulfilment dispatch returns' },
  // `/billing?invoice=` and `/billing/invoices/<id>` (notifications, shares, chat cards) open the invoice here.
  { id: 'billing', label: 'Invoices', group: 'business', icon: 'receipt', app: 'billing', perm: 'billing.view', webPath: '/billing', surface: 'native', sidebar: 'business', order: 125, keywords: 'billing invoice invoices payments receipts owed overdue' },
  // `/inventory?product=` and `/inventory/products/<id>` open the product here.
  { id: 'inventory', label: 'Inventory', group: 'business', icon: 'package', app: 'inventory', perm: 'inventory.view', webPath: '/inventory', surface: 'native', sidebar: 'business', order: 128, keywords: 'inventory stock products warehouse movements catalogue sku barcode' },
  // HR carries no app slug: there is no `hr` row in `applications`, and its
  // self-service screens answer for the caller alone (web/src/core/sidebar/apps.ts).
  { id: 'hr', label: 'HR', group: 'people', icon: 'id-card', webPath: '/hr', surface: 'native', sidebar: 'business', order: 140, keywords: 'people leave attendance clock in' },

  { id: 'meet', label: 'Meet', group: 'communication', icon: 'video', app: 'meet', webPath: '/meet', surface: 'native', sidebar: 'work', order: 45, keywords: 'video call meeting join code' },
  // Agendas, attendance and minutes. Not an application on the server — the
  // `meeting.view` permission is its only gate (AppGate::CORE notes).
  { id: 'meetings', label: 'Meetings', group: 'work', icon: 'calendar-clock', perm: 'meeting.view', webPath: '/meetings', surface: 'native', sidebar: 'work', order: 55, keywords: 'agenda minutes attendance rooms schedule' },

  // A channel of Chat (worksuite-desktop#35): no entry of its own beside Chat. `/whatsapp?chat=` (notifications,
  // shares) opens that conversation in Chat › WhatsApp.
  { id: 'whatsapp', label: 'WhatsApp', group: 'communication', icon: 'phone', app: 'whatsapp', webPath: '/whatsapp', surface: 'native', channelOf: 'chat', route: '/chat?channel=whatsapp', order: 47, keywords: 'message wa customers' },

  // Opened in the browser until their desktop modules ship (§14, §18).
  { id: 'social', label: 'Social', group: 'communication', icon: 'megaphone', app: 'social', webPath: '/social', surface: 'browser', order: 46 },
  { id: 'projects', label: 'Projects', group: 'work', icon: 'kanban', app: 'projects', webPath: '/projects', surface: 'browser', order: 170 },
  // `/tenders?open=<id>` (notifications, search, the stream) opens that tender here.
  { id: 'tenders', label: 'Tenders', group: 'business', icon: 'file-text', app: 'tender', perm: 'tender.view', webPath: '/tenders', surface: 'native', sidebar: 'business', order: 129, keywords: 'tenders bids bid rfq rfp procurement pipeline award' },
  { id: 'notes', label: 'Notes', group: 'work', icon: 'notebook', app: 'notes', webPath: '/notes', surface: 'native', order: 190, keywords: 'notebook journal meeting notes' },
  { id: 'contacts', label: 'Contacts', group: 'work', icon: 'contact', app: 'contacts', webPath: '/contacts', surface: 'native', order: 80 },

  // `/finance?tab=<view>&company=<id>`, the web's view names; screens not built here yet open in the browser from its rail.
  { id: 'finance', label: 'Finance', group: 'business', icon: 'landmark', app: 'finance', perm: 'finance.view', webPath: '/finance', surface: 'native', sidebar: 'business', order: 130, keywords: 'accounts ledger journals general ledger trial balance chart of accounts periods books accounting' },
  // `/expenses?tab=<view>&org=<ids|all>`; `/expenses?claim=12` (notifications) opens that claim.
  { id: 'expenses', label: 'Expenses', group: 'business', icon: 'wallet', app: 'expenses', webPath: '/expenses', surface: 'native', sidebar: 'business', order: 135, keywords: 'expense claims receipts reimbursement advances petty cash corporate cards mileage per diem budgets policies subscriptions' },
  { id: 'purchasing', label: 'Purchasing', group: 'business', icon: 'cart', app: 'inventory', webPath: '/purchase', surface: 'browser', order: 161 },
  { id: 'subscriptions', label: 'Subscriptions', group: 'business', icon: 'repeat', app: 'subscriptions', webPath: '/subscriptions', surface: 'browser', order: 165 },
  { id: 'marketing', label: 'Marketing', group: 'business', icon: 'megaphone', app: 'marketing', webPath: '/marketing', surface: 'browser', order: 166 },
  { id: 'payroll', label: 'Payroll', group: 'people', icon: 'banknote', app: 'payroll', perm: 'payroll.view', webPath: '/payroll', surface: 'browser', order: 150 },
  { id: 'appointments', label: 'Appointments', group: 'people', icon: 'calendar-clock', app: 'appointments', webPath: '/appointments', surface: 'browser', order: 155 },
  // A salon's front desk: native here (the counter PC); the owners' screens open on the web from its rail.
  { id: 'salon', label: 'SalonMate', group: 'business', icon: 'scissors', app: 'salon', perm: 'salon.view', webPath: '/salon', surface: 'native', sidebar: 'business', order: 131, keywords: 'salon hair beauty front desk walk-in check-in stylists clients bookings' },
  // A workshop's counter, board, technician terminal and parts counter: native here; check-in, estimates, QC and delivery open on the web.
  { id: 'garage', label: 'Garage', group: 'business', icon: 'wrench', app: 'garage', perm: 'garage.access', webPath: '/garage', surface: 'native', sidebar: 'business', order: 132, keywords: 'garage workshop service center vehicle car repair job card walk-in technician parts mechanic' },
  // Restaurant Manager's till, kitchen screen and print agent: native here (this computer as a paired terminal); the back
  // office — menu, floor design, staff, reports, day close — opens on the web. Its notifications open the floor, an order or the KDS.
  { id: 'restaurant', label: 'Restaurant', group: 'business', icon: 'concierge', app: 'restaurant', perm: 'restaurant.access', webPath: '/restaurant', surface: 'native', sidebar: 'business', order: 132.5, keywords: 'restaurant pos point of sale till waiter cashier table floor order menu kitchen kds kot expo bill split payment cashier session print agent' },
  // A hotel's front desk, cashier and night audit: native here (the desk's computer). The server's notifications
  // (`/pms/reservations/<id>`, `/pms/folios/<id>`, `/pms/rooms/<id>`, `/pms/front-desk?arrivals=`, `/pms/night-audit`…)
  // open here; the back office — rates, rooms, packages, taxes, reports, settings — is the web's.
  // WorkSuite Events' desk: check-in, scanning, walk-ins, badges and offline check-in at an event's gate, and the
  // organiser's read of an event (Event 360, registrations, attendees, the day's program). Planning is the web's. The
  // server's notifications (`/events/<id>`, `/events/<id>/registrations/<id>`, `/events/<id>/checkin/reconciliation`,
  // `/events/<id>/devices`…) open here.
  { id: 'events', label: 'Events', group: 'business', icon: 'ticket', app: 'events', perm: 'events.access', webPath: '/events', surface: 'native', sidebar: 'business', order: 134, keywords: 'events event desk check-in check in scan qr ticket gate badge print walk-in attendees registrations conference expo summit' },
  { id: 'pms', label: 'Hotel PMS', group: 'business', icon: 'bed', app: 'pms', perm: 'pms.access', webPath: '/pms', surface: 'native', sidebar: 'business', order: 133, keywords: 'hotel pms property front desk reception room rack arrivals departures in house check-in check-out walk-in reservation booking folio cashier night audit guest housekeeping' },
  // Learning, for everybody given eLearning: My Learning, the catalogue and taking courses; the training
  // team's courses, builder, enrolment, grading and dashboard by permission. `/elearning/my/courses/<id>`
  // (the server's notifications) opens the course here.
  { id: 'elearning', label: 'eLearning', group: 'people', icon: 'graduation-cap', app: 'elearning', perm: 'elearning.access', webPath: '/elearning', surface: 'native', sidebar: 'business', order: 145, keywords: 'elearning learning lms training courses course catalogue lessons quiz quizzes assessment assignment grading enrol enrolment my learning' },
  { id: 'support', label: 'Support', group: 'operations', icon: 'life-buoy', app: 'tickets', webPath: '/tickets', surface: 'browser', order: 200 },
  { id: 'assets', label: 'Assets', group: 'operations', icon: 'box', app: 'assets', webPath: '/assets', surface: 'browser', order: 210 },
  { id: 'amc', label: 'AMC & Service', group: 'operations', icon: 'wrench', app: 'amc', webPath: '/amc', surface: 'browser', order: 215 },
  // A shop's till: native here (the counter PC) — pairing, the drawer's shift, selling (offline too), receipts, the drawer
  // kick and a customer display. Tills, registers and settings are managed on the web.
  { id: 'pos', label: 'POS', group: 'operations', icon: 'store', app: 'pos', perm: 'pos.access', webPath: '/pos', surface: 'native', sidebar: 'business', order: 220, keywords: 'pos point of sale till register checkout cashier sell sale receipt barcode drawer shift float z report' },
  { id: 'admin', label: 'Admin Center', group: 'admin', icon: 'settings-2', perm: 'users.view', webPath: '/admin', surface: 'browser', order: 500 },
  { id: 'ai', label: 'AI Assistant', group: 'admin', icon: 'sparkles', app: 'ai', webPath: '/ai', surface: 'browser', order: 510 },
];

/** What the server said the user may reach. */
export interface AccessGrant {
  /** App slugs the user may open; `'*'` = all; `null` = the installation does not gate apps. */
  apps: string[] | '*' | null;
  /** Permission keys; `'*'` inside means super-admin. */
  permissions: string[];
  /** App slugs the server resolved through all its gates (/desktop/v1), when it provides them. */
  serverApps?: string[] | null;
  /** App slugs the person may open only in self-service mode, lacking the full app (the bootstrap's `self_service`). */
  selfService?: string[] | null;
}

export function hasPermission(grant: AccessGrant, perm: string | undefined): boolean {
  if (!perm) return true;
  return grant.permissions.includes('*') || grant.permissions.includes(perm);
}

export function hasAppAccess(grant: AccessGrant, slug: string | undefined): boolean {
  if (!slug) return true;
  if (grant.apps === null || grant.apps === '*') return true;
  return grant.apps.includes('*') || grant.apps.includes(slug);
}

/** The full app, through every gate. */
function hasFullApp(def: AppDefinition, grant: AccessGrant): boolean {
  // When the server resolves the gates itself (/desktop/v1/apps), its answer
  // is authoritative for gates 1–4 and 6: an app it did not return is not
  // shown, whatever the local catalogue says.
  if (grant.serverApps && def.app && !grant.serverApps.includes(def.app)) return false;
  return hasAppAccess(grant, def.app) && hasPermission(grant, def.perm);
}

/**
 * The person has this app only in self-service mode: the server lists its
 * slug in `self_service` (they may file their own claims) and they lack the
 * full app. The server shows them only their own part of it.
 */
export function isSelfService(def: AppDefinition, grant: AccessGrant): boolean {
  return !!def.app && !!grant.selfService?.includes(def.app) && !hasFullApp(def, grant);
}

export function isAppVisible(def: AppDefinition, grant: AccessGrant): boolean {
  return hasFullApp(def, grant) || isSelfService(def, grant);
}

/** The apps the person may open, in order; a self-service one is marked `selfService`. */
export function visibleApps(grant: AccessGrant, catalogue: AppDefinition[] = APP_CATALOGUE): AppDefinition[] {
  return catalogue
    .filter((d) => isAppVisible(d, grant))
    .map((d) => (isSelfService(d, grant) ? { ...d, selfService: true } : d))
    .sort((a, b) => a.order - b.order);
}

/**
 * The apps navigation lists — the sidebar, the launcher, search's apps: a channel is inside its host (WhatsApp in
 * Chat) and has no entry of its own, unless the person has the channel and not the host.
 */
export function navApps<T extends Pick<AppDefinition, 'id' | 'channelOf'>>(apps: readonly T[]): T[] {
  const ids = new Set(apps.map((a) => a.id));
  return apps.filter((a) => !a.channelOf || !ids.has(a.channelOf));
}

/** Where opening an app goes: its own route, or `/<id>`. */
export function appRoute(a: Pick<AppDefinition, 'id' | 'route'>): string {
  return a.route ?? `/${a.id}`;
}

export function findApp(id: string, catalogue: AppDefinition[] = APP_CATALOGUE): AppDefinition | undefined {
  return catalogue.find((a) => a.id === id);
}
