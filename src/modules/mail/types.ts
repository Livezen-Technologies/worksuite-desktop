/**
 * What the WorkSuite Mail API answers, as the desktop reads it. Field names are
 * the server's; anything optional is something an older server, or a mailbox
 * kept only in the local store, may not send.
 */

export interface Mailbox {
  id: number;
  email: string;
  display_name: string | null;
  shared: boolean;
  /** Unread in the inbox, from the server's local store; null for a shared mailbox. */
  unread: number | null;
  in_unified?: boolean;
  is_default?: boolean;
  archived?: boolean;
  provider?: string;
  provider_label?: string;
  colour?: string | null;
  /** `local_mailbox` / `shared_mailbox` for a WorkSuite Local mailbox. */
  account_type?: string | null;
  auth_type?: string;
  oauth_provider?: string | null;
  /** `problem`: the provider refused the sign-in ("Authentication problem"). */
  auth_state?: 'ok' | 'problem' | 'unreachable' | 'unknown';
  last_error?: string | null;
  last_sync_at?: string | null;
  sync_every?: number;
  sync_paused?: boolean;
  label?: string | null;
  mine?: boolean;
  protocol?: string;
  /** WorkSuite's own copy of this mailbox on the server (Mail SRS v2.2 §9), when the organization keeps one. */
  copy?: MailboxCopy | null;
  notify?: boolean;
  /** Set on this computer as the list is read (safety.ts, #338): whether the account can work, and why not. */
  health?: AccountHealth;
  /**
   * How the server reads and sends this mailbox (Admin Center › Mail Services): a provider API — Microsoft Graph,
   * the Gmail API, Zoho Mail, Exchange Web Services, POP3 (incoming only) — or IMAP/SMTP when `driver` is null.
   * Absent from an older server.
   */
  transport?: MailboxTransport;
}

export interface MailboxTransport {
  driver: 'graph' | 'gmail' | 'zoho' | 'ews' | 'pop3' | null;
  label: string;
  native: boolean;
  incoming_only: boolean;
}

/** Why an account cannot work (#338): no address, a sign-in that never finished, no server, or a refused sign-in. */
export type AccountErrorCode = 'missing_email' | 'missing_token' | 'missing_host' | 'auth_failed';

/** One account's state on this computer: `error` accounts show a red marker and Reconnect · Remove, the others load as usual. */
export interface AccountHealth {
  status: 'ok' | 'error';
  code: AccountErrorCode | null;
  /** Kept, never deleted: the person reconnects it or removes it. */
  needs_reconnect: boolean;
}

export interface MailboxCopy {
  copy_mode: 'headers' | 'recent' | 'everything' | 'archive' | string;
  stored_bytes: number;
  local?: boolean;
  window_months?: number;
  /** Share of the last day's opens served from the copy, 0…1; null when nothing was opened. */
  opens_from_copy?: number | null;
}

export interface Folder {
  id: number;
  name: string;
  slug: string;
  type: string;
  total: number;
  unread: number;
}

export interface Label {
  id: number;
  name: string;
  slug?: string;
  color: string | null;
  messages?: number;
  is_hidden?: boolean;
  parent_id?: number | null;
}

export interface MailboxTag {
  id: number;
  email: string;
  name: string;
  colour: string;
}

export interface TeamState {
  assignee_id: number | null;
  assignee_name: string | null;
  status: 'open' | 'answered' | 'closed' | string;
  read_by_me?: boolean;
  /** Internal notes on the conversation (only the team sees them). */
  notes?: number;
  /** Snoozed until then (null: in the queue). */
  snoozed_until?: string | null;
}

/** An internal note on a shared mailbox's conversation (GET messages/team/notes). */
export interface TeamNote {
  id: number;
  user_id: number;
  name: string;
  mine: boolean;
  body: string;
  created_at: string;
}

export interface MessageRow {
  id: number;
  from_name: string;
  from_email: string;
  subject: string;
  preview: string;
  is_read: boolean;
  is_starred: boolean;
  is_important?: boolean;
  has_attachment: boolean;
  size?: number;
  folder?: string | null;
  folder_slug?: string;
  created_at: string;
  mailbox?: MailboxTag;
  uid_key?: string;
  labels?: Array<{ id: number; name: string; color: string | null }>;
  conversation_key?: string;
  /** A conversation row (threaded list): how many messages it holds. */
  count?: number;
  team?: TeamState;
  /** A search result's files, named from WorkSuite's copy (search only). */
  attachments?: Attachment[];
  /** WorkSuite's states (GET api/mail/states), put on the row by the list. */
  pinned?: boolean;
  /** Back from snooze within the last day and still unread: on top. */
  returned?: boolean;
  flag?: { start_at: string | null; due_at: string | null; reminder_at: string | null; completed_at: string | null; task_id: number | null } | null;
  categories?: Array<{ id: number; name: string; colour: string }>;
  /** Moved by hand to a Focused Inbox tab. */
  focus?: 'focused' | 'other';
  /** In the Snoozed view: when it comes back. */
  snoozed_until?: string | null;
  /** The message's own identity, which survives a move or a UIDVALIDITY change (worksuite-desktop#209). */
  message_id?: string | null;
  /** sha1 of the lower-cased Message-ID, from a mirrored list (which keeps no raw header). */
  message_id_hash?: string | null;
  uidvalidity?: number | null;
  /** The Support ticket this message was made into or added to (#298); null or absent when none, or on an older server. */
  support_ticket?: SupportTicketLink | null;
}

/** A message's ticket in Support, as the Mail API names it (`support_ticket`): it opens the ticket's tab. */
export interface SupportTicketLink {
  id: number;
  reference: string;
  status: string | null;
}

export interface MessagePage {
  messages: MessageRow[];
  has_more: boolean;
  total: number;
  /** The quick filters this mailbox could honour. */
  quick?: string[];
  quick_failed?: boolean;
  unified?: boolean;
  offline?: string[];
  unsearched?: string[];
  team?: boolean;
  threaded?: boolean;
  /** The next page's position (a mirror's cursor, or All Accounts' place in each account). */
  next_cursor?: string | null;
  /** Read from this computer while the server is asked (worksuite-desktop#208). */
  local?: boolean;
}

export interface Attachment {
  ref: string;
  name: string;
  mime: string;
  size: number;
}

export interface MessageDetail {
  id: number;
  message_id: string;
  in_reply_to?: string;
  references?: string;
  from_name: string;
  from_email: string;
  subject: string;
  to: string[];
  cc: string[];
  /** Blind copies, on mail the reader sent; Reply-To when the sender set one (#212: the header's details). */
  bcc?: string[];
  reply_to?: string | null;
  body_html: string;
  is_starred: boolean;
  is_important?: boolean;
  is_read?: boolean;
  attachments: Attachment[];
  created_at: string;
  labels?: Array<{ id: number; name: string; color: string | null }>;
  conversation_key?: string;
  team?: TeamState;
  /** The Support ticket this message was made into or added to (#298); null or absent when none. */
  support_ticket?: SupportTicketLink | null;
}

/** SPF, DKIM and DMARC as the receiving server recorded them (GET messages/{id}/context). */
export interface MessageSecurity {
  available: boolean;
  reason?: string;
  spf?: string;
  dkim?: string;
  dmarc?: string;
  tls?: boolean;
}

export interface MessageContext {
  sender: {
    email: string;
    name: string | null;
    contact_id: number | null;
    user_id: number | null;
    is_colleague: boolean;
    company: string | null;
    job_title?: string | null;
    department?: string | null;
    phone?: string | null;
    mobile?: string | null;
    is_customer?: boolean;
    is_vip?: boolean;
    client_id?: number | null;
    /** The contact's or colleague's photo, when the server has one (#212). */
    photo_url?: string | null;
  } | null;
  /** Recent mail with the sender, newest first. */
  history?: { total: number; first: string | null; last: string | null; messages: Array<{ id: number; subject: string; at: string; is_read: boolean; has_attachment: boolean; folder: string | null; slug: string | null }> };
  related?: { meetings?: Array<{ id: number; title: string; at: string | null; status: string | null }>; tasks?: Array<{ id: number; title: string; status: string | null; due: string | null }> };
  security: MessageSecurity;
  /**
   * A WorkSuite notification email's item (#170): the X-WorkSuite-Item header as received, and whether the server
   * found the message genuinely from WorkSuite (its sender, SPF, DKIM and DMARC). Absent for other mail.
   */
  worksuite_item?: { header: string; verified: boolean } | null;
  /** What the message asks of its reader, from its headers (ENH-MAIL-03 P4); absent from an older server. */
  markers?: MessageMarkers;
}

export interface MessageMarkers {
  /** Voting buttons (DMO-CMP-12). */
  vote: string[];
  /** Who asked for a read receipt (DMO-CMP-11). */
  read_receipt_to: string | null;
  /** S/MIME, as the message says — checked against its bytes before anything is claimed (DMO-SEC-05). */
  smime: 'signed' | 'encrypted' | null;
  sensitivity: 'personal' | 'private' | 'confidential' | null;
  importance: 'high' | 'low' | null;
}

/** GET /api/mail/views: the sidebar's numbers. Null is "not counted", never zero. */
export interface ViewCounts {
  mailboxes: Array<{ id: number; unread: number | null; starred: number | null; drafts: number | null; counted: boolean }>;
  views: { unread: number | null; starred: number | null; today: number | null; attachments: number | null; drafts: number | null; important: number | null; scheduled: number | null };
  partial: boolean;
  unknown: string[];
}

export interface SyncMailbox {
  mailbox: number;
  status: string;
  serving: boolean;
  lag_seconds: number | null;
  pushed: boolean;
  problem: string | null;
  last_sync_at: string | null;
}

/** One account's row in the shared sync status (ENH-MAIL-03 v1.1 DMO-SYN). */
export interface SyncAccount {
  mailbox: number;
  email: string;
  name: string;
  /** In All Accounts (and Sync all). */
  included: boolean;
  paused: boolean;
  mode: 'push' | 'interval' | 'manual' | string;
  interval_min: number;
  /** The last successful sync — never a failed attempt. */
  last_ok_at: string | null;
  last_attempt_at: string | null;
  last_result: 'ok' | 'failed' | 'partial' | 'running' | 'never' | string;
  error_code: string | null;
  /** In plain words: "Password or app password rejected", "Google sign-in expired — sign in again". */
  error: string | null;
  running: boolean;
  mirror: boolean;
  pushed: boolean;
  folders: number;
  folders_done: number;
  /** A run is going now (`running` is also true while a first sync is still building). */
  syncing_now?: boolean;
  /** Every folder's headers are in (#190). */
  complete?: boolean;
  /** Messages mirrored, and bodies kept, on the WorkSuite server. */
  messages?: number;
  bodies?: number;
  /** When the pass going now began (#228): "Syncing · headers 2 of 27 folders · started 11:20". */
  running_since?: string | null;
  /**
   * Folders the server leaves alone (#286): not mail (Calendar, Contacts, Tasks, Notes…) or turned off in
   * Settings › Mail › Accounts › Folders. `folders` and `folders_done` count only the folders it downloads.
   */
  folders_skipped?: number;
  /** The first full sync while it runs; null once it has finished. Absent from an older server (#286). */
  first_sync?: FirstSync | null;
}

/** A first full sync under way (#286): "First sync · headers 12 of 21 folders · started 1:20 · about 4 min left". */
export interface FirstSync {
  started_at: string;
  /** Folders it downloads, and those whose headers (their offline window) are all in. */
  folders: number;
  folders_done: number;
  /** Headers held, and the messages in the folders' windows. */
  have: number;
  want: number;
  /** Time left at the rate so far; null until there is a rate to go by. */
  eta_seconds: number | null;
}

/** A folder's real state (#286): its window is in, filling, waiting for its turn, failing, or not synced at all. */
export type FolderSyncState = 'up_to_date' | 'downloading' | 'waiting' | 'error' | 'skipped';

/** One folder in Settings › Mail › Accounts › Folders (GET mailboxes/{id}/sync-folders, #286). */
export interface SyncFolder {
  path: string;
  name: string;
  role: string | null;
  /** What it holds when it is not mail: calendar, contacts, tasks, notes, journal, rss, conversation_history, sync_issues, outbox. */
  kind: string | null;
  /** Downloaded by the server's sync. */
  sync: boolean;
  /** The owner's choice: true sync it, false skip it, null as its kind decides. */
  choice: boolean | null;
  state: FolderSyncState | string;
  /** Headers held of its window, and the messages in it (null before the window is worked out). */
  have: number;
  want: number | null;
  /** The folder's count on the server — the whole folder, not its window. */
  total: number;
  /** Why it is skipped (not_mail, off) or the error. */
  reason: string | null;
}

export interface SyncFoldersAnswer {
  mailbox: number;
  folders: SyncFolder[];
  /** This person may change which folders are synced. */
  can_choose?: boolean;
}

/** Messages that could not be opened, grouped by why (GET mailboxes/{id}/sync-log, #228). */
export interface FetchErrorGroup {
  kind: 'busy' | 'timeout' | 'signin' | 'gone' | 'moved' | 'no_uid' | 'not_found' | string;
  label: string;
  /** How many messages, and how many times in all. */
  messages: number;
  hits: number;
  last_at: string | null;
  items: Array<{ folder: string; uid: number; uidvalidity: number | null; message_id: string | null; response: string | null; hits: number; last_at: string | null }>;
}

export interface SyncOverall {
  state: 'up_to_date' | 'syncing' | 'attention' | 'paused' | string;
  syncing: number;
  total: number;
  last_ok_at: string | null;
  failed: number[];
  stale: number[];
  stale_minutes: number;
}

export interface SyncStatus {
  enabled: boolean;
  mailboxes: SyncMailbox[];
  /** An older server sends neither. */
  accounts?: SyncAccount[];
  overall?: SyncOverall;
  /** Is the server's sync service running; while it is not, the app takes background steps (an older server sends neither). */
  background?: { worker: boolean; step: boolean };
}

/** One run in an account's sync log (GET mailboxes/{id}/sync-log). */
export interface SyncRun {
  id: number;
  started_by: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  result: string;
  folders: number;
  folders_total: number;
  added: number;
  changed: number;
  removed: number;
  error_code: string | null;
  error: string | null;
  /** Message bodies the run downloaded (#190; absent from older servers). */
  bodies?: number;
  /** Folders that failed in this run. */
  errors?: number;
  /** One entry per folder, in the order the run took them (#190). */
  details?: SyncRunFolder[];
  /** A batch of the account's first sync, or an update after it (#286); absent or null from an older server. */
  phase?: 'first_sync' | 'update' | null;
}

/** One folder's part in a sync run (GET mailboxes/{id}/sync-log, #190). */
export interface SyncRunFolder {
  folder: string;
  path: string;
  role: string | null;
  /** ok · pending (more to fetch next run) · not_reached (out of time) · error · skipped (#286). */
  status: 'ok' | 'pending' | 'not_reached' | 'error' | 'skipped' | string;
  added: number;
  changed: number;
  removed: number;
  ms?: number;
  error?: string;
  /** "unchanged": the server said nothing had moved. */
  note?: string;
  /** Its state after the run (#286; absent from older servers, which the log then shows as before). */
  state?: FolderSyncState | string;
  /** Downloading N of M: headers held of its window, and the messages in it. */
  have?: number;
  want?: number | null;
  /** Skipped because it is not mail (`not_mail`, with its `kind`) or was turned off (`off`). */
  reason?: string;
  kind?: string | null;
}

/** The All Accounts folders (DMO-ALL-01), in the order the pane lists them. */
export type AllRole = 'inbox' | 'drafts' | 'outbox' | 'archive' | 'sent' | 'snoozed' | 'trash' | 'junk';

/** GET views/all/counts. */
export interface AllCounts {
  roles: Record<AllRole, { count: number | null; kind: 'unread' | 'total' | 'none'; mailboxes: Array<{ id: number; count: number | null; folder: string | null; source: string | null; ambiguous: boolean }> }>;
  unknown: string[];
  partial: boolean;
}

/** The list's layout, kept on the server (GET/PUT /api/mail/prefs). */
export interface MailPrefs {
  /** How rows show which account a message came to: its name tag (default), its colour dot, or nothing (#227). */
  accountTag?: 'name' | 'dot' | 'off';
  /** Each account's tag label, colour and where it shows, by mailbox id (#227). */
  accountTags?: Record<string, { label?: string; colour?: string; show?: 'combined' | 'all' | 'never' }>;
  /** My Day on the right of Mail (DMO-TSK-04). */
  todoPane?: boolean;
  view?: 'classic' | 'compact' | 'super' | 'table';
  pane?: 'right' | 'bottom' | 'hidden';
  sort?: SortKey;
  dir?: 'asc' | 'desc';
  group?: GroupKey;
  toolbar?: 'docked' | 'floating' | 'compact' | 'minimal';
  zoom?: number;
  /** Group into conversations, per folder. */
  conversations?: Record<string, boolean>;
  /** Reading (D10): open messages in tabs, previews in the list. */
  tabs?: boolean;
  previews?: boolean;
  /** The old on/off for dark email content (D10); `bodyTheme` decides now (#287). */
  darkBody?: boolean;
  /** Show emails in dark mode (#287): Automatic (the default) follows the theme and each email; or always light, always dark. */
  bodyTheme?: 'auto' | 'light' | 'dark';
  /** The header's ☀ View in light / 🌙 View in dark, remembered per sender (lower-case address). */
  bodyThemeSenders?: Record<string, 'light' | 'dark'>;
  /** Warn when an account has not synced successfully for this many minutes (DMO-SYN-06; 15…1440). */
  staleMinutes?: number;
  /** Show a desktop notification when an account's sync fails. */
  notifySyncFailure?: boolean;
  /** Focused Inbox on (default) or off, and the accounts it is off for (DMO-INB-01). */
  focused?: boolean;
  focusedOff?: number[];
  /** Keyboard scheme (DMO-KEY-01) and the keys someone rebound (DMO-KEY-02). */
  keyScheme?: 'worksuite' | 'outlook' | 'gmail';
  keyBindings?: Record<string, string>;
  /** Command bar: one row with an overflow, or grouped labelled buttons (DMO-SHL-03); commands pinned to it. */
  commandBar?: 'simplified' | 'classic';
  commandPins?: string[];
  /** Open messages in tabs, windows or both (DMO-SHL-06). */
  openIn?: 'tabs' | 'windows' | 'both';
  /** Mark as read: when opened, after a delay, when the selection changes, or never (DMO-INB-12). */
  markRead?: 'open' | 'delay' | 'change' | 'never';
  /** Senders whose pictures are always shown, through WorkSuite's image proxy (DMO-RD-02). */
  imageSenders?: string[];
  /** Images & media (#163): when pictures from the web load — Ask unless changed. */
  remoteImages?: 'always' | 'ask' | 'trusted' | 'never';
  /** Domains whose pictures are always shown (a sender at mail.example.com counts under example.com). */
  imageDomains?: string[];
  /** The person's organisation's own domains count as trusted (on unless turned off). */
  trustOwnDomains?: boolean;
  /** Answering a read-receipt request (DMO-CMP-11): ask each time (the default), always, or never. */
  readReceipts?: 'ask' | 'always' | 'never';
  markReadDelay?: number;
  /** Favourites in the folder pane: "box:folder" keys and smart views (DMO-NAV-01). */
  favorites?: string[];
  /** View settings remembered per folder (DMO-INB-16). */
  folderViews?: Record<string, Partial<Pick<MailPrefs, 'view' | 'pane' | 'sort' | 'dir' | 'group' | 'toolbar'>>>;
  /** First run: "Coming from Outlook?" answered (WF-DO12). */
  firstRun?: 'done' | 'outlook' | 'skipped';
  /** Conditional formatting of list rows (DMO-INB-18). */
  formatRules?: FormatRule[];
  /** Senders always shown as plain text (DMO-RD-09). */
  plainTextSenders?: string[];
  /** The Apps pane beside the message (DMO-INT-01). */
  appsPane?: boolean;
  /** The reading pane header (#212): Star and More only (the default), or more of the actions as buttons too. */
  headerIcons?: 'few' | 'more';
  /** Catch up after an absence (DMO-AI-01): on unless turned off. */
  catchUp?: boolean;
  /** Immersive reader settings (DMO-RD-04). */
  immersive?: { size?: number; spacing?: 'normal' | 'wide'; width?: 'narrow' | 'wide'; focusLine?: boolean };
}

/** "When the row is from x / says y / has category z / is unread → colour, bold" (DMO-INB-18). */
export interface FormatRule {
  id: string;
  when: 'from' | 'subject' | 'category' | 'unread' | 'flagged' | 'important';
  value: string;
  colour: 'red' | 'orange' | 'green' | 'blue' | 'teal' | null;
  bold: boolean;
  enabled: boolean;
}

export type SortKey = 'date' | 'sender' | 'subject' | 'size' | 'read' | 'attachment' | 'flag' | 'star';
export type GroupKey = 'none' | 'date' | 'sender' | 'folder' | 'label' | 'priority' | 'conversation';

export interface LocalMailbox {
  id: number;
  email: string;
  display_name: string;
  type: string;
  account_type: string;
  state: string;
  connection_id: number | null;
  quota_mb: number;
}

export interface OutboxRow {
  id: number;
  to: string[];
  subject: string;
  send_at: string;
  status: string;
  error: string | null;
}

export interface Template {
  id: number;
  name: string;
  subject: string | null;
  body_html: string;
  shared: boolean;
  mine: boolean;
}

export interface Signature {
  id: number;
  name: string;
  html: string;
  /** The html with {name}, {title}, {phone}, {email} filled from the profile (newer servers). */
  filled?: string;
  is_default: boolean;
  /** The account it belongs to; null or absent: every account (DMO-CMP-06). */
  mailbox?: number | null;
  default_new?: boolean;
  default_reply?: boolean;
  /** worksuite-desktop#166 (newer servers): the plain-text version. */
  text?: string;
  /** personal, or the organisation's (made by an administrator). */
  scope?: 'personal' | 'company';
  /** An organisation signature people use with their own details and cannot change. */
  locked?: boolean;
  editable?: boolean;
  /** hosted: pictures by their public WorkSuite link; embedded: inside the message (cid:). */
  image_mode?: 'hosted' | 'embedded';
  dark_logo?: string | null;
  images?: string[];
  variables_used?: string[];
  /** Embedded mode: each hosted picture's address and the picture as a data: URL. */
  embedded?: Record<string, string>;
  updated_at?: string | null;
}

/** Which signature an account uses (mailbox null: every account without its own choice). */
export interface SignatureSetting {
  mailbox: number | null;
  new_id: number | null;
  /** null: no signature on replies and forwards. */
  reply_id: number | null;
  /** above_quote: below the reply, above the quoted message; below_quote: at the very end. */
  placement: 'above_quote' | 'below_quote';
}

export interface SignatureTemplate {
  id: number;
  name: string;
  html: string;
  scope: 'personal' | 'company';
  editable: boolean;
}

/** GET /api/mail/signatures: older servers send only `signatures`. */
export interface SignaturesData {
  signatures: Signature[];
  settings?: SignatureSetting[];
  templates?: SignatureTemplate[];
  values?: Record<string, string>;
  details?: Record<string, string>;
  assets?: { social_base: string; social: string[] };
  can_manage_company?: boolean;
}

/** A message's address: which mailbox, which folder, which uid. */
export interface MessageRef {
  uid: string;
  folder: string;
  mailbox: string | null;
  /**
   * The stable identity besides account, folder and UID (worksuite-desktop#209): the Message-ID (or its
   * hash, from a mirrored list) and the UIDVALIDITY the UID belongs to. With them the server finds a
   * message that was moved, or renumbered, instead of answering "not found".
   */
  mid?: string | null;
  midHash?: string | null;
  uidvalidity?: number | null;
}

import type { SendBlock } from './protection/types';

export interface ComposeSeed {
  mode: 'new' | 'reply' | 'reply_all' | 'forward';
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  /** Text the person is sending as their own words (a mailto: body, a meeting invitation) — not quoted. */
  body?: string;
  quote?: string;
  inReplyTo?: string;
  mailbox?: string | null;
  /** A template to put in once it has loaded (a Quick Step's reply with template). */
  templateId?: number;
  /** The message replied to, for Send and archive (worksuite-desktop#213). */
  source?: MessageRef;
  /** The last send was refused by mail protection (P-UI-15): reopened with why, the draft as it was. */
  sendBlock?: SendBlock;
}
