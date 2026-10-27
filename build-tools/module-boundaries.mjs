/**
 * The reviewed allow-list of module → module imports (audit D-G08; build-tools/eslint-boundaries.mjs).
 *
 * Everything shared that was UI moved to src/components: the page kit (was hr/parts), the list kit (inventory/parts),
 * the record kit (finance/parts), the form kit (garage/parts), the card kit (account/parts), the call kit
 * (calls/parts), the console kit (assets/parts) and the report kit (crm/parts). What is left below is one module using
 * another's API client, data rules or a whole screen. Each entry is a debt with a direction: move the API into shared/
 * or src/core, or open the screen through the registry, then take the pair off. New pairs are not added without a
 * review, and the list only shrinks (tests/unit/build/module-boundaries.test.ts refuses an entry nothing needs).
 *
 * Reviewed 2026-10-27, to be cut down by 2027-03-31.
 */
export const MODULE_IMPORTS = [
  // ── another module's API client and data rules ───────────────────────────────────────────────────────────────
  {
    to: 'finance',
    from: ['assets', 'cheque', 'expenses', 'hr', 'label', 'payroll'],
    why: "finance/api: the chart of accounts, bank accounts, tax codes, cost centres and money formatting the books share; Expenses also uses Finance's report bar and insight. Next: the shared reads and money into shared/.",
  },
  {
    to: 'inventory',
    from: ['pms', 'purchase'],
    why: "inventory/api, control, pickers and insight: products, warehouses, batches and their pickers, which Purchase receives into and the hotel desk restocks from. Next: the pickers into src/components, the reads into shared/.",
  },
  { to: 'purchase', from: ['inventory'], why: 'purchase/api, buying, chain and scan: reorder → purchase order from the stock screens.' },
  { to: 'hr', from: ['account', 'home', 'payroll'], why: "hr/api, attendance, Leave, dates and pay: My account's attendance, Home's leave widget and Payroll's employees and pay rules." },
  { to: 'expenses', from: ['home', 'tenders'], why: "expenses/api, approvals-api, ClaimPanel and NewClaim: Home's approvals widget and a tender's costs as an expense claim." },
  { to: 'tasks', from: ['home', 'mail', 'projects', 'tenders'], why: "tasks/api, actions, editor, queries and NewTask: a task made from a mail or a tender, Home's task widget and Projects' task board (Projects is built on Tasks)." },
  { to: 'calendar', from: ['home', 'mail', 'meetings', 'notifications'], why: 'calendar/api and conflicts: the agenda widget, invitations in a mail and the conflict check when a meeting is booked.' },
  { to: 'account', from: ['home', 'notifications', 'office'], why: 'account/api, regional and Storage: the regional settings notifications follow, and the storage meter.' },
  { to: 'notifications', from: ['appointments'], why: "notifications/api: the appointment desk's alerts are notification-centre items." },
  { to: 'sales', from: ['billing'], why: "sales/manage: the report date ranges Billing's reports share with Sales." },
  { to: 'contacts', from: ['chat', 'settings'], why: "contacts/api, phones, EditDrawer and sync settings: save a chat contact, and the contacts' account sync in Settings." },
  { to: 'phone', from: ['contacts', 'mail', 'support'], why: 'phone/dial: the one way to place a phone call from a number.' },
  { to: 'pdf', from: ['files', 'mail'], why: 'pdf/open: open a PDF in PDF Studio.' },
  { to: 'support', from: ['ai', 'chat', 'mail'], why: 'support/api, parts, ConvertSheet and ConvertEmailSheet: turn a mail or a chat into a ticket.' },

  // ── calls, meetings and messaging: one communications stack across modules ───────────────────────────────────
  { to: 'calls', from: ['chat', 'meet', 'phone', 'settings', 'support'], why: 'calls/session, start, log, tones and the call UI: Meet and Chat calls run on the Calls session and its controls; ringtones are Calls\' tones (tests mock this path).' },
  { to: 'meet', from: ['calendar', 'calls', 'chat', 'contacts', 'files', 'home', 'mail', 'meetings', 'notifications', 'recruitment', 'settings', 'tenders'], why: 'meet/api, start, session, devices, i18n and Meet\'s settings screens: a meeting link starts or joins a Meet room wherever it appears.' },
  { to: 'meetings', from: ['home', 'meet', 'tenders'], why: 'meetings/api, ScheduleDialog, minutes and transcripts: schedule a meeting, and the minutes and transcript of a Meet room.' },
  { to: 'chat', from: ['calls', 'diagnostics', 'garage', 'home', 'mail', 'marketing', 'meet', 'meetings', 'notifications', 'salon', 'settings', 'support', 'tasks'], why: "chat/types, attach, Thread, window, cards, emoji and parts: a conversation's thread, attachments, emoji and record cards drawn inside calls, meetings and the support desk." },
  { to: 'ai', from: ['chat', 'home', 'mail', 'meetings', 'settings', 'support'], why: 'ai/textTools, writer, AiTextDialog, AiMenuButton, session and the AI settings: the writing tools offered in every composer.' },
  { to: 'home', from: ['chat'], why: 'home/Announcements: announcements shown in Chat too.' },

  // ── documents ────────────────────────────────────────────────────────────────────────────────────────────────
  { to: 'office', from: ['chat', 'files', 'mail', 'tenders'], why: 'office/open-with, api, local, slides and the editor: open a document in WorkSuite Office from wherever it is attached.' },
  { to: 'files', from: ['ai', 'home', 'mail', 'meet', 'office', 'settings'], why: 'files/api, Menu, Share, Dialogs, Templates, Thumb and Drive settings: Drive is where documents live; Office edits Drive files.' },

  // ── a screen of one module shown inside another ──────────────────────────────────────────────────────────────
  { to: 'mail', from: ['settings', 'support', 'tenders'], why: "mail/MailSettings, protection admin, the mail editor and record links: Settings shows Mail's settings, the support composer is the mail editor." },
  { to: 'settings', from: ['mail'], why: "settings/AdminNav: Mail's protection admin is drawn inside the Admin Center." },
  { to: 'guest', from: ['meet', 'settings'], why: "guest/GuestProfileMenu and LocalSettings: the guest profile's menu in a meeting and its settings." },
];
