import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { APP_PARTS, canOpenApp, SHELL_SCREENS, type VisibleApps } from '@shared/access';
import { CHANNEL_APPS } from '@shared/channels';
import { APP_CATALOGUE } from '@shared/apps';
import { defineDesktopManifest, validateManifest, type DesktopManifest, type DesktopManifestInput } from '@shared/manifest';

/**
 * DesktopAppRegistry, renderer half (FR-REG-01..07, §15).
 *
 * Each desktop module declares a manifest and a lazily-loaded screen. The
 * manifest is validated against the module contract before anything from it
 * is registered; an invalid one is dropped and logged, never shown. The
 * server decides which apps the user may see (shared/apps.ts); this decides
 * which of them the desktop can render natively.
 */
export interface ModuleProps {
  tabId: string;
  route: string;
  active: boolean;
}

export interface DesktopModule {
  id: string;
  manifest: DesktopManifest;
  component: LazyExoticComponent<ComponentType<ModuleProps>>;
  /** Available to everyone signed in, regardless of app access (a shell screen, shared/access.ts). */
  always?: boolean;
  /** Available to whoever may open this app (a part of another app, in its own windows; shared/access.ts). */
  requires?: string;
}

const DEFS: Array<{ input: DesktopManifestInput; load: () => Promise<{ default: ComponentType<ModuleProps> }> }> = [
  {
    input: defineDesktopManifest({
      id: 'home', name: 'Home', icon: 'home', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/dashboard/home'] },
      native: ['notifications'],
      widgets: [{ id: 'todays-work', size: 'md' }, { id: 'calendar', size: 'md' }, { id: 'waiting-for-me', size: 'md' }, { id: 'activity', size: 'md' }, { id: 'files', size: 'md' }, { id: 'summary', size: 'md' }],
    }),
    load: () => import('./home/HomePage'),
  },
  {
    input: defineDesktopManifest({ id: 'activity', name: 'Activity', icon: 'activity', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' } }),
    load: () => import('./activity/ActivityPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'mail', name: 'Mail', icon: 'mail', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'DRAFTS', entities: ['draft'], cache: ['/api/mail/folders', '/api/mail/messages', '/api/mail/mailboxes', '/api/mail/views', '/api/mail/labels', '/api/mail/prefs', '/api/mail/sync/status', '/api/mail/states'] },
      native: ['notifications', 'file-drop', 'printing'],
      quickActions: [{ id: 'compose', label: 'New Email', route: '/mail?compose=1' }],
      deepLinks: ['mail', 'mail/:id'],
    }),
    load: () => import('./mail/MailPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'chat', name: 'Chat', icon: 'chat', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'PARTIAL_WRITE', entities: ['message'], cache: ['/api/chat/rooms', '/api/chat/messages'] },
      native: ['notifications', 'file-drop'],
      windows: [{ id: 'chat-mini', route: '/chat', alwaysOnTop: true }],
      quickActions: [{ id: 'open-chat', label: 'Open Chat', route: '/chat' }],
      deepLinks: ['chat', 'chat/:id'],
    }),
    load: () => import('./chat/ChatPage'),
  },
  {
    // Phone (WS-VOIP-SRS-001): the softphone, call history, voicemail, forwarding, supervision and telephony
    // administration over WorkSuite's Voip module (/api/voip). The compact phone opens in a window of its own (D01).
    input: defineDesktopManifest({
      id: 'phone', name: 'Phone', icon: 'phone', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      native: ['notifications', 'microphone'],
      windows: [{ id: 'phone', route: '/phone/compact', alwaysOnTop: true }],
      quickActions: [{ id: 'dial', label: 'Dial a number', route: '/phone' }],
      deepLinks: ['phone', 'phone/calls/:id'],
    }),
    load: () => import('./phone/PhonePage'),
  },
  {
    // Social Media Manager (WS-SMM-SRS-001, design "WorkSuite Social Media Manager — UI"): compose once for many
    // accounts, approve, schedule on a calendar or queue, answer the unified inbox and measure — over /api/social-media.
    // Publishing runs on the WorkSuite server (C3); the desktop keeps drafts and the last calendar for offline (DSK-004).
    input: defineDesktopManifest({
      id: 'social-media', name: 'Social Media', icon: 'send', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'DRAFTS', entities: ['post'], cache: ['/api/social-media/posts', '/api/social-media/accounts', '/api/social-media/brands'] },
      native: ['notifications', 'file-drop'],
      quickActions: [{ id: 'new-post', label: 'New social post', route: '/social-media/compose' }],
      deepLinks: ['social-media', 'social-media/posts/:id', 'social-media/inbox/:id', 'social-media/approvals/:id'],
    }),
    load: () => import('./social-media/SocialMediaPage'),
  },
  {
    // Chat calls: the ring and the call each open in a window of their own.
    input: defineDesktopManifest({
      id: 'calls', name: 'Calls', icon: 'phone', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      native: ['notifications'],
      windows: [{ id: 'call', route: '/calls/call', alwaysOnTop: true }, { id: 'ring', route: '/calls/ring', alwaysOnTop: true }],
    }),
    load: () => import('./calls/CallsPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'meet', name: 'Meet', icon: 'video', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      native: ['notifications'],
      windows: [{ id: 'meet', route: '/meet' }],
      quickActions: [{ id: 'new-meeting', label: 'New meeting', route: '/meet' }],
      deepLinks: ['meet', 'meet/:id'],
    }),
    load: () => import('./meet/MeetPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'meetings', name: 'Meetings', icon: 'calendar-clock', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      native: ['notifications'],
      deepLinks: ['meetings'],
    }),
    load: () => import('./meetings/MeetingsPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'calendar', name: 'Calendar', icon: 'calendar', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/calendar/events'] },
      native: ['notifications'],
    }),
    load: () => import('./calendar/CalendarPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'tasks', name: 'Tasks', icon: 'tasks', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'PARTIAL_WRITE', entities: ['task'], cache: ['/api/tasks', '/api/task-lists'] },
      native: ['notifications'],
      quickActions: [{ id: 'new-task', label: 'New Task', route: '/tasks?new=1' }],
    }),
    load: () => import('./tasks/TasksPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'notes', name: 'Notes', icon: 'notebook', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/notes', '/api/notebooks', '/api/note-sections'] },
      quickActions: [{ id: 'new-note', label: 'New Note', route: '/notes?new=1' }],
    }),
    load: () => import('./notes/NotesPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'contacts', name: 'Contacts', icon: 'contact', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/contacts', '/api/contact-groups'] },
      quickActions: [{ id: 'new-contact', label: 'New Contact', route: '/contacts?new=1' }],
    }),
    load: () => import('./contacts/ContactsPage'),
  },
  {
    input: defineDesktopManifest({
      id: 'files', name: 'Files', icon: 'folder', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/files/browse', '/api/drive/list', '/api/drive/tree', '/api/drive/home', '/api/files/office/types'] },
      native: ['file-drop', 'printing'],
      quickActions: [{ id: 'upload', label: 'Upload File', route: '/files?upload=1' }],
    }),
    load: () => import('./files/FilesPage'),
  },
  {
    // Office documents (WorkSuite Drive — ONLYOFFICE SRS §7): a Word, Excel or PowerPoint file from Drive in a
    // tab of its own, one tab per document, the Document Server's editor in an isolated view (office-editor.ts).
    // Part of Files (shared/access APP_PARTS). Editing needs WorkSuite: offline the tab says so and offers the
    // copy on this computer, if there is one (§9).
    input: defineDesktopManifest({
      id: 'office', name: 'Office', icon: 'file-text', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'NONE' },
      native: ['printing'],
      quickActions: [{ id: 'office-new', label: 'New Office document', route: '/office' }],
      fileTypes: ['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp', 'rtf', 'csv', 'docm', 'xlsm', 'pptm'],
    }),
    load: () => import('./office/OfficePage'),
  },
  {
    // PDF Studio (WorkSuite PDF Studio SRS, stage D1): PDFs from Drive, this computer and Mail open here, each in a
    // tab of its own, drawn by PDFium in a worker process per document (electron/services/pdf). Read-only for now.
    input: defineDesktopManifest({
      id: 'pdf', name: 'PDF Studio', icon: 'file-text', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'NONE' },
      native: ['file-drop', 'printing'],
      quickActions: [{ id: 'pdf-open-local', label: 'Open a PDF', route: '/pdf' }],
      fileTypes: ['pdf'],
    }),
    load: () => import('./pdf/PdfStudio'),
  },
  {
    input: defineDesktopManifest({
      id: 'crm', name: 'CRM', icon: 'users', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['lead'], cache: ['/api/crm/leads'] },
      native: ['file-drop'],
      quickActions: [{ id: 'new-lead', label: 'New Lead', route: '/crm?new=1' }],
      deepLinks: ['crm/leads/:id'],
    }),
    load: () => import('./crm/CrmShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'sales', name: 'Sales & Orders', icon: 'trending-up', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['order'], cache: ['/api/oms/orders'] },
      quickActions: [{ id: 'new-order', label: 'New Order', route: '/sales?tab=orders&new=1' }],
    }),
    load: () => import('./sales/SalesShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'billing', name: 'Invoices', icon: 'receipt', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['invoice'], cache: ['/api/billing/invoices'] },
      quickActions: [{ id: 'new-invoice', label: 'New Invoice', route: '/billing?tab=inv&new=1' }],
    }),
    load: () => import('./billing/BillingShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'tenders', name: 'Tenders', icon: 'file-text', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['tender'], cache: ['/api/tenders', '/api/tenders/dashboard', '/api/tenders/board'] },
      native: ['notifications'],
      quickActions: [{ id: 'new-tender', label: 'New Tender', route: '/tenders?make=new' }],
    }),
    load: () => import('./tenders/TendersShell'),
  },
  {
    // Figures are not cached for offline reading: a stale trial balance looks exactly like a current one.
    input: defineDesktopManifest({
      id: 'finance', name: 'Finance', icon: 'landmark', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'NONE' },
      quickActions: [{ id: 'new-journal', label: 'New Journal', route: '/finance?tab=journals&make=journal' }],
    }),
    load: () => import('./finance/FinanceShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'expenses', name: 'Expenses', icon: 'wallet', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'NONE' },
      quickActions: [{ id: 'file-expense', label: 'File an Expense', route: '/expenses?file=1' }],
    }),
    load: () => import('./expenses/ExpensesShell'),
  },
  {
    // SalonMate's front desk. Offline it reads the day's copy and keeps new clients, bookings and
    // check-ins for later (salon-sync.ts, in its own tables); money always needs WorkSuite.
    input: defineDesktopManifest({
      id: 'salon', name: 'SalonMate', icon: 'scissors', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'PARTIAL_WRITE', entities: ['client', 'visit'] },
      native: ['notifications'],
      quickActions: [
        { id: 'walk-in', label: 'Walk-in', route: '/salon?view=walkin' },
        { id: 'new-booking', label: 'New Booking', route: '/salon?view=book' },
      ],
    }),
    load: () => import('./salon/SalonShell'),
  },
  {
    // Garage: the counter, the board, the job card with check-in, estimate, work, quality and delivery,
    // vehicles, customers, reports, the workshop and its set-up. The timer's start and pause wait in the
    // offline queue with the moment they were pressed (NFR-05); every other write needs WorkSuite.
    input: defineDesktopManifest({
      id: 'garage', name: 'Garage', icon: 'wrench', contractVersion: 1, desktop: { enabled: true },
      offline: {
        mode: 'PARTIAL_WRITE',
        entities: ['work_order'],
        cache: ['/api/garage/v1/options', '/api/garage/v1/overview', '/api/garage/v1/board', '/api/garage/v1/my-work', '/api/garage/v1/jobs', '/api/garage/v1/vehicles', '/api/garage/v1/customers', '/api/garage/v1/workshop'],
      },
      native: ['notifications', 'camera', 'file-drop', 'printing', 'barcode'],
      quickActions: [
        { id: 'garage-walk-in', label: 'Garage Walk-in', route: '/garage?view=walkin' },
        { id: 'my-work', label: 'My Work', route: '/garage?view=mywork' },
      ],
      deepLinks: ['garage/jobs/:id', 'garage/vehicles/:id'],
    }),
    load: () => import('./garage/GarageShell'),
  },
  {
    // Restaurant Manager: the waiter's and cashier's POS (floor, order, bill, payment, cashier session), the kitchen
    // screen and expo, and the printers, over /api/restaurant/v1 as a paired terminal (electron/services/restaurant).
    // Offline the till reads its menu and floor copy and keeps orders, lines and sends for WorkSuite; money needs it.
    input: defineDesktopManifest({
      id: 'restaurant', name: 'Restaurant', icon: 'concierge', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'PARTIAL_WRITE', entities: ['order', 'order_item'] },
      native: ['notifications', 'printing', 'hardware'],
      windows: [{ id: 'restaurant-kitchen', route: '/restaurant?view=kitchen' }, { id: 'restaurant-expo', route: '/restaurant?view=expo' }],
      quickActions: [
        { id: 'restaurant-floor', label: 'Restaurant floor', route: '/restaurant?view=floor' },
        { id: 'restaurant-takeaway', label: 'New takeaway order', route: '/restaurant?view=order&type=takeaway' },
        { id: 'restaurant-kitchen', label: 'Kitchen screen', route: '/restaurant?view=kitchen' },
      ],
      deepLinks: ['restaurant', 'restaurant/orders/:id', 'restaurant/kitchen'],
    }),
    load: () => import('./restaurant/RestaurantShell'),
  },
  {
    // eLearning: My Learning, the catalogue, taking a course (a video credited by what is actually played),
    // quizzes and assignments; for the training team the courses, their builder, enrolment, grading and the
    // dashboard. Offline, My Learning, the catalogue and course outlines are the last copy; a course kept
    // offline plays from the app's encrypted copy (elearning-offline.ts), and its progress waits in the queue.
    input: defineDesktopManifest({
      id: 'elearning', name: 'eLearning', icon: 'graduation-cap', contractVersion: 1, desktop: { enabled: true },
      offline: {
        mode: 'PARTIAL_WRITE',
        entities: ['progress'],
        cache: ['/api/elearning/v1/options', '/api/elearning/v1/me/learning', '/api/elearning/v1/me/courses', '/api/elearning/v1/me/lessons', '/api/elearning/v1/catalog', '/api/elearning/v1/categories'],
      },
      native: ['notifications'],
      quickActions: [
        { id: 'my-learning', label: 'My Learning', route: '/elearning?view=my' },
        { id: 'course-catalogue', label: 'Course catalogue', route: '/elearning?view=catalog' },
      ],
      deepLinks: ['elearning', 'elearning/courses/:id', 'elearning/catalog/:id'],
    }),
    load: () => import('./elearning/ElearningShell'),
  },
  {
    // Hotel PMS: the front desk (room rack, arrivals, departures, in house, check-in, walk-in, room moves, check-out),
    // the cashier (folios, charges, payments, shifts) and the night audit, over /api/pms/v1. Offline the rack and the
    // desk's lists are the last copy (READ_CACHE, per property — shared/pms-cache.ts); money, check-ins and new bookings
    // wait for WorkSuite, never queued. The desk's hardware goes through the device agent seam (modules/pms/devices.ts).
    input: defineDesktopManifest({
      id: 'pms', name: 'Hotel PMS', icon: 'bed', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['room', 'reservation', 'stay'], cache: ['/api/pms/v1/options', '/api/pms/v1/properties'] },
      native: ['notifications', 'printing', 'hardware', 'file-drop'],
      windows: [{ id: 'pms-rack', route: '/pms?view=rack' }, { id: 'pms-record', route: '/pms/reservations/:id' }],
      quickActions: [
        { id: 'pms-rack', label: 'Room rack', route: '/pms?view=rack' },
        { id: 'pms-new-reservation', label: 'New hotel reservation', route: '/pms?view=new' },
        { id: 'pms-walk-in', label: 'Hotel walk-in', route: '/pms?view=walkin' },
      ],
      deepLinks: ['pms', 'pms/reservations/:id', 'pms/rooms/:id'],
    }),
    load: () => import('./pms/PmsShell'),
  },
  {
    // WorkSuite Events: the Event Desk (check-in, check-out, re-entry, scanner input, search, walk-ins, badges, live
    // counters) and the organiser's read of an event, over /api/events/v1. This computer as a check-in device — its
    // key, offline copy and queue — is the main process's (electron/services/event-desk.ts): offline, scans are
    // answered from the copy with the server's rules and kept for WorkSuite. Badges print on the desk's own printer.
    input: defineDesktopManifest({
      id: 'events', name: 'Events', icon: 'ticket', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'PARTIAL_WRITE', entities: ['checkin', 'walk_in'], cache: ['/api/events/v1/options', '/api/events/v1/events'] },
      native: ['notifications', 'printing', 'barcode', 'camera', 'hardware'],
      windows: [{ id: 'events-counters', route: '/events/:id/counters' }],
      quickActions: [{ id: 'events-desk', label: 'Event check-in desk', route: '/events' }],
      deepLinks: ['events', 'events/:id', 'events/:id/desk', 'events/:id/counters'],
    }),
    load: () => import('./events/EventsShell'),
  },
  {
    // POS: this computer as a paired till (its credential in the OS keystore, pos-desk.ts), the drawer's shift over
    // /api/pos, selling from a sealed copy of the catalogue, sales numbered here and sent in order through the till's
    // own door (pos-till.ts) — offline too — thermal receipts, the drawer kick and a customer display window.
    input: defineDesktopManifest({
      id: 'pos', name: 'POS', icon: 'store', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'PARTIAL_WRITE', entities: ['sale'], cache: ['/api/pos/options', '/api/pos/registers', '/api/pos/sessions/mine'] },
      native: ['printing', 'barcode', 'hardware'],
      windows: [{ id: 'pos-display', route: '/pos/display' }],
      quickActions: [{ id: 'pos-register', label: 'Open the till', route: '/pos' }],
      deepLinks: ['pos', 'pos/sales/:id'],
    }),
    load: () => import('./pos/PosShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'inventory', name: 'Inventory', icon: 'package', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['product'], cache: ['/api/inventory/products', '/api/inventory/stock'] },
      quickActions: [{ id: 'new-product', label: 'New Product', route: '/inventory?tab=prod&new=1' }],
    }),
    load: () => import('./inventory/InventoryShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'hr', name: 'HR', icon: 'id-card', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', cache: ['/api/hr/attendance/me', '/api/hr/me/profile', '/api/hr/leave/balance', '/api/hr/leave/requests', '/api/hr/leave/approvals'] },
      native: ['notifications'],
      quickActions: [{ id: 'clock-in', label: 'Clock In', route: '/hr' }],
    }),
    load: () => import('./hr/HrShell'),
  },
  {
    input: defineDesktopManifest({ id: 'notifications', name: 'Notifications', icon: 'bell', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'READ_CACHE', cache: ['/api/notifications'] } }),
    load: () => import('./notifications/NotificationsPage'),
  },
  {
    input: defineDesktopManifest({ id: 'settings', name: 'Settings', icon: 'settings', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' } }),
    load: () => import('./settings/SettingsPage'),
  },
  {
    input: defineDesktopManifest({ id: 'account', name: 'My account', icon: 'user', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' }, deepLinks: ['account'] }),
    load: () => import('./account/AccountPage'),
  },
  {
    input: defineDesktopManifest({ id: 'diagnostics', name: 'Diagnostics', icon: 'stethoscope', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' } }),
    load: () => import('./diagnostics/DiagnosticsPage'),
  },
];

export const MODULES: DesktopModule[] = [];
export const REJECTED: Array<{ id: string; error: string }> = [];

for (const def of DEFS) {
  const check = validateManifest(def.input);
  if (!check.ok || !check.manifest) {
    REJECTED.push({ id: String((def.input as { id?: unknown }).id ?? '?'), error: check.error ?? 'invalid' });
    console.warn('[registry] module rejected', def.input.id, check.error);
    continue;
  }
  const id = check.manifest.id;
  MODULES.push({ id, manifest: check.manifest, component: lazy(def.load), always: SHELL_SCREENS.has(id), requires: APP_PARTS[id] });
}

export function moduleFor(id: string): DesktopModule | undefined {
  return MODULES.find((m) => m.id === id);
}

export function appForRoute(route: string): string {
  const seg = route.replace(/^\/+/, '').split(/[/?#]/)[0] || 'home';
  return MODULES.some((m) => m.id === seg) ? seg : 'home';
}

export function titleForRoute(route: string): string {
  const id = appForRoute(route);
  return moduleFor(id)?.manifest.name ?? APP_CATALOGUE.find((a) => a.id === id)?.label ?? 'WorkSuite';
}

/**
 * Modules the current user may open: visible apps with a desktop module, the
 * parts of a visible app (calls, of chat), the host of a visible channel (chat, of WhatsApp), and the always-on screens — the
 * same decision as everywhere else (`canOpenApp`, shared/access.ts).
 */
export function allowedModules(visibleAppIds: VisibleApps): Set<string> {
  const out = new Set<string>();
  for (const m of MODULES) if (canOpenApp(m.id, visibleAppIds)) out.add(m.id);
  // A channel's screen is its host's (WhatsApp is in Chat, #35): someone with the channel keeps that tab.
  for (const [channel, { host }] of Object.entries(CHANNEL_APPS)) if (visibleAppIds.has(channel) && MODULES.some((m) => m.id === host)) out.add(host);
  return out;
}

export function parseRoute(route: string): { path: string[]; query: URLSearchParams } {
  const [p, q] = route.split('?');
  return { path: (p ?? '').split('/').filter(Boolean), query: new URLSearchParams(q ?? '') };
}
