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
  /**
   * Permission the app's own screens demand. Omitted = no permission gate. Several: any one of them opens it (a
   * permission renamed on the server, where an older server still grants the old name).
   */
  perm?: string | readonly string[];
  /** Path of the app in the WorkSuite web client. */
  webPath: string;
  surface: AppSurface;
  /** Sidebar section for native apps shown by default. */
  sidebar?: 'work' | 'business';
  order: number;
  /** Badge counter key (from /api/badges or module unread endpoints). */
  badge?: 'mail' | 'chat' | 'tasks' | 'notifications' | 'support';
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
  /**
   * Guest mode (#149): `local` apps work on the Local Profile's data on this device; `locked` ones stay in the sidebar
   * with a lock and open the sign-in panel; any other app is not shown to a guest at all.
   */
  guest?: 'local' | 'locked';
  /** What guest mode calls a locked app, when that says more than its name ("Drive & Files"). */
  guestLabel?: string;
}

/**
 * Who may open Purchasing (SRS-PUR-001 G-04): the narrow purchasing and payables permissions, the `inventory.purchase`
 * umbrella, approvers, and whoever reads Inventory (they see the lists; every write asks for its own permission).
 */
export const PURCHASE_PERMISSIONS: readonly string[] = ['inventory.view', 'inventory.purchase', 'inventory.approve', 'purchase.request', 'purchase.order', 'purchase.receive', 'purchase.approve', 'payables.bill', 'payables.pay', 'payables.allocate'];

/** Who may open the support desk: `support.view` (WS-SUPPORT-SRS-001 §5.2), or the as-built slugs that granted it. */
export const SUPPORT_PERMISSIONS: readonly string[] = ['support.view', 'ticket.view', 'ticket.reply', 'ticket.manage'];

export const APP_CATALOGUE: AppDefinition[] = [
  // Everyday — native desktop modules (Phase 1, §18).
  { id: 'home', label: 'Home', group: 'work', icon: 'home', webPath: '/', surface: 'native', sidebar: 'work', order: 10, keywords: 'dashboard start overview' },
  { id: 'activity', label: 'Activity', group: 'work', icon: 'activity', perm: 'analytics.view', webPath: '/activity', surface: 'native', sidebar: 'work', order: 20, keywords: 'feed history timeline' },
  { id: 'mail', label: 'Mail', group: 'communication', icon: 'mail', app: 'mail', webPath: '/mail', surface: 'native', sidebar: 'work', order: 30, badge: 'mail', keywords: 'email inbox message', guest: 'locked' },
  { id: 'chat', label: 'Chat', group: 'communication', icon: 'chat', app: 'chat', webPath: '/chat', surface: 'native', sidebar: 'work', order: 40, badge: 'chat', keywords: 'message im team', guest: 'locked' },
  { id: 'calendar', label: 'Calendar', group: 'work', icon: 'calendar', app: 'calendar', webPath: '/calendar', surface: 'native', sidebar: 'work', order: 50, keywords: 'events meetings schedule', guest: 'local' },
  { id: 'tasks', label: 'Tasks', group: 'work', icon: 'tasks', app: 'tasks', webPath: '/tasks', surface: 'native', sidebar: 'work', order: 60, badge: 'tasks', keywords: 'todo to-do', guest: 'local' },
  { id: 'files', label: 'Files', group: 'work', icon: 'folder', app: 'drive', webPath: '/files', surface: 'native', sidebar: 'work', order: 70, keywords: 'drive documents folders storage', guest: 'locked', guestLabel: 'Drive & Files' },
  // Office: new documents, spreadsheets and presentations, templates and the recent ones (src/modules/office/OfficeHome).
  // A part of Files (shared/access APP_PARTS), so it shows with the Drive; a document is a tab of its own, `/office/<id>`.
  { id: 'office', label: 'Office', group: 'work', icon: 'file-text', app: 'drive', webPath: '/office', surface: 'native', order: 71, keywords: 'word excel powerpoint document spreadsheet presentation docx xlsx pptx template new write' },
  // PDF Studio: native here for everyone signed in (a PDF from this computer needs no app); a Drive file is still the
  // server's to allow. The web's `/pdf?file=<id>` links open the file here.
  // Sinhala Tools (Sinhala Tools blueprint §6.1 Converter app): legacy Sinhala fonts to Unicode, here and offline. Shown
  // only to whoever has sinhala.use, and only while the server says the organisation has the tools on (core/app-state).
  { id: 'sinhala-tools', label: 'Sinhala Tools', group: 'work', icon: 'languages', perm: 'sinhala.use', webPath: '/sinhala', surface: 'native', order: 73, keywords: 'sinhala unicode legacy font fm abhaya dl manel kaputa convert clipboard සිංහල' },
  { id: 'pdf', label: 'PDF Studio', group: 'work', icon: 'file-text', webPath: '/pdf', surface: 'native', order: 72, keywords: 'pdf viewer reader acrobat document open print search bookmarks' },
  { id: 'crm', label: 'CRM', group: 'business', icon: 'users', app: 'crm', perm: 'crm.view', webPath: '/crm', surface: 'native', sidebar: 'business', order: 110, keywords: 'leads customers pipeline', guest: 'locked', guestLabel: 'CRM & Sales' },
  // The server's OMS: `/oms?order=` (what notifications and shares link to) opens here as `/sales?order=`.
  { id: 'sales', label: 'Sales & Orders', group: 'business', icon: 'trending-up', app: 'oms', perm: 'oms.view', webPath: '/oms', surface: 'native', sidebar: 'business', order: 120, keywords: 'orders sales order fulfilment dispatch returns' },
  // `/billing?invoice=` and `/billing/invoices/<id>` (notifications, shares, chat cards) open the invoice here.
  { id: 'billing', label: 'Invoices', group: 'business', icon: 'receipt', app: 'billing', perm: 'billing.view', webPath: '/billing', surface: 'native', sidebar: 'business', order: 125, keywords: 'billing invoice invoices payments receipts owed overdue' },
  // `/inventory?product=` and `/inventory/products/<id>` open the product here.
  { id: 'inventory', label: 'Inventory', group: 'business', icon: 'package', app: 'inventory', perm: 'inventory.view', webPath: '/inventory', surface: 'native', sidebar: 'business', order: 128, keywords: 'inventory stock products warehouse movements catalogue sku barcode' },
  // Label Studio (WS-LABEL-SRS-001 FR-DSK-01, D01–D07): home, designer, print station, this computer's printers, the
  // interrupted batch and the Print Gateway. The rest of Label Studio (W02–W32) opens on the web from its rail.
  // Hosting & Domains (Hosting & Domains SRS v1.0 HDM-DSK-01): the server's app `hosting`, opened with `hosting.view`.
  // `/hosting?domain=`, `?server=` and `?certificate=` (the web's deep links, notifications) open here.
  { id: 'hosting', label: 'Hosting', group: 'business', icon: 'globe', app: 'hosting', perm: 'hosting.view', webPath: '/hosting', surface: 'native', sidebar: 'business', order: 129.5, keywords: 'hosting domains dns records registrar expiry renew certificates ssl tls servers vps monitors uptime incidents costs providers accounts sync' },
  { id: 'label', label: 'Label Studio', group: 'business', icon: 'printer', app: 'label', perm: 'label.access', webPath: '/label', surface: 'native', sidebar: 'business', order: 129, keywords: 'label labels barcode qr sticker zebra zpl print station printer gateway templates serials' },
  // HR carries no app slug: there is no `hr` row in `applications`, and its
  // self-service screens answer for the caller alone (web/src/core/sidebar/apps.ts).
  { id: 'hr', label: 'HR', group: 'people', icon: 'id-card', webPath: '/hr', surface: 'native', sidebar: 'business', order: 140, keywords: 'people leave attendance clock in', guest: 'locked', guestLabel: 'HR & People' },
  // Recruitment (WS-REC): the server's app `recruitment`, opened with `recruitment.access`; its notices link
  // `/recruitment?tab=…` (shared/recruitment.ts). Requisitions, jobs, offers and settings stay on the web.
  // WorkSuite Board (SRS-BOARD-001): the server's app `board`, opened with `board.access`; its notices link
  // `/board?view=…` (shared/board.ts). Setup, pack building and registers stay on the web.
  { id: 'board', label: 'Board', group: 'work', icon: 'landmark', app: 'board', perm: 'board.access', webPath: '/board', surface: 'native', sidebar: 'business', order: 142, keywords: 'board directors governance meetings packs papers agenda resolutions votes circulars minutes signing committee' },
  { id: 'recruitment', label: 'Recruitment', group: 'people', icon: 'user-plus', app: 'recruitment', perm: 'recruitment.access', webPath: '/recruitment', surface: 'native', sidebar: 'business', order: 141, keywords: 'recruitment hiring jobs vacancies candidates applicants pipeline interviews scorecards offers requisitions ats talent' },

  // Phone (WS-VOIP-SRS-001): the web's `/phone`, gated on the server's application `telephony` (not `voip`): Voip 1.2.0
  // registers it (`RegisterTelephonyApp`, permission audit G-03) and Core 1.17.0 puts it in `AppGate::DEFAULTS`, so
  // everybody has it unless an administrator takes it away — as the web's catalogue (`'/phone': 'telephony'`). Without
  // it the phone does not connect, ring or notify (canOpenApp('phone') in main). The screens still ask the server what
  // the person may do (an extension, a PBX).
  { id: 'phone', label: 'Phone', group: 'communication', icon: 'phone', app: 'telephony', webPath: '/phone', surface: 'native', sidebar: 'work', order: 43, keywords: 'voip sip call extension pbx dial softphone voicemail' },
  { id: 'meet', label: 'Meet', group: 'communication', icon: 'video', app: 'meet', webPath: '/meet', surface: 'native', sidebar: 'work', order: 45, keywords: 'video call meeting join code', guest: 'local' },
  // Agendas, attendance and minutes. Not an application on the server — the
  // `meeting.view` permission is its only gate (AppGate::CORE notes).
  { id: 'meetings', label: 'Meetings', group: 'work', icon: 'calendar-clock', perm: 'meeting.view', webPath: '/meetings', surface: 'native', sidebar: 'work', order: 55, keywords: 'agenda minutes attendance rooms schedule' },

  // A channel of Chat (worksuite-desktop#35): no entry of its own beside Chat. `/whatsapp?chat=` (notifications,
  // shares) opens that conversation in Chat › WhatsApp.
  { id: 'whatsapp', label: 'WhatsApp', group: 'communication', icon: 'phone', app: 'whatsapp', webPath: '/whatsapp', surface: 'native', channelOf: 'chat', route: '/chat?channel=whatsapp', order: 47, keywords: 'message wa customers' },
  // Channels of Chat too (worksuite-desktop#36): a Facebook Page's Messenger and an Instagram professional account, both
  // the server's `meta` application. `/messenger?conversation=` and `/instagram?conversation=` open that conversation.
  { id: 'messenger', label: 'Messenger', group: 'communication', icon: 'message-circle', app: 'meta', webPath: '/messenger', surface: 'native', channelOf: 'chat', route: '/chat?channel=messenger', order: 48, keywords: 'facebook page fb messages customers' },
  { id: 'instagram', label: 'Instagram', group: 'communication', icon: 'camera', app: 'meta', webPath: '/instagram', surface: 'native', channelOf: 'chat', route: '/chat?channel=instagram', order: 49, keywords: 'ig direct dm messages customers' },

  // Social Media Manager (WS-SMM-SRS-001): the optional app `worksuite.social-media` — accounts on external networks,
  // the composer, calendar, queue, approvals, unified inbox and analytics. Not the internal Social stream below (Q-01).
  // Open to everyone signed in, like the Phone: no server has the module or its `social-media` app row yet, so a gate
  // on them would hide the app from all. The screens ask the server what the person may do, and say plainly when it
  // has no Social Media module.
  { id: 'social-media', label: 'Social Media', group: 'business', icon: 'send', webPath: '/social-media', surface: 'native', sidebar: 'business', order: 167, keywords: 'social media manager facebook instagram linkedin x twitter youtube tiktok threads pinterest google business post schedule publish queue calendar inbox comments approvals campaigns analytics' },
  // Opened in the browser until their desktop modules ship (§14, §18).
  { id: 'social', label: 'Social', group: 'communication', icon: 'megaphone', app: 'social', webPath: '/social', surface: 'browser', order: 46 },
  // The server's own apps with no desktop module yet: each its `applications` row's slug and web route, gated on the
  // permission its own API demands (none for Diagrams, whose routes ask only for a session). Links into them —
  // `/documents/…`, `/forms/…`, `/rental/…`, `/diagrams/…` — open there too.
  { id: 'docs', label: 'Documents', group: 'business', icon: 'file-check', app: 'docs', perm: 'docs.view', webPath: '/documents', surface: 'browser', order: 168, keywords: 'documents templates letterhead contract agreement generate merge sign signature letter' },
  { id: 'forms', label: 'Forms', group: 'work', icon: 'clipboard-check', app: 'forms', perm: 'forms.view', webPath: '/forms', surface: 'browser', order: 192, keywords: 'forms survey questionnaire quiz responses collect' },
  { id: 'diagram', label: 'Diagrams', group: 'work', icon: 'shapes', app: 'diagram', webPath: '/diagrams', surface: 'browser', order: 194, keywords: 'diagrams flowchart draw.io visio chart shapes whiteboard' },
  { id: 'rental', label: 'Rental', group: 'business', icon: 'key', app: 'rental', perm: 'rental.access', webPath: '/rental', surface: 'browser', order: 133.5, keywords: 'rental rent hire equipment gear camera vehicle tools reservation booking quote checkout return deposit fleet' },

  // WorkSuite Projects (WS-PROJECT-SRS-001 PRJ-DSK-01..04): native since 0.2.216 — the board with its keyboard, My work,
  // the tray timer and an offline outbox. `/projects/<id>`, `/projects/<id>/tasks/<task>`, `/projects?project=<id>` and
  // `?task=<id>` (Mail, Calendar, notifications, search) open here; since 0.2.219 every Projects screen is drawn here too
  // (portfolio, delivery, governance) — only a project's own Time tab opens on the web (shared/links.ts BROWSER_PAGES).
  { id: 'projects', label: 'Projects', group: 'work', icon: 'kanban', app: 'projects', webPath: '/projects', surface: 'native', order: 170, keywords: 'projects project board kanban sprint tasks my work timer time tracking timesheet milestones change requests', guest: 'locked', guestLabel: 'Shared workspaces' },
  // `/tenders?open=<id>` (notifications, search, the stream) opens that tender here.
  { id: 'tenders', label: 'Tenders', group: 'business', icon: 'file-text', app: 'tender', perm: 'tender.view', webPath: '/tenders', surface: 'native', sidebar: 'business', order: 129, keywords: 'tenders bids bid rfq rfp procurement pipeline award' },
  { id: 'notes', label: 'Notes', group: 'work', icon: 'notebook', app: 'notes', webPath: '/notes', surface: 'native', order: 190, keywords: 'notebook journal meeting notes', guest: 'local' },
  { id: 'contacts', label: 'Contacts', group: 'work', icon: 'contact', app: 'contacts', webPath: '/contacts', surface: 'native', order: 80, guest: 'local' },

  // `/finance?tab=<view>&company=<id>`, the web's view names; screens not built here yet open in the browser from its rail.
  { id: 'cheque', label: 'Cheque Manager', group: 'business', icon: 'printer', app: 'cheque', perm: 'cheque.access', webPath: '/cheque', surface: 'native', sidebar: 'business', order: 131, keywords: 'cheque cheques check print station leaves books calibration batch' },
  { id: 'finance', label: 'Finance', group: 'business', icon: 'landmark', app: 'finance', perm: 'finance.view', webPath: '/finance', surface: 'native', sidebar: 'business', order: 130, keywords: 'accounts ledger journals general ledger trial balance chart of accounts periods books accounting', guest: 'locked', guestLabel: 'Company records' },
  // `/expenses?tab=<view>&org=<ids|all>`; `/expenses?claim=12` (notifications) opens that claim.
  { id: 'expenses', label: 'Expenses', group: 'business', icon: 'wallet', app: 'expenses', webPath: '/expenses', surface: 'native', sidebar: 'business', order: 135, keywords: 'expense claims receipts reimbursement advances petty cash corporate cards mileage per diem budgets policies subscriptions' },
  // Purchasing (SRS-PUR-001 G-21, G-29): native since 0.2.260 — requests, RFQs, orders, receiving, quality, landed costs,
  // bills, payments and payment runs, returns, vendors, replenishment, agreements and reports. The server's own
  // application `purchase` (RegisterPurchaseApp copies every Inventory grant to it), with any purchasing permission
  // (G-04's narrow ones, the `inventory.purchase` umbrella; `inventory.view` reads). Its notices link
  // `/purchase?order=<id>`, and the web's `/purchase/orders/<id>` opens the order here.
  { id: 'purchase', label: 'Purchasing', group: 'business', icon: 'cart', app: 'purchase', perm: PURCHASE_PERMISSIONS, webPath: '/purchase', surface: 'native', sidebar: 'business', order: 128.5, keywords: 'purchasing purchase orders po procurement buying requests rfq quotation vendors suppliers receiving goods received grn bills payables payments payment run returns replenishment agreements' },
  { id: 'subscriptions', label: 'Subscriptions', group: 'business', icon: 'repeat', app: 'subscriptions', webPath: '/subscriptions', surface: 'browser', order: 165 },
  // Native since 0.2.193 (WS-MKT-SRS-001 v1.1, MKT-DSK-01): the web's fourteen screens, the call queue and its Next contact shortcut.
  { id: 'marketing', label: 'Marketing', group: 'business', icon: 'megaphone', app: 'marketing', webPath: '/marketing', surface: 'native', sidebar: 'business', order: 166, keywords: 'marketing campaigns email newsletter audience contacts segments lists consent suppression unsubscribe call queue call campaigns telemarketing' },
  // Payroll (WS-PAYROLL-SRS-001 §D1): native runs and run approval; setup, inputs and payouts open on the web from its rail.
  { id: 'payroll', label: 'Payroll', group: 'people', icon: 'banknote', app: 'payroll', perm: 'payroll.view', webPath: '/payroll', surface: 'native', sidebar: 'business', order: 150, keywords: 'payroll salary payslips runs approval pay' },
  // Appointments (SRS v1.0 §9, D01–D24): the front desk native here; the web keeps locations, services and the booking page.
  { id: 'appointments', label: 'Appointments', group: 'people', icon: 'calendar-clock', app: 'appointments', perm: 'appointment.view', webPath: '/appointments', surface: 'native', sidebar: 'business', order: 155, keywords: 'appointments booking calendar schedule walk-in check-in clients waitlist deposit checkout receipt commission' },
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
  // The support desk (WS-SUPPORT-SRS-001 D-01…D-12): native here — the inbox, a tab per ticket, native notifications.
  // Not an application on the server (Support's routes are gated by permission alone, like the web's sidebar entry), so
  // its gate is the desk's own `support.view` — or an as-built `ticket.*` slug on a server from before it. The web's
  // `/tickets?ticket=<id>` (notifications, search) opens that ticket's tab here.
  { id: 'support', label: 'Support', group: 'operations', icon: 'life-buoy', perm: SUPPORT_PERMISSIONS, webPath: '/tickets', surface: 'native', sidebar: 'business', order: 200, badge: 'support', keywords: 'support tickets ticket helpdesk help desk service desk customers requester sla reply inbox' },
  // Assets (WS-ASSET-SRS-001 T-17, the desktop boards D01–D26): native since assets 1.0.0 — the register, the scan station, tray alerts and labels.
  { id: 'assets', label: 'Assets', group: 'operations', icon: 'box', app: 'assets', webPath: '/assets', surface: 'native', sidebar: 'business', order: 210, keywords: 'assets equipment register scan barcode labels custody handover depreciation licences audit disposal' },
  // AMC & Service (WS-AMC-SRS-001 T-15): the server's app `amc`; native here — the dashboard, the dispatch timeline, the
  // request window and the lists. Its links `/amc?view=…` (shared/amc.ts) open here; the rest of AMC on the web.
  { id: 'amc', label: 'AMC & Service', group: 'operations', icon: 'wrench', app: 'amc', webPath: '/amc', surface: 'native', sidebar: 'business', order: 215, keywords: 'amc service contracts maintenance requests dispatch technicians visits renewals estimates units equipment warranties sla' },
  // A shop's till: native here (the counter PC) — pairing, the drawer's shift, selling (offline too), receipts, the drawer
  // kick and a customer display. Tills, registers and settings are managed on the web.
  { id: 'pos', label: 'POS', group: 'operations', icon: 'store', app: 'pos', perm: 'pos.access', webPath: '/pos', surface: 'native', sidebar: 'business', order: 220, keywords: 'pos point of sale till register checkout cashier sell sale receipt barcode drawer shift float z report' },
  { id: 'admin', label: 'Admin Center', group: 'admin', icon: 'settings-2', perm: 'users.view', webPath: '/admin', surface: 'browser', order: 500 },
  { id: 'ai', label: 'AI Assistant', group: 'admin', icon: 'sparkles', app: 'ai', webPath: '/ai', surface: 'browser', order: 510, guest: 'locked' },
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
  /** App slugs the server's licence locks (Bootstrap.lockedApps): never visible, whatever else allows them. */
  locked?: string[] | null;
}

export function hasPermission(grant: AccessGrant, perm: string | readonly string[] | undefined): boolean {
  if (!perm || perm.length === 0) return true;
  if (grant.permissions.includes('*')) return true;
  return typeof perm === 'string' ? grant.permissions.includes(perm) : perm.some((p) => grant.permissions.includes(p));
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
  if (def.app && grant.locked?.includes(def.app)) return false;
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

/** Guest mode's apps (#149): Notes, Tasks, Contacts, Calendar and Meet, on this device's data. */
export const GUEST_APPS: AppDefinition[] = APP_CATALOGUE.filter((a) => a.guest === 'local').sort((a, b) => a.order - b.order);
/** What guest mode shows locked, to open after signing in. */
export const GUEST_LOCKED_APPS: AppDefinition[] = APP_CATALOGUE.filter((a) => a.guest === 'locked').sort((a, b) => a.order - b.order);

export function findApp(id: string, catalogue: AppDefinition[] = APP_CATALOGUE): AppDefinition | undefined {
  return catalogue.find((a) => a.id === id);
}
