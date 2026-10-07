/**
 * WorkSuite Support on this computer (WS-SUPPORT-SRS-001, desktop screens D-01…D-12): the staff API's shapes, the
 * desk's vocabulary, the module's routes and the rules the renderer and the main process share. Pure — no Electron,
 * no DOM, no network.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONTRACT IS THE SERVER'S docs/SUPPORT_API.md
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every screen works through `/api/support/v1` (the house path for the SRS's `/api/v1/support`). The types below are
 * that document's DTOs as `TicketPresenter` writes them; a field the server may leave out is optional here, so a
 * screen never trusts one that an older server did not send.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AN OLDER SERVER STILL WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Servers from before the v1 API answer only the as-built `/api/tickets` (list, show, reply, action, agents). The
 * API client falls back to those routes when a v1 route is missing, and the `fromLegacy…` mappers below turn their
 * answers into the v1 shapes, so the screens have one shape to draw. What the as-built API cannot do (views with
 * counts, read markers, attachments, presence) is simply absent there rather than guessed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REALTIME IS A HINT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `support.changed` (a desk changed, no ticket id), `support.ticket` (a ticket I am on changed) and
 * `support.presence` (who else is on it) only say what to fetch again; nothing is patched from the socket (§12.2).
 */

export const SUPPORT_API = '/api/support/v1';
export const SUPPORT_LEGACY_API = '/api/tickets';

/* ── the desk's vocabulary (§6.1, §6.2) ─────────────────────────────────── */

export const STATUSES = ['new', 'open', 'in_progress', 'pending_customer', 'pending_internal', 'escalated', 'resolved', 'closed'] as const;
export type SupportStatus = (typeof STATUSES)[number];
export type StatusCategory = 'new' | 'open' | 'pending' | 'resolved' | 'closed';

/** Statuses where somebody still has work to do (`Tickets::LIVE`). */
export const LIVE_STATUSES: readonly SupportStatus[] = ['new', 'open', 'in_progress', 'pending_customer', 'pending_internal', 'escalated'];

export const STATUS_LABEL: Record<SupportStatus, string> = {
  new: 'New',
  open: 'Open',
  in_progress: 'In progress',
  pending_customer: 'Pending customer',
  pending_internal: 'Pending internal',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const STATUS_CATEGORY: Record<SupportStatus, StatusCategory> = {
  new: 'new',
  open: 'open',
  in_progress: 'open',
  escalated: 'open',
  pending_customer: 'pending',
  pending_internal: 'pending',
  resolved: 'resolved',
  closed: 'closed',
};

/**
 * The state machine (`TicketService::TRANSITIONS`). The v1 API sends the moves a ticket allows the caller
 * (`transitions`), so this is read only for a server that does not: the as-built API.
 */
export const TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  new: ['open', 'in_progress', 'pending_customer', 'pending_internal', 'escalated', 'resolved'],
  open: ['in_progress', 'pending_customer', 'pending_internal', 'escalated', 'resolved'],
  in_progress: ['open', 'pending_customer', 'pending_internal', 'escalated', 'resolved'],
  pending_customer: ['open', 'in_progress', 'resolved'],
  pending_internal: ['open', 'in_progress', 'resolved'],
  escalated: ['in_progress', 'resolved'],
  resolved: ['open', 'closed'],
  closed: [],
};

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type SupportPriority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<SupportPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

export const TYPES = ['question', 'incident', 'problem', 'request', 'complaint'] as const;
export type SupportType = (typeof TYPES)[number];
export const TYPE_LABEL: Record<SupportType, string> = { question: 'Question', incident: 'Incident', problem: 'Problem', request: 'Request', complaint: 'Complaint' };

/** Where a ticket came from (`TicketService::SOURCES`; `walk_in` since worksuite-desktop#298). */
export const SOURCES = ['manual', 'email', 'chat', 'widget_offline', 'form', 'portal', 'whatsapp', 'phone', 'walk_in', 'api', 'module', 'desktop'] as const;
export type SupportSource = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<SupportSource, string> = {
  manual: 'Manual',
  email: 'Email',
  chat: 'Website chat',
  widget_offline: 'Website form',
  form: 'Form',
  portal: 'Portal',
  whatsapp: 'WhatsApp',
  phone: 'Phone',
  walk_in: 'Walk-in',
  api: 'API',
  module: 'WorkSuite',
  desktop: 'WorkSuite Desktop',
};

/** The channels a ticket raised by hand can say it came by (#298): Manual unless the requester rang or walked in. */
export const MANUAL_SOURCES = ['manual', 'phone', 'walk_in'] as const;
export type ManualSource = (typeof MANUAL_SOURCES)[number];

/** `none`: no SLA policy applies to the ticket. */
export type SlaState = 'ok' | 'at_risk' | 'breached' | 'met' | 'paused' | 'none';
export type SlaTarget = 'first_response' | 'next_response' | 'resolution';
export const SLA_TARGET_LABEL: Record<SlaTarget, string> = { first_response: 'First response', next_response: 'Next response', resolution: 'Resolution' };

/** The system views (`TicketQuery::VIEWS`), in the rail's order, with the server's labels for a server that sends none. */
export const VIEWS = ['mine', 'unassigned', 'assigned', 'mentioned', 'watching', 'overdue', 'escalated', 'pending', 'live', 'resolved', 'closed', 'all', 'needs_organization', 'trash'] as const;
export type SupportView = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<SupportView, string> = {
  mine: 'My tickets',
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  mentioned: 'Mentioned',
  watching: 'Watching',
  overdue: 'Overdue',
  escalated: 'Escalated',
  pending: 'Pending',
  live: 'Open & pending',
  resolved: 'Resolved',
  closed: 'Closed',
  all: 'All tickets',
  needs_organization: 'Needs organization',
  trash: 'Trash',
};

export const SORTS = ['updated', 'created', 'sla', 'priority'] as const;
export type SupportSort = (typeof SORTS)[number];
export const SORT_LABEL: Record<SupportSort, string> = { updated: 'Last updated', created: 'Newest', sla: 'SLA due', priority: 'Priority' };

/** "18m", "3h 20m", "1d 4h": a span as the desk's chips say it. */
export function spanShort(ms: number): string {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export const SLA_TARGET_SHORT: Record<SlaTarget, string> = { first_response: 'FRT', next_response: 'Next', resolution: 'Res' };

/**
 * An SLA in a few words, as the tray and a pop-up say it where no chip can be drawn: "Next 18m", "Res overdue 5m",
 * "Paused", "FRT met". Null when no policy applies or the server has not computed a state.
 */
export function slaShort(sla: Partial<Sla> | null | undefined, now: number): string | null {
  if (!sla?.state || sla.state === 'none') return null;
  const target = sla.target ? SLA_TARGET_SHORT[sla.target] : 'SLA';
  if (sla.state === 'paused') return 'Paused';
  if (sla.state === 'met') return `${target} met`;
  const due = sla.due_at ? Date.parse(sla.due_at) : NaN;
  if (!Number.isFinite(due)) return target;
  return due < now ? `${target} overdue ${spanShort(due - now)}` : `${target} ${spanShort(due - now)}`;
}

export function isStatus(v: unknown): v is SupportStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

export function isView(v: unknown): v is SupportView {
  return typeof v === 'string' && (VIEWS as readonly string[]).includes(v);
}

export function isLive(status: string | null | undefined): boolean {
  return isStatus(status) && LIVE_STATUSES.includes(status);
}

export function statusLabel(status: string | null | undefined): string {
  return isStatus(status) ? STATUS_LABEL[status] : status ? status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '';
}

/* ── the API's shapes (docs/SUPPORT_API.md) ─────────────────────────────── */

export interface IdName {
  id: number;
  name: string | null;
}

export interface Requester {
  name: string | null;
  email: string | null;
  phone: string | null;
  kind: 'guest' | 'contact' | 'customer';
  user_id: number | null;
  contact_id: number | null;
  company_id: number | null;
}

/** The SLA chip's facts (FR-SLA-07). `state` stays null until the SLA engine computes it: draw no chip then. */
export interface Sla {
  state: SlaState | null;
  target: SlaTarget | null;
  due_at: string | null;
  policy_id: number | null;
  paused_ms: number;
}

/** A ticket as every list row has it. */
export interface Ticket {
  id: number;
  reference: string;
  subject: string;
  status: SupportStatus;
  status_category: StatusCategory | null;
  priority: SupportPriority;
  type: SupportType | null;
  source: SupportSource | string;
  organization: IdName | null;
  requester: Requester;
  assignee: IdName | null;
  team: IdName | null;
  category: IdName | null;
  department: IdName | null;
  tags: string[];
  sla: Sla;
  due_at: string | null;
  confidential: boolean;
  /** Messages I have not read (not my own). */
  unread: number;
  conversation_id: number | null;
  version: number;
  opened_at: string | null;
  first_response_at: string | null;
  last_customer_at: string | null;
  last_agent_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  /** What it was raised from, when that is something the desktop can open (#298): absent from an older server. */
  origin?: TicketOrigin | null;
}

/** An email in Mail (`mail_message_id`: null when the message is not one the server can point to), or a website chat. */
export type TicketOrigin = { type: 'email'; mail_message_id: number | null } | { type: 'chat'; conversation_id: number };

/** One ticket in full (`GET tickets/{id}`, and every write's answer). */
export interface TicketFull extends Ticket {
  rustdesk_id?: string | null;
  rustdesk_uri?: string | null;
  language?: string | null;
  custom_fields?: Record<string, unknown>;
  resolution_category?: string | null;
  resolution_summary?: string | null;
  escalated_at?: string | null;
  merged_into_id?: number | null;
  /** Merged into another: read-only, open that one instead (WF-11). */
  merged_into?: { id: number; reference: string } | null;
  watchers?: IdName[];
  created_by?: number | null;
  /** Each SLA target's clock as the server keeps it (`GET tickets/{id}`); none for a ticket no policy applies to. */
  sla_timers?: SlaTimer[];
}

/** One SLA target's clock: when it is due, and whether it runs, stands still, was missed or was met (`at`: when it settled). */
export interface SlaTimer {
  target: SlaTarget;
  due_at: string | null;
  state: 'running' | 'paused' | 'breached' | 'met';
  at: string | null;
}

/**
 * What a ticket is linked to (FR-TKT-05, `GET tickets/{id}/links`): another ticket, a website chat or a record of
 * another module. Something the viewer may not open is `visible: false`, with no label and no link.
 */
export interface TicketLink {
  id: number;
  module: string;
  entity: string;
  entity_id: number;
  relation: 'related' | 'duplicate' | 'follow_up' | 'merged' | string;
  created_at: string | null;
  visible: boolean;
  label: string | null;
  /** A linked ticket's status. */
  status?: string | null;
  /** A record's second line ("LKR 486,000 · Paid"). */
  detail?: string | null;
  /** Where it opens on the web (`/tickets?ticket=12`), or null. */
  link: string | null;
}

export interface Message {
  id: number;
  body: string;
  body_html: string | null;
  author: IdName | null;
  author_name: string | null;
  from: 'requester' | 'staff';
  internal: boolean;
  channel: string | null;
  delivery_channel: string | null;
  delivery_status: string | null;
  cc: string[];
  mentions: number[];
  client_id: string | null;
  edited_at: string | null;
  created_at: string | null;
}

export interface Attachment {
  id: number;
  ticket_id: number | null;
  message_id: number | null;
  name: string;
  mime: string | null;
  size: number;
  public: boolean;
  scan_status: string | null;
  created_by: number | null;
  created_at: string | null;
}

export interface TicketEvent {
  id: number;
  action: string;
  detail: string | null;
  field: string | null;
  old: string | null;
  new: string | null;
  source: string | null;
  reason: string | null;
  user: IdName | null;
  created_at: string | null;
}

/** What the caller may do (`SupportAccess::caps`), per organization. */
export type CapName = 'view' | 'create' | 'reply' | 'notes' | 'assign' | 'edit' | 'close' | 'reopen' | 'escalate' | 'merge' | 'delete' | 'export' | 'reports' | 'admin' | 'confidential' | 'manage';
export type Caps = Partial<Record<CapName, boolean>>;

/** The installation's RustDesk server, or null when none is set up (WF-13). */
export interface RemoteDesk {
  id_server: string;
  relay_server: string;
  key: string;
  config_string: string;
}

/** `GET tickets/{id}`. `legacy`: read from the as-built API, which has no read markers, files or allowed moves of its own. */
export interface TicketShow {
  ticket: TicketFull;
  messages: Message[];
  has_earlier: boolean;
  attachments: Attachment[];
  events: TicketEvent[];
  /** What was read before this visit: "New since you last viewed" sits above the next message. 0 for never. */
  last_read_message_id: number;
  can: Caps;
  transitions: SupportStatus[];
  remote_desk: RemoteDesk | null;
  legacy?: boolean;
}

export interface TicketPage {
  items: Ticket[];
  next_cursor: string | null;
  has_more: boolean;
  sort: SupportSort | string;
  view: string;
}

export interface ViewCount {
  key: SupportView | string;
  label: string;
  /** Null where the server gives no count (the as-built API). */
  count: number | null;
}

export interface SavedView {
  id: number;
  name: string;
  scope: 'personal' | 'shared';
  organization_id: number | null;
  filters: Record<string, unknown>;
  sort: SupportSort | null;
  mine: boolean;
  count: number;
}

/** What the rail, the dock, the tray and the phone show (§12.2). */
export interface Badges {
  assigned_open: number;
  unassigned: number;
  overdue: number;
  at_risk: number;
  /** My live tickets with something I have not read: newly assigned ones included. */
  unread: number;
}

export interface ViewsAnswer {
  views: ViewCount[];
  saved: SavedView[];
  badges: Badges | null;
}

export interface MetaStatus {
  key: SupportStatus;
  label: string;
  category: StatusCategory;
  live: boolean;
  next: SupportStatus[];
}

export interface MetaOrganization {
  id: number;
  name: string;
  prefix: string;
  can: Caps;
}

export interface Meta {
  statuses: MetaStatus[];
  priorities: SupportPriority[];
  types: SupportType[];
  sources: string[];
  views: string[];
  sorts: string[];
  organizations: MetaOrganization[];
  departments: Array<{ id: number; name: string; organization_id: number | null }>;
  teams: Array<{ id: number; name: string; organization_id: number | null; department_id: number | null; tier: number }>;
  categories: Array<{ id: number; name: string; organization_id: number | null; parent_id: number | null }>;
  tags: Array<{ name: string; organization_id: number | null }>;
  /** What I may do anywhere at the desk; `create` raises a ticket by hand (#298). An older server may send none. */
  can?: Caps & { convert_chat?: boolean; convert_email?: boolean };
  /** What this server can do at all (#298); absent from an older one. */
  capabilities?: { convert_chat?: boolean; convert_email?: boolean; mail_intake?: boolean };
  /** Built here for a server without the v1 API. */
  legacy?: boolean;
}

export type AgentPresence = 'available' | 'busy' | 'away' | 'dnd' | 'offline';

export interface Agent {
  id: number;
  name: string;
  presence: AgentPresence | string;
  /** Live tickets of theirs in this organization. */
  open: number;
  capacity: number | null;
  teams: Array<{ id: number; name: string; role: string | null; capacity: number | null }>;
}

export interface Canned {
  id: number;
  title: string;
  shortcut: string | null;
  body: string;
  scope: 'personal' | 'shared';
  organization_id: number | null;
  category_id: number | null;
  uses: number;
  mine: boolean;
}

/** Somebody else on a ticket now (FR-COM-11). */
export interface Present {
  user_id: number;
  name: string;
  state: 'viewing' | 'typing';
  mode: 'reply' | 'note' | null;
  since: string | null;
}

export interface MessageInput {
  body: string;
  /** Internal unless said otherwise (§4.1 principle 3): the API's default is a note, and so is the composer's. */
  internal: boolean;
  client_id?: string;
  mentions?: number[];
  cc?: string[];
  attachments?: number[];
  /** "Send · Pending customer": the status moves after the message is in. */
  status?: SupportStatus;
  body_html?: string;
}

export interface MessageAnswer {
  message: Message;
  duplicate: boolean;
  /** Null from the as-built API, which answers only the message id: read the ticket again. */
  ticket: TicketFull | null;
  /** The message is in, but the status could not move (the first reply opened a New ticket first, say). */
  status_refused: { code: string; message: string } | null;
}

export interface TransitionInput {
  status: SupportStatus;
  reason?: string;
  resolution_category?: string;
  resolution_summary?: string;
  override?: boolean;
  version?: number;
}

export interface AssignInput {
  user_id: number | null;
  team_id?: number | null;
  reason?: string;
  version?: number;
}

/** The fields a PATCH may change (`TicketService::EDITABLE`). */
export interface TicketChanges {
  subject?: string;
  priority?: SupportPriority;
  type?: SupportType | null;
  team_id?: number | null;
  category_id?: number | null;
  department_id?: number | null;
  due_at?: string | null;
  language?: string | null;
  tags?: string[];
  confidential?: boolean;
  organization_id?: number;
  requester_name?: string | null;
  requester_email?: string | null;
  requester_phone?: string | null;
}

/** A list's question: one view, filtered and sorted, a page at a time. */
export interface ListParams {
  view: SupportView | string;
  sort?: SupportSort;
  q?: string;
  status?: string[];
  priority?: string[];
  organization?: string[];
  assignee?: string;
  limit?: number;
  cursor?: string | null;
  /** The channels it came by (`source=`, #298). */
  source?: string[];
  /** A saved view's other filters (team, department, category, tag, sla, dates…), as the server keeps them. */
  extra?: Record<string, string>;
}

/**
 * `POST tickets` from the New ticket form (FR-CRT-01/02, #298). The requester is a contact found (`contact_id`) or
 * somebody new by name, email and phone; the description is the thread's first message, with the files uploaded for
 * it (`POST attachments`). `attachments` repeats `attachment_ids` for a server from before #298, which reads that.
 */
export interface NewTicketInput {
  subject: string;
  description?: string;
  /** The description as formatted, for a server that keeps a message's HTML. */
  description_html?: string;
  requester: { name?: string | null; email?: string | null; phone?: string | null; contact_id?: number | null; company_id?: number | null };
  organization_id?: number | null;
  source: ManualSource;
  priority: SupportPriority;
  type?: SupportType | null;
  category_id?: number | null;
  team_id?: number | null;
  assigned_to?: number | null;
  tags?: string[];
  due_at?: string | null;
  attachment_ids?: number[];
  attachments?: number[];
  /** Email the requester that the ticket is open, with its reference. */
  notify_requester: boolean;
}

/* ── website chat → ticket (FR-LCH-01…08, D-06) ─────────────────────────── */

/** `GET conversions/{conversation_id}`: what the conversion sheet opens with, and the chat's back-link to its ticket. */
export interface ConversionPreview {
  conversation: { id: number; status: string | null; website: string | null; widget: string | null; offline: boolean; started_at: string | null };
  visitor: { id: number | null; name: string | null; email: string | null; phone: string | null; company: string | null };
  /** The ticket the chat already became (FR-LCH-03), or null. */
  ticket: { id: number; reference: string; status: SupportStatus } | null;
  /** The visitor's live tickets at that desk, to append to instead (FR-LCH-06). */
  candidates: Ticket[];
  prefill: { subject: string; organization_id: number | null; priority: SupportPriority; source: string };
  /** The visitor's page, location and browser, as the ticket's first internal line (FR-LCH-04). */
  details: string;
  transcript: Array<{ id: number; from: 'visitor' | 'agent' | 'assistant' | 'website'; name: string; body: string; at: string | null; files: Array<{ name: string; mime: string | null; size: number }> }>;
}

/** `POST conversions`. */
export interface ConvertInput {
  conversation_id: number;
  target: 'new' | number;
  subject?: string;
  priority?: SupportPriority;
  type?: SupportType;
  category_id?: number | null;
  department_id?: number | null;
  team_id?: number | null;
  assigned_to?: number | null;
  tags?: string[];
  organization_id?: number | null;
  /** Transcript messages copied as public replies; the rest are internal (FR-LCH-02). */
  public_message_ids?: number[];
  notify_visitor?: boolean;
}

export interface ConvertAnswer {
  ticket: TicketFull;
  appended: boolean;
  copied: number;
  files: number;
  files_refused: number;
  notified: boolean;
}

/* ── knowledge and AI in a ticket (D-10, FR-KB-06/08, FR-AI-01…03) ──────── */

/** An article offered for a ticket (`GET tickets/{id}/kb`): `url` (the help centre's) only for a public one. */
export interface KbSuggestion {
  id: number;
  title: string;
  excerpt: string | null;
  visibility: 'public' | 'internal' | string;
  language: string | null;
  url: string | null;
  /** How well it matches, 0…1; none for a search. */
  score?: number | null;
}

/** What `POST tickets/{id}/kb/insert` gives to put in the reply; the insert is counted as a use. */
export interface KbInsert {
  url: string | null;
  text: string;
  title: string;
}

/** `POST tickets/{id}/ai/summary`: up to five bullets, kept by the server until the thread moves. */
export interface AiSummary {
  text: string;
  model: string | null;
  cached: boolean;
  at: string | null;
}

export const AI_TONES = ['friendly', 'professional', 'concise', 'empathetic'] as const;
export type AiTone = (typeof AI_TONES)[number];
export const AI_TONE_LABEL: Record<AiTone, string> = { friendly: 'Friendly', professional: 'Professional', concise: 'Concise', empathetic: 'Empathetic' };

/** `POST tickets/{id}/ai/reply`: a draft for the composer, grounded on the thread and these articles. */
export interface AiReplyDraft {
  draft: string;
  sources: Array<{ id: number; title: string; url: string | null }>;
  model: string | null;
}

/** `POST tickets/{id}/ai/classify`: only values the desk knows; anything else is null. Applied with PATCH. */
export interface AiClassification {
  category_id: number | null;
  category: string | null;
  priority: SupportPriority | null;
  language: string | null;
  sentiment: string | null;
  model: string | null;
}

/** The composer's writing assistant (`POST ai/rewrite`). */
export const REWRITE_MODES = ['improve', 'shorten', 'professional', 'friendly', 'translate_en', 'translate_si', 'translate_ta'] as const;
export type RewriteMode = (typeof REWRITE_MODES)[number];
export const REWRITE_LABEL: Record<RewriteMode, string> = {
  improve: 'Improve writing',
  shorten: 'Make shorter',
  professional: 'More professional',
  friendly: 'Friendlier',
  translate_en: 'Translate to English',
  translate_si: 'Translate to Sinhala',
  translate_ta: 'Translate to Tamil',
};

/** The ticket languages the desk knows (FR-KB-10). */
export const LANGUAGE_LABEL: Record<string, string> = { en: 'English', si: 'Sinhala', ta: 'Tamil' };

/** My draft of a ticket kept by the server (FR-CRT-10, `GET/PUT/DELETE tickets/{id}/draft`): one per person and ticket. */
export interface ServerDraft {
  mode: 'reply' | 'note';
  body: string;
  body_html: string | null;
  cc: string[];
  updated_at: string | null;
}

/* ── routes ─────────────────────────────────────────────────────────────── */

export const SUPPORT_ROUTE = '/support';

/** A ticket's id ("1284") or its reference ("CFX-001284"), as a route or a deep link names it. */
const TICKET_ID = /^[1-9]\d{0,17}$/;
const REFERENCE = /^[A-Za-z][A-Za-z0-9]{0,15}-\d{1,12}$/;

export function isTicketKey(key: string | null | undefined): key is string {
  return !!key && (TICKET_ID.test(key) || REFERENCE.test(key));
}

/** The numeric id a key names, or null for a reference (which is looked up). */
export function ticketIdOf(key: string): number | null {
  return TICKET_ID.test(key) ? Number(key) : null;
}

/** A ticket's own tab: `worksuite://support/ticket/{id}` opens here (FR-DSK-05). */
export function ticketRoute(id: number | string): string {
  return `${SUPPORT_ROUTE}/ticket/${id}`;
}

/**
 * A ticket's quick-reply window (D-04): `/support/quick/{id}`, a small window of its own over whatever is in front.
 * In the main window the same route is the ticket's tab (`canonicalSupportRoute`): "Open full ticket" carries on there.
 */
export function quickRoute(id: number | string): string {
  return `${SUPPORT_ROUTE}/quick/${id}`;
}

/** An urgent ticket's ringing card (D-07): `/support/ring/{id}`; like a quick reply, the ticket's tab in the main window. */
export function ringRoute(id: number | string): string {
  return `${SUPPORT_ROUTE}/ring/${id}`;
}

export type SupportRoute = { kind: 'ticket'; key: string } | { kind: 'quick'; key: string } | { kind: 'ring'; key: string } | { kind: 'inbox'; view: string | null; saved: string | null; q: string | null };

/**
 * Where a support route goes. A ticket's tab is `/support/ticket/{id}` (or a reference in place of the id); the
 * forms WorkSuite's web links arrive in (`/tickets?ticket=4` becomes `/support?ticket=4`, `/tickets/4` becomes
 * `/support/4`) and `/support/tickets/{id}` are the same ticket. Anything else is the inbox, on the view and search
 * it names. A word after `/support/` that is no id or reference is left for the module's other screens.
 */
export function parseSupportRoute(route: string): SupportRoute {
  const [path = '', qs = ''] = route.split('#')[0]!.split('?');
  const segments = path.split('/').filter(Boolean);
  const query = new URLSearchParams(qs);
  if (segments[0] === 'support') {
    const rest = segments.slice(1);
    if (rest.length === 2 && rest[0] === 'quick' && isTicketKey(rest[1])) return { kind: 'quick', key: rest[1] };
    if (rest.length === 2 && rest[0] === 'ring' && isTicketKey(rest[1])) return { kind: 'ring', key: rest[1] };
    const key = rest.length === 2 && (rest[0] === 'ticket' || rest[0] === 'tickets') ? rest[1] : rest.length === 1 ? rest[0] : null;
    if (isTicketKey(key)) return { kind: 'ticket', key };
    const asked = query.get('ticket') ?? query.get('open');
    if (rest.length === 0 && isTicketKey(asked)) return { kind: 'ticket', key: asked };
  }
  return { kind: 'inbox', view: query.get('view'), saved: query.get('saved'), q: query.get('q') };
}

/** Whether a route is a ticket's own tab (in any of its forms). */
export function isTicketRoute(route: string): boolean {
  return /^\/support(?:[/?#]|$)/.test(route) && parseSupportRoute(route).kind === 'ticket';
}

/**
 * A support route in its one form: every way of naming a ticket becomes its tab's route — its quick-reply window's
 * too, which the main window shows as the ticket's tab; anything else stays.
 */
export function canonicalSupportRoute(route: string): string {
  if (!/^\/support(?:[/?#]|$)/.test(route)) return route;
  const r = parseSupportRoute(route);
  return r.kind === 'ticket' || r.kind === 'quick' || r.kind === 'ring' ? ticketRoute(r.key) : route;
}

/** The inbox's route for a view (and a search). */
export function inboxRoute(view: string | null = null, q: string | null = null): string {
  const query = new URLSearchParams();
  if (view) query.set('view', view);
  if (q) query.set('q', q);
  const s = query.toString();
  return s ? `${SUPPORT_ROUTE}?${s}` : SUPPORT_ROUTE;
}

/* ── realtime hints (§12.2) ─────────────────────────────────────────────── */

export interface DeskHint {
  type: 'support.changed';
  organization_id: number | null;
  kind: string;
}

export interface TicketHint {
  type: 'support.ticket';
  kind: string;
  ticket_id: number;
  reference: string | null;
  version: number | null;
  fields: string[];
  /** `kind: message` only. */
  message_id: number | null;
  internal: boolean;
  from: 'requester' | 'staff' | null;
  mentioned: boolean;
}

export interface PresenceHint {
  type: 'support.presence';
  ticket_id: number;
  present: Present[];
}

export type SupportHint = DeskHint | TicketHint | PresenceHint;

const posInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

function present(raw: unknown): Present[] {
  if (!Array.isArray(raw)) return [];
  const out: Present[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const id = posInt(r.user_id);
    if (!id) continue;
    out.push({ user_id: id, name: typeof r.name === 'string' ? r.name : '', state: r.state === 'typing' ? 'typing' : 'viewing', mode: r.mode === 'reply' || r.mode === 'note' ? r.mode : null, since: typeof r.since === 'string' ? r.since : null });
  }
  return out;
}

/** A realtime event as a support hint, or null for anything else (and for one that does not read). */
export function supportHint(e: unknown): SupportHint | null {
  if (!e || typeof e !== 'object') return null;
  const r = e as Record<string, unknown>;
  if (r.type === 'support.changed') {
    return { type: 'support.changed', organization_id: posInt(r.organization_id), kind: typeof r.kind === 'string' ? r.kind : 'updated' };
  }
  if (r.type === 'support.ticket') {
    const id = posInt(r.ticket_id);
    if (!id) return null;
    return {
      type: 'support.ticket',
      kind: typeof r.kind === 'string' ? r.kind : 'updated',
      ticket_id: id,
      reference: typeof r.reference === 'string' ? r.reference : null,
      version: posInt(r.version),
      fields: Array.isArray(r.fields) ? r.fields.filter((f): f is string => typeof f === 'string') : [],
      message_id: posInt(r.message_id),
      internal: r.internal === true,
      from: r.from === 'requester' || r.from === 'staff' ? r.from : null,
      mentioned: r.mentioned === true,
    };
  }
  if (r.type === 'support.presence') {
    const id = posInt(r.ticket_id);
    return id ? { type: 'support.presence', ticket_id: id, present: present(r.present) } : null;
  }
  return null;
}

/* ── the as-built API, read as v1 ───────────────────────────────────────── */

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};
/** "2026-10-06 09:12:00" (the as-built API's stored form) as ISO, so both APIs' times read the same. */
const stamp = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') : s;
};

/** The as-built `pending` is `pending_customer` (`Tickets::normaliseStatus`); anything unknown reads as Open. */
export function legacyStatus(v: unknown): SupportStatus {
  if (v === 'pending') return 'pending_customer';
  return isStatus(v) ? v : 'open';
}

const priorityOf = (v: unknown): SupportPriority => ((PRIORITIES as readonly string[]).includes(String(v)) ? (v as SupportPriority) : 'normal');

/** The as-built ticket (`TicketController::shape`, before or after T02) in the v1 shape. */
export function fromLegacyTicket(raw: Raw): TicketFull {
  const status = legacyStatus(raw.status);
  const assignee = num(raw.assigned_to);
  const org = num(raw.organization_id);
  return {
    id: Number(raw.id),
    reference: str(raw.reference) ?? `#${String(raw.id)}`,
    subject: str(raw.subject) ?? '',
    status,
    status_category: STATUS_CATEGORY[status],
    priority: priorityOf(raw.priority),
    type: (TYPES as readonly string[]).includes(String(raw.type)) ? (raw.type as SupportType) : null,
    source: str(raw.source) ?? 'manual',
    organization: org ? { id: org, name: null } : null,
    requester: { name: str(raw.requester_name), email: str(raw.requester_email), phone: str(raw.requester_phone), kind: 'guest', user_id: null, contact_id: null, company_id: null },
    assignee: assignee ? { id: assignee, name: str(raw.assignee_name) } : null,
    team: num(raw.team_id) ? { id: Number(raw.team_id), name: null } : null,
    category: num(raw.category_id) ? { id: Number(raw.category_id), name: null } : null,
    department: null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    sla: { state: null, target: null, due_at: null, policy_id: null, paused_ms: 0 },
    due_at: stamp(raw.due_at),
    confidential: raw.confidential === true,
    unread: 0,
    conversation_id: num(raw.conversation_id),
    // An as-built server before T02 keeps no version: 0 says so, and nothing that needs one is offered.
    version: num(raw.version) ?? 0,
    opened_at: stamp(raw.opened_at),
    first_response_at: stamp(raw.first_response_at),
    last_customer_at: stamp(raw.last_customer_at),
    last_agent_at: stamp(raw.last_agent_at),
    resolved_at: stamp(raw.resolved_at),
    closed_at: stamp(raw.closed_at),
    created_at: stamp(raw.created_at) ?? stamp(raw.opened_at),
    updated_at: stamp(raw.updated_at),
    deleted_at: null,
    rustdesk_id: str(raw.rustdesk_id),
    rustdesk_uri: str(raw.rustdesk_uri),
    merged_into: null,
    watchers: [],
  };
}

export function fromLegacyMessage(raw: Raw): Message {
  const author = num(raw.author_id);
  return {
    id: Number(raw.id),
    body: typeof raw.body === 'string' ? raw.body : '',
    body_html: null,
    author: author ? { id: author, name: str(raw.author_name) } : null,
    author_name: str(raw.author_name),
    from: raw.from === 'requester' || (raw.from !== 'staff' && !author) ? 'requester' : 'staff',
    internal: raw.is_internal === true || raw.internal === true,
    channel: str(raw.channel),
    delivery_channel: null,
    delivery_status: str(raw.delivery_status),
    cc: [],
    mentions: [],
    client_id: null,
    edited_at: null,
    created_at: stamp(raw.at) ?? stamp(raw.created_at),
  };
}

export function fromLegacyEvent(raw: Raw): TicketEvent {
  return {
    id: Number(raw.id),
    action: str(raw.action) ?? '',
    detail: str(raw.detail),
    field: str(raw.field),
    old: str(raw.old),
    new: str(raw.new),
    source: str(raw.source),
    reason: str(raw.reason),
    // The as-built journal names who did it, without their id.
    user: typeof raw.user === 'string' ? { id: 0, name: raw.user } : null,
    created_at: stamp(raw.at) ?? stamp(raw.created_at),
  };
}

/**
 * The as-built `can`: the v1 caps (a server since T02), or the three old ones (`view`, `reply`, `manage`), which
 * granted everything a desk manager does.
 */
export function fromLegacyCaps(raw: unknown): Caps {
  if (!raw || typeof raw !== 'object') return { view: true };
  const r = raw as Record<string, unknown>;
  const on = (k: string) => r[k] === true;
  if ('notes' in r || 'edit' in r || 'close' in r) {
    const out: Caps = {};
    for (const [k, v] of Object.entries(r)) if (typeof v === 'boolean') out[k as CapName] = v;
    return out;
  }
  const manage = on('manage');
  const reply = on('reply') || manage;
  return { view: on('view') || reply, reply, notes: reply, assign: manage, edit: manage, close: manage, reopen: manage, escalate: manage, delete: manage, manage };
}

/** Which permission a move needs (`TicketService::permissionFor`). */
export function capForMove(from: SupportStatus, to: SupportStatus): CapName {
  if (to === 'resolved' || to === 'closed') return 'close';
  if (from === 'resolved' || from === 'closed') return 'reopen';
  return to === 'escalated' ? 'escalate' : 'edit';
}

/** The moves the state machine allows from a status that these caps may make: the as-built API sends none. */
export function allowedMoves(from: SupportStatus, can: Caps): SupportStatus[] {
  return TRANSITIONS[from].filter((to) => can[capForMove(from, to)] === true);
}

/** `GET /api/tickets/{id}` in the v1 shape. */
export function fromLegacyShow(raw: Raw): TicketShow {
  const ticket = fromLegacyTicket((raw.ticket ?? {}) as Raw);
  if (Array.isArray(raw.tags)) ticket.tags = raw.tags.filter((t): t is string => typeof t === 'string');
  const can = fromLegacyCaps(raw.can);
  return {
    ticket,
    messages: Array.isArray(raw.messages) ? raw.messages.map((m) => fromLegacyMessage(m as Raw)) : [],
    has_earlier: false,
    attachments: [],
    events: Array.isArray(raw.events) ? raw.events.map((e) => fromLegacyEvent(e as Raw)) : [],
    last_read_message_id: 0,
    can,
    transitions: allowedMoves(ticket.status, can),
    remote_desk: (raw.remote_desk as RemoteDesk | null | undefined) ?? null,
    legacy: true,
  };
}

/**
 * A v1 list's question as the as-built API takes it (`status`, `mine`, `priority`, `search`; 200 rows, no pages),
 * and what it cannot ask that is then filtered here: `unassigned` and `assigned`.
 */
export function legacyListQuery(p: ListParams): { query: Record<string, string>; keep: (t: Ticket) => boolean } {
  const query: Record<string, string> = {};
  let keep = (_t: Ticket) => true;
  switch (p.view) {
    case 'mine':
      query.mine = '1';
      query.status = 'live';
      break;
    case 'unassigned':
      query.status = 'live';
      keep = (t) => !t.assignee;
      break;
    case 'assigned':
      query.status = 'live';
      keep = (t) => !!t.assignee;
      break;
    case 'escalated':
      query.status = 'escalated';
      break;
    case 'pending':
      // `pending` is read as Pending customer by every as-built server; Pending internal is new with v1.
      query.status = 'pending';
      break;
    case 'resolved':
    case 'closed':
    case 'all':
      query.status = p.view;
      break;
    default:
      query.status = 'live';
  }
  if (p.status?.length === 1) query.status = p.status[0]!;
  else if (p.status && p.status.length > 1) {
    const set = new Set(p.status);
    const before = keep;
    keep = (t) => before(t) && set.has(t.status);
  }
  if (p.priority?.length === 1) query.priority = p.priority[0]!;
  else if (p.priority && p.priority.length > 1) {
    const set = new Set(p.priority);
    const before = keep;
    keep = (t) => before(t) && set.has(t.priority);
  }
  if (p.source?.length) {
    // The as-built list has no channel filter: the rows are kept here by theirs.
    const set = new Set(p.source);
    const before = keep;
    keep = (t) => before(t) && set.has(t.source);
  }
  if (p.q?.trim()) query.search = p.q.trim();
  return { query, keep };
}

/** `GET /api/tickets` in the v1 page shape: every row at once, no next page. */
export function fromLegacyList(raw: Raw, p: ListParams, keep: (t: Ticket) => boolean = () => true): TicketPage {
  const rows = Array.isArray(raw.tickets) ? raw.tickets.map((t) => fromLegacyTicket(t as Raw)) : [];
  return { items: rows.filter(keep), next_cursor: null, has_more: false, sort: 'updated', view: String(p.view) };
}

/** What the rail shows for a server without views: the views it can answer, without counts. */
export const LEGACY_VIEWS: SupportView[] = ['mine', 'unassigned', 'assigned', 'escalated', 'pending', 'live', 'resolved', 'closed', 'all'];

export function legacyViews(): ViewsAnswer {
  return { views: LEGACY_VIEWS.map((key) => ({ key, label: VIEW_LABEL[key], count: null })), saved: [], badges: null };
}

/** The desk's vocabulary for a server without `GET meta`: the statuses and their moves, no organizations or teams. */
export function legacyMeta(): Meta {
  return {
    statuses: STATUSES.map((key) => ({ key, label: STATUS_LABEL[key], category: STATUS_CATEGORY[key], live: LIVE_STATUSES.includes(key), next: [...TRANSITIONS[key]] })),
    priorities: [...PRIORITIES],
    types: [...TYPES],
    sources: [...SOURCES],
    views: [...LEGACY_VIEWS],
    sorts: ['updated'],
    organizations: [],
    departments: [],
    teams: [],
    categories: [],
    tags: [],
    can: {},
    legacy: true,
  };
}

/** The global shortcut for "Quick reply to latest" (D-05: ⌃⌥R; Ctrl+Alt+R on Windows and Linux). */
export const SUPPORT_QUICK_SHORTCUT = 'Control+Alt+R';

/* ── native notifications (D-03) ────────────────────────────────────────── */

/**
 * The kinds of support banner (D-03, FR-DSK-02): a ticket assigned to me, a requester writing again on one of mine, a
 * mention in a note, an SLA about to be missed or missed. Each has its own buttons and its own settings.
 */
export const SUPPORT_NOTICE_KINDS = ['assigned', 'reply', 'mention', 'sla'] as const;
export type SupportNoticeKind = (typeof SUPPORT_NOTICE_KINDS)[number];

export interface SupportNoticeChoice {
  /** A banner on this computer. */
  banner: boolean;
  /** With a sound, when the app's sounds are on. */
  sound: boolean;
}

/** This computer's choices for Support's banners (Notification settings › Support). */
export interface SupportNoticePrefs {
  assigned: SupportNoticeChoice;
  reply: SupportNoticeChoice;
  mention: SupportNoticeChoice;
  sla: SupportNoticeChoice;
  /** An SLA's banner stays on screen until it is acted on (FR-SLA-05). */
  slaPersistent: boolean;
  /** A low-priority ticket's banners: one by one, or gathered into one at the top of the hour (FR-NTF-06). */
  lowPriority: 'banner' | 'digest';
  /** ⌃⌥R (Ctrl+Alt+R) from any app opens the quick-reply window on my latest ticket (D-05, FR-DSK-03). */
  quickShortcut: boolean;
  /** A new unassigned urgent ticket in my queues rings as a pop-up card (D-07). */
  urgentPopup: boolean;
}

/** As the design has them: assignment with a sound, a reply with a sound (and a reply box), a mention quietly, an SLA kept. */
export const SUPPORT_NOTICE_DEFAULTS: SupportNoticePrefs = {
  assigned: { banner: true, sound: true },
  reply: { banner: true, sound: true },
  mention: { banner: true, sound: false },
  sla: { banner: true, sound: true },
  slaPersistent: true,
  lowPriority: 'digest',
  quickShortcut: true,
  urgentPopup: true,
};

/** The choices made, with the defaults for the rest (a choice saved before a kind existed takes its default). */
export function supportNoticePrefs(p: Partial<SupportNoticePrefs> | null | undefined): SupportNoticePrefs {
  const d = SUPPORT_NOTICE_DEFAULTS;
  const one = (k: SupportNoticeKind): SupportNoticeChoice => ({ ...d[k], ...(p?.[k] ?? {}) });
  return {
    assigned: one('assigned'),
    reply: one('reply'),
    mention: one('mention'),
    sla: one('sla'),
    slaPersistent: typeof p?.slaPersistent === 'boolean' ? p.slaPersistent : d.slaPersistent,
    lowPriority: p?.lowPriority === 'banner' || p?.lowPriority === 'digest' ? p.lowPriority : d.lowPriority,
    quickShortcut: typeof p?.quickShortcut === 'boolean' ? p.quickShortcut : d.quickShortcut,
    urgentPopup: typeof p?.urgentPopup === 'boolean' ? p.urgentPopup : d.urgentPopup,
  };
}

/**
 * The server's notification events each kind stands for: their own In app choice. A mention is `support.mentioned`
 * (on servers that raise it), and the ticket's realtime hint where they do not.
 */
export const SUPPORT_NOTICE_EVENTS: Record<SupportNoticeKind, readonly string[]> = {
  assigned: ['support.ticket_assigned'],
  reply: ['support.customer_replied'],
  mention: ['support.mentioned'],
  sla: ['support.sla_warning', 'support.sla_breach'],
};

/** The kind of banner a server notification about the desk is, by its event; null for any other. */
export function supportNoticeKind(event: string | null | undefined): SupportNoticeKind | null {
  for (const k of SUPPORT_NOTICE_KINDS) if (event && SUPPORT_NOTICE_EVENTS[k].includes(event)) return k;
  return null;
}

/** The ticket a WorkSuite link names: the web's `/tickets?ticket=12`, or the desktop's `/support/ticket/12`. */
export function ticketIdOfLink(link: string | null | undefined): number | null {
  if (!link) return null;
  const web = /^\/tickets\/?\?(?:[^#]*&)?ticket=(\d{1,18})(?:[&#]|$)/.exec(link);
  if (web) return ticketIdOf(web[1]!);
  if (!link.startsWith(SUPPORT_ROUTE)) return null;
  const r = parseSupportRoute(link);
  return r.kind === 'ticket' ? ticketIdOf(r.key) : null;
}
