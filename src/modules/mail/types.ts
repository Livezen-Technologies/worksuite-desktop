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
  body_html: string;
  is_starred: boolean;
  is_important?: boolean;
  is_read?: boolean;
  attachments: Attachment[];
  created_at: string;
  labels?: Array<{ id: number; name: string; color: string | null }>;
  conversation_key?: string;
  team?: TeamState;
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
  } | null;
  /** Recent mail with the sender, newest first. */
  history?: { total: number; first: string | null; last: string | null; messages: Array<{ id: number; subject: string; at: string; is_read: boolean; has_attachment: boolean; folder: string | null; slug: string | null }> };
  related?: { meetings?: Array<{ id: number; title: string; at: string | null; status: string | null }>; tasks?: Array<{ id: number; title: string; status: string | null; due: string | null }> };
  security: MessageSecurity;
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
  /** Reading (D10): open messages in tabs, previews in the list, dark mode for email content. */
  tabs?: boolean;
  previews?: boolean;
  darkBody?: boolean;
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
}

/** A message's address: which mailbox, which folder, which uid. */
export interface MessageRef {
  uid: string;
  folder: string;
  mailbox: string | null;
}

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
}
