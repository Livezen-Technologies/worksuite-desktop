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
  /** The module's own way out of its "failed to load" screen, beside Retry (Mail: Repair local mail data, #338). */
  recover?: LazyExoticComponent<ComponentType<RecoverProps>>;
}

/** A module's recovery action: `onDone` starts the module again. */
export interface RecoverProps {
  onDone: () => void;
}

const DEFS: Array<{ input: DesktopManifestInput; load: () => Promise<{ default: ComponentType<ModuleProps> }>; recover?: () => Promise<{ default: ComponentType<RecoverProps> }> }> = [
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
    recover: () => import('./mail/RepairLocalMail'),
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
    // WorkSuite Projects (WS-PROJECT-SRS-001 PRJ-DSK-01..04): the project switcher, the board with its keyboard, a task's
    // detail, My work, my time, change decisions; the tray timer and its mini window (electron/services/projects).
    // Offline the pinned boards, my work and my last 30 days of time are the last copy; moves, comments and time wait in
    // the outbox and go in order; approvals, budget and change decisions wait for a connection.
    input: defineDesktopManifest({
      id: 'projects', name: 'Projects', icon: 'kanban', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'PARTIAL_WRITE', entities: ['task', 'comment', 'time_entry'], cache: ['/api/projects'] },
      native: ['notifications'],
      windows: [{ id: 'projects-timer', route: '/projects/timer', alwaysOnTop: true }, { id: 'projects-board', route: '/projects/:id' }],
      quickActions: [
        { id: 'projects-my-work', label: 'My work (Projects)', route: '/projects/my-work' },
        { id: 'projects-time', label: 'My time (Projects)', route: '/projects/time' },
      ],
      deepLinks: ['projects', 'projects/:id', 'projects/:id/tasks/:task'],
    }),
    load: () => import('./projects/ProjectsPage'),
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
    // Sinhala Tools (WorkSuite Desktop Sinhala Tools blueprint §6.1): legacy Sinhala fonts to Unicode — text as it is
    // pasted, Word documents on this computer (offline too), the clipboard from any app. Shown only while the server
    // says the organisation has the tools on (core/app-state).
    input: defineDesktopManifest({
      id: 'sinhala-tools', name: 'Sinhala Tools', icon: 'languages', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'NONE' },
      native: ['file-drop'],
      quickActions: [{ id: 'sinhala-convert', label: 'Convert Sinhala text', route: '/sinhala-tools' }],
      deepLinks: ['sinhala-tools'],
    }),
    load: () => import('./sinhala/SinhalaToolsPage'),
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
      id: 'marketing', name: 'Marketing', icon: 'megaphone', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'NONE' },
      native: ['notifications'],
      quickActions: [
        { id: 'marketing-queue', label: 'My call queue', route: '/marketing?view=queue' },
        { id: 'marketing-new-campaign', label: 'New campaign', route: '/marketing?view=campaigns&new=1' },
      ],
      deepLinks: ['marketing', 'marketing/queue', 'marketing/contacts/:id', 'marketing/campaigns/:id'],
    }),
    load: () => import('./marketing/MarketingShell'),
  },
  {
    input: defineDesktopManifest({
      id: 'sales', name: 'Sales & Orders', icon: 'trending-up', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['order'], cache: ['/api/oms/orders', '/api/oms/overview', '/api/oms/organizations'] },
      native: ['notifications', 'printing'],
      quickActions: [
        { id: 'new-order', label: 'New Order', route: '/sales?tab=orders&new=1' },
        { id: 'sales-approvals', label: 'Orders to approve', route: '/sales?tab=appr' },
        { id: 'sales-shipping-desk', label: 'Shipping desk', route: '/sales?tab=desk' },
      ],
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
    // Recruitment (WS-REC SRS §9, gap doc §9.3 D01–D05): the pipeline board, the review queue with the CV, my
    // interviews today, the scorecard beside the Meet call (its own window too) and approvals waiting on me, over the
    // staff API `/api/recruitment`. Nothing is kept for offline: every screen is a decision the server must see.
    input: defineDesktopManifest({
      id: 'recruitment', name: 'Recruitment', icon: 'user-plus', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      native: ['notifications'],
      windows: [{ id: 'scorecard', route: '/recruitment?tab=cards&solo=1' }],
      quickActions: [{ id: 'interviews-today', label: 'Interviews today', route: '/recruitment?tab=today' }],
      deepLinks: ['recruitment'],
    }),
    load: () => import('./recruitment/RecruitmentShell'),
  },
  {
    // AMC & Service (WS-AMC-SRS-001 T-15): D-01 dashboard, D-02 dispatch timeline (drag to give out, suggestions, bulk
    // give-out of overdue PMs), D-03 the request window (a pop-out too) and the lists with their details, over
    // `/api/amc`. Read offline from the last answers kept (READ_CACHE); every write waits for the server.
    input: defineDesktopManifest({
      id: 'amc', name: 'AMC & Service', icon: 'wrench', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'READ_CACHE', cache: ['/api/amc'] },
      native: ['notifications'],
      windows: [{ id: 'request', route: '/amc?view=requests&solo=1' }],
      quickActions: [{ id: 'amc-dispatch', label: 'Dispatch timeline', route: '/amc?view=dispatch' }, { id: 'amc-requests', label: 'Service requests', route: '/amc?view=requests' }],
      deepLinks: ['amc', 'amc/dispatch', 'amc/requests/:id', 'amc/contracts/:id', 'amc/estimates/:id', 'amc/units/:id', 'amc/warranties/:id'],
    }),
    load: () => import('./amc/AmcShell'),
  },
  {
    // WorkSuite Board (SRS-BOARD-001 §13.2 D-01..D-13, FR-DX): the director's home, calendar, agenda with meeting
    // information, item comments, offline packs, annotations, search, approvals and signing, my actions, archive,
    // notices, the live room with votes and the secretary's live minutes with polls, over `/api/board`. Packs kept
    // offline live in the main process's encrypted vault (board-vault.ts), not the read cache.
    input: defineDesktopManifest({
      id: 'board', name: 'Board', icon: 'landmark', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      native: ['notifications'],
      quickActions: [{ id: 'board-packs', label: 'Board packs', route: '/board?view=packs' }, { id: 'board-approvals', label: 'Board approvals', route: '/board?view=approvals' }],
      deepLinks: ['board', 'board/meetings/:id', 'board/meetings/:id/room', 'board/circulars/:id'],
    }),
    load: () => import('./board/BoardShell'),
  },
  {
    // Assets (WS-ASSET-SRS-001 T-17, the desktop boards D01–D26) over `/api/assets`: the register and one asset's
    // overview, custody and depreciation; the scan station for a keyboard-wedge scanner; requests, transfers,
    // bookings, upkeep, licences, consumables, audits, disposal, reports, import/export, labels and settings.
    // Alerts and the tray line come from electron/services/assets-alerts.ts.
    input: defineDesktopManifest({
      id: 'assets', name: 'Assets', icon: 'box', contractVersion: 1, desktop: { enabled: true },
      // Read-only offline from the encrypted cache: what was last opened; every change waits for the connection.
      offline: { mode: 'READ_CACHE', entities: ['asset'], cache: ['/api/assets', '/api/assets/access', '/api/assets/dashboard', '/api/assets/mine', '/api/assets/requests', '/api/assets/lookups/categories'] },
      native: ['notifications', 'printing', 'barcode', 'file-drop'],
      quickActions: [
        { id: 'assets-scan', label: 'Asset scan station', route: '/assets?tab=scan' },
        { id: 'assets-mine', label: 'My equipment', route: '/assets?tab=mine' },
      ],
      deepLinks: ['assets', 'assets/:id'],
    }),
    load: () => import('./assets/AssetsShell'),
  },
  {
    // Hosting & Domains (Hosting & Domains SRS v1.0 HDM-DSK-01…05, boards D-01…D-08) over `/api/hosting`: the overview,
    // domains with the keyboard list and preview, a domain in its own tab or window with the DNS editor, certificates
    // with AI explain, servers with typed power-off, monitors, costs, provider accounts and sync history. Alerts and
    // the tray badge come from electron/services/hosting-alerts.ts.
    input: defineDesktopManifest({
      id: 'hosting', name: 'Hosting', icon: 'globe', contractVersion: 1, desktop: { enabled: true },
      // Read-only offline from the encrypted cache with its "as of" time; every change waits for the connection.
      offline: { mode: 'READ_CACHE', entities: ['domain', 'server', 'certificate'], cache: ['/api/hosting/overview', '/api/hosting/domains', '/api/hosting/servers', '/api/hosting/certificates', '/api/hosting/monitors', '/api/hosting/accounts', '/api/hosting/sync-runs'] },
      native: ['notifications'],
      windows: [{ id: 'hosting-domain', route: '/hosting?domain=:id' }, { id: 'hosting-server', route: '/hosting?server=:id' }],
      quickActions: [
        { id: 'hosting-add-domain', label: 'Add a domain', route: '/hosting?tab=new' },
        { id: 'hosting-expiring', label: 'Expiring domains', route: '/hosting?tab=expiring' },
      ],
      deepLinks: ['hosting', 'hosting/domains/:id', 'hosting/servers/:id'],
    }),
    load: () => import('./hosting/HostingShell'),
  },
  {
    // Payroll (WS-PAYROLL-SRS-001 §D1, the desktop boards D01–D25) over `/api/payroll` (docs/payroll-api.md): home,
    // runs and the run workspace, approval with Touch ID and the journal, employees, inputs, loans, settlements,
    // payslips, disbursements with bank files, statutory, reports, setup and settings. My Payslips is HR › My pay.
    input: defineDesktopManifest({
      id: 'payroll', name: 'Payroll', icon: 'banknote', contractVersion: 1, desktop: { enabled: true },
      // D25: the runs and the screens around them, read-only from the encrypted cache while offline; nothing is written.
      offline: { mode: 'READ_CACHE', cache: ['/api/payroll/access', '/api/payroll/dashboard', '/api/payroll/runs', '/api/payroll/groups', '/api/payroll/payslips', '/api/payroll/me'] },
      native: ['notifications'],
      quickActions: [{ id: 'payroll-runs', label: 'Payroll runs', route: '/payroll?tab=runs' }],
      deepLinks: ['payroll', 'payroll/runs/:id'],
    }),
    load: () => import('./payroll/PayrollShell'),
  },
  {
    // Cheque Manager (Cheque SRS v1.0, the desktop boards D01–D06) over `/api/cheque` (server docs/cheque-api.md): this
    // computer as the certified print station — home, print queue, direct print and confirm, calibration and
    // offsets, batch runs and reconciling an interrupted batch. Printing happens only in the main process.
    input: defineDesktopManifest({
      id: 'cheque', name: 'Cheque Manager', icon: 'printer', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      quickActions: [{ id: 'cheque-queue', label: 'Cheque print queue', route: '/cheque?tab=queue' }],
      deepLinks: ['cheque', 'cheque/queue', 'cheque/batches/:id'],
    }),
    load: () => import('./cheque/ChequeShell'),
  },
  {
    // Appointments (Appointments SRS v1.0 §9, the desktop boards D01–D24) over `/api/appointments`: the today board,
    // calendar day and week with drag-to-move, list, new appointment, walk-in, the appointment panel with check-in,
    // move, cancel/no-show and deposit, checkout with the receipt, clients, waitlist, reports, commission, set-up, this
    // desk, notifications, day sheets and the palette. Offline, status moves and client notes wait in the queue.
    input: defineDesktopManifest({
      id: 'appointments', name: 'Appointments', icon: 'calendar-clock', contractVersion: 1, desktop: { enabled: true },
      offline: {
        mode: 'PARTIAL_WRITE',
        entities: ['appointment', 'customer_note'],
        cache: ['/api/appointments/options', '/api/appointments/dashboard', '/api/appointments/calendar', '/api/appointments/customers'],
      },
      native: ['notifications', 'printing'],
      quickActions: [
        { id: 'appointments-new', label: 'New appointment', route: '/appointments?tab=today&new=1' },
        { id: 'appointments-walk-in', label: 'Appointment walk-in', route: '/appointments?tab=walkin' },
      ],
      deepLinks: ['appointments', 'appointments/:id'],
    }),
    load: () => import('./appointments/AppointmentsShell'),
  },
  {
    // Label Studio (WS-LABEL-SRS-001 §4.27, the desktop boards D01–D07) over `/api/labels` (server docs/label-api.md):
    // home, designer with a test print, the print station, printers on this computer, the interrupted batch and the
    // Print Gateway. Printing happens only in the main process (electron/services/label/, FR-DSK-03).
    input: defineDesktopManifest({
      id: 'label', name: 'Label Studio', icon: 'printer', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'NONE' },
      native: ['printing', 'barcode'],
      quickActions: [{ id: 'label-station', label: 'Label print station', route: '/label?tab=station' }],
      deepLinks: ['label', 'label/jobs/:id', 'label/templates/:id'],
    }),
    load: () => import('./label/LabelShell'),
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
    // Purchasing (SRS-PUR-001 G-21): its own app over Inventory — the dashboard, requests and RFQs with per-line award,
    // the orders grid with its detail pane (three-way match, the approval chain, send, close, FX and landed cost),
    // receiving by scan, the quality hold, bills, payments and payment runs, returns, vendors with their scorecard,
    // replenishment, agreements and reports. Approvals arrive as banners with Approve and Open
    // (electron/services/purchase-desk.ts). Offline, the lists and every document opened read as last seen; every
    // write waits for the connection.
    input: defineDesktopManifest({
      id: 'purchase', name: 'Purchasing', icon: 'cart', contractVersion: 1, desktop: { enabled: true },
      offline: { mode: 'READ_CACHE', entities: ['purchase_order', 'goods_receipt', 'vendor_bill'], cache: ['/api/inventory/purchase-orders', '/api/inventory/purchase/dashboard', '/api/inventory/bills', '/api/inventory/vendors', '/api/purchase/chain'] },
      native: ['notifications', 'printing', 'barcode', 'file-drop'],
      quickActions: [
        { id: 'purchase-new-order', label: 'New purchase order', route: '/purchase?tab=po&new=1' },
        { id: 'purchase-receive', label: 'Receive goods', route: '/purchase?tab=rcv' },
        { id: 'purchase-approvals', label: 'Purchases to approve', route: '/purchase?tab=appr' },
      ],
      deepLinks: ['purchase', 'purchase/orders/:id', 'purchase/requests/:id', 'purchase/bills/:id', 'purchase/returns/:id', 'purchase/vendors/:id'],
    }),
    load: () => import('./purchase/PurchaseShell'),
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
    // Support (WS-SUPPORT-SRS-001 D-01…D-12): the inbox — views with live counts, the list, the reading pane — and a
    // tab per ticket, over /api/support/v1, or the as-built /api/tickets on a server from before it (api.ts). Offline,
    // the rail, the lists and the tickets already opened are the last copy; replies, notes, status and property changes
    // go to the outbox and are sent in order when WorkSuite is back (PARTIAL_WRITE, D-09).
    input: defineDesktopManifest({
      id: 'support', name: 'Support', icon: 'life-buoy', contractVersion: 1, desktop: { enabled: true },
      offline: {
        mode: 'PARTIAL_WRITE',
        entities: ['ticket'],
        cache: ['/api/support/v1/meta', '/api/support/v1/views', '/api/support/v1/badges', '/api/support/v1/tickets', '/api/support/v1/agents', '/api/support/v1/canned'],
      },
      native: ['notifications', 'file-drop'],
      quickActions: [
        { id: 'support-inbox', label: 'Support inbox', route: '/support' },
        { id: 'support-mine', label: 'My tickets', route: '/support?view=mine' },
        { id: 'support-unassigned', label: 'Unassigned tickets', route: '/support?view=unassigned' },
      ],
      deepLinks: ['support', 'support/ticket/:id'],
    }),
    load: () => import('./support/SupportPage'),
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
    // User guides (the server's /api/help/guides): the list, a guide, a workflow's steps — the last ones read, offline.
    input: defineDesktopManifest({ id: 'help', name: 'User guides', icon: 'book-open', contractVersion: 1, desktop: { enabled: true }, offline: { mode: 'READ_CACHE', cache: ['/api/help/guides'] }, deepLinks: ['help'] }),
    load: () => import('./help/HelpPage'),
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
  MODULES.push({ id, manifest: check.manifest, component: lazy(def.load), always: SHELL_SCREENS.has(id), requires: APP_PARTS[id], ...(def.recover ? { recover: lazy(def.recover) } : {}) });
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
